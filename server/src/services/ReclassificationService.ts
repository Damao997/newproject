import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { resolveCompanyCodes } from './AggregationService'
import type { AuthUserContext } from '../types/express'

/**
 * 数据重分类服务：
 * - 跨公司重分类：支持三种转移方式（transferMode）——
 *   all：整行改挂目标公司，同唯一键行合并求和（值相加、删除源行），合计不变；
 *   ratio/amount：部分金额转移，源行 value 调减（行保留），目标公司同唯一键行调增，
 *   无对应行则新建，转移合计恰等于计划金额，总额守恒。
 * - 同公司科目间调整（adjustSubject）：源科目调减、目标科目调增，两者金额可以不相等
 *   （如修正重复计算时只减不增），公司总额可能变化，须填写调整原因留痕。
 * - 科目树换父见 DataService.reclassifySubject。
 * 每次操作写 ReclassificationLog + 审计日志；相关公司须在操作者数据范围内（scope 守卫）。
 * 汇总主体与 YTD 累计均为查询时实时派生，事实行变更后自动生效，无需物化重算。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'>
type TemplateType = 'operating' | 'static' | 'budget'
type TransferMode = 'all' | 'ratio' | 'amount'

interface AuditCtx { userId: string; traceId?: string }

export interface ReclassifyCompanyParams {
  templateType: TemplateType
  sourceCompanyCode: string
  targetCompanyCode: string
  accountCodes?: string[]
  periodFrom?: string
  periodTo?: string
  /** 转移方式：all=整行迁移（默认）；ratio=按比例部分转移；amount=按金额部分转移 */
  transferMode?: TransferMode
  /** ratio 模式必填：0 < ratio <= 1 */
  ratio?: number
  /** amount 模式必填：> 0 */
  amount?: number
}

export interface PreviewResult {
  affectedRows: number
  totalValue: number
  transferValue: number
  conflictRows: number
  createRows: number
}

export interface AdjustSubjectParams {
  templateType: TemplateType
  companyCode: string
  sourceAccountCode: string
  /** 可选：不传即纯调减（如修正重复计算） */
  targetAccountCode?: string
  decreaseAmount: number
  /** 可与 decreaseAmount 不相等，公司总额随净差变化 */
  increaseAmount?: number
  periodFrom?: string
  periodTo?: string
  reason: string
}

export interface AdjustSubjectPreview {
  affectedRows: number
  sourceTotal: number
  decreaseAmount: number
  increaseAmount: number
  netChange: number
}

const num = (v: unknown): number => Number(String(v ?? 0))
const round2 = (v: number): number => Math.round(v * 100) / 100

function monthStart(ym: string): Date {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1))
}
function monthEnd(ym: string): Date {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
}

async function activeBatchIds(templateType: TemplateType): Promise<string[]> {
  const batches = await prisma.importBatch.findMany({
    where: { dataType: templateType, lifecycleStatus: 'active' },
    select: { id: true },
  })
  return batches.map((b) => b.id)
}

/** scope 守卫：涉及公司均须在操作者数据范围内 */
async function assertCompaniesInScope(scope: Scope, codes: string[]): Promise<void> {
  const allowed = new Set(await resolveCompanyCodes(scope))
  for (const c of codes) {
    if (!allowed.has(c)) throw errors.forbidden(`公司 ${c} 不在您的数据范围内，无法重分类`)
  }
}

async function validateCompanies(source: string, target: string): Promise<void> {
  if (source === target) throw errors.badRequest('源公司与目标公司不能相同')
  const found = await prisma.company.findMany({ where: { code: { in: [source, target] } }, select: { code: true } })
  if (found.length < 2) throw errors.badRequest('源公司或目标公司不存在')
}

function validateTransferParams(p: ReclassifyCompanyParams): TransferMode {
  const mode = p.transferMode ?? 'all'
  if (mode === 'ratio') {
    if (typeof p.ratio !== 'number' || !Number.isFinite(p.ratio) || p.ratio <= 0 || p.ratio > 1) {
      throw errors.badRequest('比例模式下 ratio 必须为 (0, 1] 之间的数值')
    }
  }
  if (mode === 'amount') {
    if (typeof p.amount !== 'number' || !Number.isFinite(p.amount) || p.amount <= 0) {
      throw errors.badRequest('金额模式下 amount 必须为大于 0 的数值')
    }
  }
  return mode
}

/** 科目校验：静态模板对应静态科目，其余对应经营科目 */
async function validateSubjects(templateType: TemplateType, source: string, target?: string): Promise<void> {
  if (target && source === target) throw errors.badRequest('源科目与目标科目不能相同')
  const subjectType = templateType === 'static' ? 'static' : 'operating'
  const codes = target ? [source, target] : [source]
  const found = await prisma.accountSubject.findMany({ where: { code: { in: codes }, subjectType }, select: { code: true } })
  const foundSet = new Set(found.map((s) => s.code))
  if (!foundSet.has(source)) throw errors.badRequest('源科目不存在')
  if (target && !foundSet.has(target)) throw errors.badRequest('目标科目不存在')
}

// ---- 各事实表的 where 构造、期间键与新建行数据 ----

interface FactFilter { accountCodes?: string[]; periodFrom?: string; periodTo?: string }

interface Row { id: string; value: unknown; accountCode: string; periodDimCode?: string; batchId: string; period?: string; fiscalYear?: string; snapshotDate?: Date }
type Delegate = {
  findMany: (args: { where: Record<string, unknown> }) => Promise<Row[]>
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
  delete: (args: { where: { id: string } }) => Promise<unknown>
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>
}

interface TableOps {
  delegate: Delegate
  where: (f: FactFilter, batchIds: string[], companyCode: string) => Record<string, unknown>
  /** 期间键：不含公司/科目（同科目跨公司或同公司跨科目匹配用） */
  periodKeyOf: (r: Row) => string
  /** 以源行为模板构造新事实行（公司/科目/金额可替换） */
  createData: (r: Row, companyCode: string, accountCode: string, value: number) => Record<string, unknown>
}

function operatingWhere(f: FactFilter, batchIds: string[], companyCode: string): Record<string, unknown> {
  const where: Record<string, unknown> = { batchId: { in: batchIds }, companyCode }
  if (f.accountCodes && f.accountCodes.length > 0) where.accountCode = { in: f.accountCodes }
  const period: Record<string, string> = {}
  if (f.periodFrom) period.gte = f.periodFrom
  if (f.periodTo) period.lte = f.periodTo
  if (Object.keys(period).length > 0) where.period = period
  return where
}

function staticWhere(f: FactFilter, batchIds: string[], companyCode: string): Record<string, unknown> {
  const where: Record<string, unknown> = { batchId: { in: batchIds }, companyCode }
  if (f.accountCodes && f.accountCodes.length > 0) where.accountCode = { in: f.accountCodes }
  const snap: Record<string, Date> = {}
  if (f.periodFrom) snap.gte = monthStart(f.periodFrom)
  if (f.periodTo) snap.lte = monthEnd(f.periodTo)
  if (Object.keys(snap).length > 0) where.snapshotDate = snap
  return where
}

function budgetWhere(f: FactFilter, batchIds: string[], companyCode: string): Record<string, unknown> {
  const where: Record<string, unknown> = { batchId: { in: batchIds }, companyCode }
  if (f.accountCodes && f.accountCodes.length > 0) where.accountCode = { in: f.accountCodes }
  const period: Record<string, string> = {}
  if (f.periodFrom) period.gte = f.periodFrom
  if (f.periodTo) period.lte = f.periodTo
  if (Object.keys(period).length > 0) where.period = period
  return where
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tableOps(db: any, templateType: TemplateType): TableOps {
  if (templateType === 'operating') {
    return {
      delegate: db.factOperating as Delegate,
      where: operatingWhere,
      periodKeyOf: (r) => `${r.period}|${r.periodDimCode}|${r.batchId}`,
      createData: (r, companyCode, accountCode, value) => ({
        batchId: r.batchId, companyCode, accountCode, period: r.period, periodDimCode: r.periodDimCode, fiscalYear: r.fiscalYear, value,
      }),
    }
  }
  if (templateType === 'static') {
    return {
      delegate: db.factStatic as Delegate,
      where: staticWhere,
      periodKeyOf: (r) => `${r.snapshotDate?.toISOString()}|${r.periodDimCode}|${r.batchId}`,
      createData: (r, companyCode, accountCode, value) => ({
        batchId: r.batchId, companyCode, accountCode, snapshotDate: r.snapshotDate, periodDimCode: r.periodDimCode, fiscalYear: r.fiscalYear, value,
      }),
    }
  }
  return {
    delegate: db.factBudget as Delegate,
    where: budgetWhere,
    periodKeyOf: (r) => `${r.fiscalYear}|${r.period}|${r.batchId}`,
    createData: (r, companyCode, accountCode, value) => ({
      batchId: r.batchId, companyCode, accountCode, fiscalYear: r.fiscalYear, period: r.period, value,
    }),
  }
}

/** 跨公司匹配键：科目 + 期间键 */
const companyKeyOf = (ops: TableOps) => (r: Row) => `${r.accountCode}|${ops.periodKeyOf(r)}`

// ---- 金额分摊（分为单位整数运算，避免浮点误差）----

/**
 * 按各行 value 占比分摊 amount，尾差在有容量的行间微调，
 * 保证 sum(结果) === amount 且每行分摊额不超过该行 value。
 */
function allocateAmount(values: number[], amount: number): number[] {
  const cents = values.map((v) => Math.round(v * 100))
  if (cents.some((c) => c < 0)) throw errors.badRequest('筛选范围内存在负值明细，请改用比例模式或缩小筛选范围')
  const total = cents.reduce((s, c) => s + c, 0)
  let amt = Math.round(amount * 100)
  if (amt > total) throw errors.badRequest(`转移/调整金额不能超过源数据合计 ${round2(total / 100)}`)
  const xs = cents.map((c) => Math.min(c, Math.round((amt * c) / (total || 1))))
  let diff = amt - xs.reduce((s, x) => s + x, 0)
  for (let i = 0; i < xs.length && diff !== 0; i++) {
    if (diff > 0) {
      const add = Math.min(cents[i] - xs[i], diff)
      xs[i] += add
      diff -= add
    } else {
      const sub = Math.min(xs[i], -diff)
      xs[i] -= sub
      diff += sub
    }
  }
  return xs.map((x) => x / 100)
}

/** 按权重占比分摊 amount（无上限约束），尾差落在首个非零权重行 */
function allocateByWeights(weights: number[], amount: number): number[] {
  const w = weights.map((v) => Math.round(v * 100))
  const total = w.reduce((s, c) => s + c, 0)
  const amt = Math.round(amount * 100)
  if (total <= 0) throw errors.badRequest('无有效分摊权重')
  const xs = w.map((c) => Math.round((amt * c) / total))
  let diff = amt - xs.reduce((s, x) => s + x, 0)
  for (let i = 0; i < xs.length && diff !== 0; i++) {
    if (w[i] > 0) {
      xs[i] += diff
      diff = 0
    }
  }
  return xs.map((x) => x / 100)
}

/** 计算每条源行的计划转移额 */
function planTransfers(sourceRows: Row[], mode: TransferMode, ratio?: number, amount?: number): number[] {
  const values = sourceRows.map((r) => num(r.value))
  if (mode === 'all') return values
  if (mode === 'ratio') return values.map((v) => round2(v * (ratio as number)))
  return allocateAmount(values, amount as number)
}

// ---- 跨公司重分类 ----

async function previewCompanyTable(ops: TableOps, p: ReclassifyCompanyParams, batchIds: string[], mode: TransferMode): Promise<PreviewResult> {
  const filter: FactFilter = { accountCodes: p.accountCodes, periodFrom: p.periodFrom, periodTo: p.periodTo }
  const sourceRows = await ops.delegate.findMany({ where: ops.where(filter, batchIds, p.sourceCompanyCode) })
  const targetRows = await ops.delegate.findMany({ where: ops.where(filter, batchIds, p.targetCompanyCode) })
  const keyOf = companyKeyOf(ops)
  const targetKeys = new Set(targetRows.map(keyOf))
  const xs = sourceRows.length > 0 ? planTransfers(sourceRows, mode, p.ratio, p.amount) : []
  let totalValue = 0
  let transferValue = 0
  let conflictRows = 0
  let createRows = 0
  for (let i = 0; i < sourceRows.length; i++) {
    totalValue += num(sourceRows[i].value)
    if (xs[i] === 0) continue
    transferValue += xs[i]
    if (targetKeys.has(keyOf(sourceRows[i]))) conflictRows++
    else createRows++
  }
  return {
    affectedRows: sourceRows.length,
    totalValue: round2(totalValue),
    transferValue: round2(transferValue),
    conflictRows,
    createRows,
  }
}

interface TransferResult { affected: number; merged: number; created: number; transferValue: number }

/** all 模式：整行改挂目标公司，冲突时合并求和并删除源行 */
async function transferAll(ops: TableOps, sourceRows: Row[], targetRows: Row[], targetCompanyCode: string): Promise<TransferResult> {
  const keyOf = companyKeyOf(ops)
  const targetByKey = new Map(targetRows.map((r) => [keyOf(r), r]))
  let affected = 0
  let merged = 0
  let transferValue = 0
  for (const s of sourceRows) {
    const t = targetByKey.get(keyOf(s))
    if (t) {
      // 合并求和：目标行值累加，删除源行
      await ops.delegate.update({ where: { id: t.id }, data: { value: round2(num(t.value) + num(s.value)) } })
      await ops.delegate.delete({ where: { id: s.id } })
      merged++
    } else {
      await ops.delegate.update({ where: { id: s.id }, data: { companyCode: targetCompanyCode } })
    }
    transferValue += num(s.value)
    affected++
  }
  return { affected, merged, created: affected - merged, transferValue: round2(transferValue) }
}

/** ratio/amount 模式：源行调减（保留，即使为 0），目标同键行调增，无则新建 */
async function transferPartial(ops: TableOps, sourceRows: Row[], xs: number[], targetRows: Row[], targetCompanyCode: string): Promise<TransferResult> {
  const keyOf = companyKeyOf(ops)
  const targetByKey = new Map(targetRows.map((r) => [keyOf(r), r]))
  let affected = 0
  let merged = 0
  let created = 0
  let transferValue = 0
  for (let i = 0; i < sourceRows.length; i++) {
    const x = xs[i]
    if (x === 0) continue
    const s = sourceRows[i]
    await ops.delegate.update({ where: { id: s.id }, data: { value: round2(num(s.value) - x) } })
    const t = targetByKey.get(keyOf(s))
    if (t) {
      await ops.delegate.update({ where: { id: t.id }, data: { value: round2(num(t.value) + x) } })
      merged++
    } else {
      await ops.delegate.create({ data: ops.createData(s, targetCompanyCode, s.accountCode, x) })
      created++
    }
    transferValue += x
    affected++
  }
  return { affected, merged, created, transferValue: round2(transferValue) }
}

// ---- 同公司科目间调整 ----

interface AdjustResult { affected: number; merged: number; created: number; decreased: number; increased: number }

async function adjustSubjectInTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  p: AdjustSubjectParams,
  batchIds: string[],
): Promise<AdjustResult> {
  const ops = tableOps(tx, p.templateType)
  const periodFilter = { periodFrom: p.periodFrom, periodTo: p.periodTo }
  const sourceRows = await ops.delegate.findMany({ where: ops.where({ ...periodFilter, accountCodes: [p.sourceAccountCode] }, batchIds, p.companyCode) })
  if (sourceRows.length === 0) throw errors.conflict('没有符合筛选条件的可调整数据')

  // 调减：按源行 value 占比分摊，分为单位运算保证合计恰等于 decreaseAmount
  const decXs = allocateAmount(sourceRows.map((r) => num(r.value)), p.decreaseAmount)
  let affected = 0
  let decreased = 0
  for (let i = 0; i < sourceRows.length; i++) {
    if (decXs[i] === 0) continue
    await ops.delegate.update({ where: { id: sourceRows[i].id }, data: { value: round2(num(sourceRows[i].value) - decXs[i]) } })
    decreased += decXs[i]
    affected++
  }

  // 调增：按调减的期间分布同比例分摊到目标科目（存在累加、不存在新建）
  let merged = 0
  let created = 0
  let increased = 0
  const increaseAmount = p.increaseAmount ?? 0
  if (p.targetAccountCode && increaseAmount > 0) {
    const targetRows = await ops.delegate.findMany({ where: ops.where({ ...periodFilter, accountCodes: [p.targetAccountCode] }, batchIds, p.companyCode) })
    const targetByKey = new Map(targetRows.map((r) => [ops.periodKeyOf(r), r]))
    const incXs = allocateByWeights(decXs, increaseAmount)
    for (let i = 0; i < sourceRows.length; i++) {
      const x = incXs[i]
      if (x === 0) continue
      const t = targetByKey.get(ops.periodKeyOf(sourceRows[i]))
      if (t) {
        await ops.delegate.update({ where: { id: t.id }, data: { value: round2(num(t.value) + x) } })
        merged++
      } else {
        await ops.delegate.create({ data: ops.createData(sourceRows[i], p.companyCode, p.targetAccountCode, x) })
        created++
      }
      increased += x
    }
  }
  return { affected, merged, created, decreased: round2(decreased), increased: round2(increased) }
}

function validateAdjustParams(p: AdjustSubjectParams): void {
  if (typeof p.decreaseAmount !== 'number' || !Number.isFinite(p.decreaseAmount) || p.decreaseAmount <= 0) {
    throw errors.badRequest('调减金额必须为大于 0 的数值')
  }
  if (p.increaseAmount !== undefined) {
    if (typeof p.increaseAmount !== 'number' || !Number.isFinite(p.increaseAmount) || p.increaseAmount < 0) {
      throw errors.badRequest('调增金额必须为大于等于 0 的数值')
    }
    if (p.increaseAmount > 0 && !p.targetAccountCode) throw errors.badRequest('调增金额大于 0 时必须选择目标科目')
  }
}

async function validateCompanyExists(code: string): Promise<void> {
  const found = await prisma.company.findUnique({ where: { code }, select: { code: true } })
  if (!found) throw errors.badRequest('公司不存在')
}

export const ReclassificationService = {
  async previewCompany(params: ReclassifyCompanyParams, scope: Scope): Promise<PreviewResult> {
    const mode = validateTransferParams(params)
    await validateCompanies(params.sourceCompanyCode, params.targetCompanyCode)
    await assertCompaniesInScope(scope, [params.sourceCompanyCode, params.targetCompanyCode])
    const batchIds = await activeBatchIds(params.templateType)
    if (batchIds.length === 0) return { affectedRows: 0, totalValue: 0, transferValue: 0, conflictRows: 0, createRows: 0 }
    return previewCompanyTable(tableOps(prisma, params.templateType), params, batchIds, mode)
  },

  async reclassifyCompany(
    params: ReclassifyCompanyParams,
    scope: Scope,
    ctx: AuditCtx,
  ): Promise<{ affectedRows: number; mergedRows: number; createdRows: number; transferValue: number }> {
    const mode = validateTransferParams(params)
    await validateCompanies(params.sourceCompanyCode, params.targetCompanyCode)
    await assertCompaniesInScope(scope, [params.sourceCompanyCode, params.targetCompanyCode])
    const batchIds = await activeBatchIds(params.templateType)
    if (batchIds.length === 0) throw errors.conflict('该模板类型暂无生效批次，无可重分类数据')

    const result = await prisma.$transaction(async (tx) => {
      const ops = tableOps(tx, params.templateType)
      const filter: FactFilter = { accountCodes: params.accountCodes, periodFrom: params.periodFrom, periodTo: params.periodTo }
      const sourceRows = await ops.delegate.findMany({ where: ops.where(filter, batchIds, params.sourceCompanyCode) })
      if (sourceRows.length === 0) throw errors.conflict('没有符合筛选条件的可重分类数据')
      const targetRows = await ops.delegate.findMany({ where: ops.where(filter, batchIds, params.targetCompanyCode) })
      if (mode === 'all') return transferAll(ops, sourceRows, targetRows, params.targetCompanyCode)
      const xs = planTransfers(sourceRows, mode, params.ratio, params.amount)
      return transferPartial(ops, sourceRows, xs, targetRows, params.targetCompanyCode)
    })
    if (result.affected === 0) throw errors.conflict('没有符合筛选条件的可重分类数据')

    await prisma.reclassificationLog.create({
      data: {
        type: 'company',
        templateType: params.templateType,
        sourceCompany: params.sourceCompanyCode,
        targetCompany: params.targetCompanyCode,
        periodFrom: params.periodFrom ?? null,
        periodTo: params.periodTo ?? null,
        affectedRows: result.affected,
        operatedBy: ctx.userId,
        detail: {
          transferMode: mode,
          ratio: params.ratio ?? null,
          amount: params.amount ?? null,
          transferValue: result.transferValue,
          mergedRows: result.merged,
          createdRows: result.created,
          accountCodes: params.accountCodes ?? null,
        } as never,
      },
    })
    await recordAudit(
      {
        userId: ctx.userId,
        module: 'data',
        action: 'reclassify',
        targetId: `${params.sourceCompanyCode}->${params.targetCompanyCode}`,
        detail: {
          kind: 'company',
          templateType: params.templateType,
          transferMode: mode,
          transferValue: result.transferValue,
          affectedRows: result.affected,
          mergedRows: result.merged,
          createdRows: result.created,
        },
      },
      ctx.traceId,
    )
    return { affectedRows: result.affected, mergedRows: result.merged, createdRows: result.created, transferValue: result.transferValue }
  },

  async previewAdjustSubject(params: AdjustSubjectParams, scope: Scope): Promise<AdjustSubjectPreview> {
    validateAdjustParams(params)
    await validateCompanyExists(params.companyCode)
    await assertCompaniesInScope(scope, [params.companyCode])
    await validateSubjects(params.templateType, params.sourceAccountCode, params.targetAccountCode)
    const increaseAmount = params.increaseAmount ?? 0
    const netChange = round2(increaseAmount - params.decreaseAmount)
    const batchIds = await activeBatchIds(params.templateType)
    if (batchIds.length === 0) {
      return { affectedRows: 0, sourceTotal: 0, decreaseAmount: params.decreaseAmount, increaseAmount, netChange }
    }
    const ops = tableOps(prisma, params.templateType)
    const sourceRows = await ops.delegate.findMany({
      where: ops.where({ accountCodes: [params.sourceAccountCode], periodFrom: params.periodFrom, periodTo: params.periodTo }, batchIds, params.companyCode),
    })
    const sourceTotal = round2(sourceRows.reduce((s, r) => s + num(r.value), 0))
    if (sourceRows.length > 0 && params.decreaseAmount > sourceTotal) {
      throw errors.badRequest(`调减金额不能超过源科目合计 ${sourceTotal}`)
    }
    return { affectedRows: sourceRows.length, sourceTotal, decreaseAmount: params.decreaseAmount, increaseAmount, netChange }
  },

  async adjustSubject(
    params: AdjustSubjectParams,
    scope: Scope,
    ctx: AuditCtx,
  ): Promise<{ affectedRows: number; decreaseAmount: number; increaseAmount: number; netChange: number; mergedRows: number; createdRows: number }> {
    validateAdjustParams(params)
    if (!params.reason || !params.reason.trim()) throw errors.badRequest('请填写调整原因')
    await validateCompanyExists(params.companyCode)
    await assertCompaniesInScope(scope, [params.companyCode])
    await validateSubjects(params.templateType, params.sourceAccountCode, params.targetAccountCode)
    const batchIds = await activeBatchIds(params.templateType)
    if (batchIds.length === 0) throw errors.conflict('该模板类型暂无生效批次，无可调整数据')

    const result = await prisma.$transaction(async (tx) => adjustSubjectInTx(tx, params, batchIds))
    const netChange = round2(result.increased - result.decreased)

    await prisma.reclassificationLog.create({
      data: {
        type: 'subject_adjust',
        templateType: params.templateType,
        sourceCompany: params.companyCode,
        sourceSubject: params.sourceAccountCode,
        targetSubject: params.targetAccountCode ?? null,
        periodFrom: params.periodFrom ?? null,
        periodTo: params.periodTo ?? null,
        affectedRows: result.affected,
        operatedBy: ctx.userId,
        detail: {
          decreaseAmount: result.decreased,
          increaseAmount: result.increased,
          netChange,
          reason: params.reason.trim(),
          mergedRows: result.merged,
          createdRows: result.created,
        } as never,
      },
    })
    await recordAudit(
      {
        userId: ctx.userId,
        module: 'data',
        action: 'reclassify',
        targetId: `${params.companyCode}:${params.sourceAccountCode}->${params.targetAccountCode ?? '(仅调减)'}`,
        detail: {
          kind: 'subject_adjust',
          templateType: params.templateType,
          decreaseAmount: result.decreased,
          increaseAmount: result.increased,
          netChange,
          reason: params.reason.trim(),
          affectedRows: result.affected,
        },
      },
      ctx.traceId,
    )
    return {
      affectedRows: result.affected,
      decreaseAmount: result.decreased,
      increaseAmount: result.increased,
      netChange,
      mergedRows: result.merged,
      createdRows: result.created,
    }
  },

  async listLogs(params: { page: number; pageSize: number; type?: string }) {
    const where: Record<string, unknown> = {}
    if (params.type) where.type = params.type
    const [rows, total] = await Promise.all([
      prisma.reclassificationLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
      prisma.reclassificationLog.count({ where }),
    ])
    const userIds = [...new Set(rows.map((r) => r.operatedBy).filter(Boolean))]
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
    const nameMap = new Map(users.map((u) => [u.id, u.username]))
    const items = rows.map((r) => ({
      id: r.id,
      type: r.type,
      templateType: r.templateType,
      sourceCompany: r.sourceCompany,
      targetCompany: r.targetCompany,
      sourceSubject: r.sourceSubject,
      targetSubject: r.targetSubject,
      periodFrom: r.periodFrom,
      periodTo: r.periodTo,
      affectedRows: r.affectedRows,
      operator: nameMap.get(r.operatedBy) ?? r.operatedBy,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    }))
    return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },
}
