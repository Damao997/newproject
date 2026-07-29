import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { resolveCompanyCodes } from './AggregationService'
import { fiscalYearLabel } from '../lib/period'
import type { AuthUserContext } from '../types/express'

/**
 * 数据重分类服务：
 * - 跨公司重分类：支持三种转移方式（transferMode）——
 *   all：整行改挂目标公司，同唯一键行合并求和（值相加、删除源行），合计不变；
 *   ratio/amount：部分金额转移，源行 value 调减（行保留），目标公司同唯一键行调增，
 *   无对应行则新建，转移合计恰等于计划金额，总额守恒。
 * - 同公司科目间调整（adjustSubject）：支持三种调整方式（adjustMode）——
 *   both：源科目调减 + 目标科目调增，两者金额可以不相等；
 *   decrease：仅调减源科目（如修正重复计算）；increase：仅调增目标科目（如补录遗漏）。
 *   公司总额随净差变化，须填写调整原因留痕。金额单位与事实表一致（万元）。
 * - 期间口径：均按单月（period 必填 YYYY-MM）调整；预算模板按期间所属财年匹配。
 * - 科目树换父见 DataService.reclassifySubject。
 * 每次操作写 ReclassificationLog（含行级快照 snapshot，支持 revertLog 撤销）+ 审计日志；
 * 相关公司须在操作者数据范围内（scope 守卫）。
 * 汇总主体与 YTD 累计均为查询时实时派生，事实行变更后自动生效，无需物化重算。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & { dataScopeCodes?: string[] | null }
type TemplateType = 'operating' | 'static' | 'budget'
type TransferMode = 'all' | 'ratio' | 'amount'
export type AdjustMode = 'both' | 'decrease' | 'increase'
type SubjectValueType = 'amount' | 'quantity' | 'ratio'

interface AuditCtx { userId: string; traceId?: string }

export interface ReclassifyCompanyParams {
  templateType: TemplateType
  sourceCompanyCode: string
  targetCompanyCode: string
  accountCodes?: string[]
  /** 调整期间（单月 YYYY-MM，必填）；预算模板按期所属财年匹配 */
  period: string
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
  /** 调整方式：both=调减+调增；decrease=仅调减；increase=仅调增。未传按旧参数推断（兼容） */
  adjustMode?: AdjustMode
  /** decrease/both 模式必填 */
  sourceAccountCode?: string
  /** increase/both 模式必填 */
  targetAccountCode?: string
  /** decrease/both 模式必填（万元） */
  decreaseAmount?: number
  /** increase/both 模式必填（万元）；可与 decreaseAmount 不相等，公司总额随净差变化 */
  increaseAmount?: number
  /** 调整期间（单月 YYYY-MM，必填）；预算模板按期所属财年匹配 */
  period: string
  reason: string
}

export interface AdjustSubjectPreview {
  affectedRows: number
  sourceTotal: number
  /** increase 模式：目标科目现有合计（万元/数量） */
  targetTotal?: number
  decreaseAmount: number
  increaseAmount: number
  netChange: number
  /** 调整口径值类型（取源科目；increase 模式取目标科目），供前端分型格式化 */
  valueType: SubjectValueType
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

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** 单月期间校验并构造期间过滤器：经营/静态按单月精确匹配，预算按期所属财年匹配 */
function periodFilterOf(templateType: TemplateType, period: string): FactFilter {
  if (typeof period !== 'string' || !PERIOD_RE.test(period)) {
    throw errors.badRequest('请选择调整期间（单月 YYYY-MM）')
  }
  if (templateType === 'budget') return { fiscalYear: fiscalYearLabel(period) }
  return { periodFrom: period, periodTo: period }
}

/**
 * 科目间调整专用校验：存在性 + 值类型规则，返回调整口径的 valueType。
 * - 比率类科目由公式计算，禁止直接调增调减；
 * - both 模式源/目标值类型必须一致（金额↔金额、数量↔数量）；
 * - 口径 valueType：decrease/both 取源科目，increase 取目标科目。
 */
async function loadAndValidateAdjustSubjects(templateType: TemplateType, mode: AdjustMode, source?: string, target?: string): Promise<SubjectValueType> {
  if (source && target && source === target) throw errors.badRequest('源科目与目标科目不能相同')
  const subjectType = templateType === 'static' ? 'static' : 'operating'
  const codes = [source, target].filter(Boolean) as string[]
  const found = await prisma.accountSubject.findMany({ where: { code: { in: codes }, subjectType }, select: { code: true, valueType: true } })
  const byCode = new Map(found.map((s) => [s.code, s.valueType as SubjectValueType]))
  if (source && !byCode.has(source)) throw errors.badRequest('源科目不存在')
  if (target && !byCode.has(target)) throw errors.badRequest('目标科目不存在')
  const sourceVt = source ? byCode.get(source) : undefined
  const targetVt = target ? byCode.get(target) : undefined
  if (sourceVt === 'ratio' || targetVt === 'ratio') throw errors.badRequest('比率类科目由公式计算，不支持金额调整')
  if (mode === 'both' && sourceVt && targetVt && sourceVt !== targetVt) {
    throw errors.badRequest('源科目与目标科目的值类型必须一致（金额/数量）')
  }
  return (mode === 'increase' ? targetVt : sourceVt) ?? 'amount'
}

// ---- 各事实表的 where 构造、期间键与新建行数据 ----

interface FactFilter { accountCodes?: string[]; periodFrom?: string; periodTo?: string; fiscalYear?: string }

interface Row { id: string; value: unknown; accountCode: string; periodDimCode?: string; batchId: string; period?: string; fiscalYear?: string; snapshotDate?: Date }
type Delegate = {
  findMany: (args: { where: Record<string, unknown> }) => Promise<Row[]>
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
  delete: (args: { where: { id: string } }) => Promise<unknown>
  create: (args: { data: Record<string, unknown> }) => Promise<Row>
}

/** 行级快照：随日志 detail 持久化，撤销时按其逆向恢复 */
interface RowSnapshot {
  /** 更新行：id → 调整前字段值（撤销时回写） */
  updated: { id: string; data: Record<string, unknown> }[]
  /** 新建行 id（撤销时删除） */
  created: string[]
  /** 删除行完整数据（撤销时重建） */
  deleted: Record<string, unknown>[]
}

function emptySnapshot(): RowSnapshot {
  return { updated: [], created: [], deleted: [] }
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
  if (f.fiscalYear) where.fiscalYear = f.fiscalYear
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

// ---- 金额/数量分摊（按最小单位整数运算，避免浮点误差；金额 unit=100 分为单位，数量 unit=1 整数单位）----

/**
 * 按各行 value 占比分摊 amount，尾差在有容量的行间微调，
 * 保证 sum(结果) === amount 且每行分摊额不超过该行 value。
 */
function allocateAmount(values: number[], amount: number, unit = 100): number[] {
  const cents = values.map((v) => Math.round(v * unit))
  if (cents.some((c) => c < 0)) throw errors.badRequest('筛选范围内存在负值明细，请改用比例模式或缩小筛选范围')
  const total = cents.reduce((s, c) => s + c, 0)
  let amt = Math.round(amount * unit)
  if (amt > total) throw errors.badRequest(`转移/调整金额不能超过源数据合计 ${round2(total / unit)}${unit === 100 ? ' 万元' : ''}`)
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
  return xs.map((x) => x / unit)
}

/** 按权重占比分摊 amount（无上限约束），尾差落在首个非零权重行 */
function allocateByWeights(weights: number[], amount: number, unit = 100): number[] {
  const w = weights.map((v) => Math.round(v * unit))
  const total = w.reduce((s, c) => s + c, 0)
  const amt = Math.round(amount * unit)
  if (total <= 0) throw errors.badRequest('无有效分摊权重')
  const xs = w.map((c) => Math.round((amt * c) / total))
  let diff = amt - xs.reduce((s, x) => s + x, 0)
  for (let i = 0; i < xs.length && diff !== 0; i++) {
    if (w[i] > 0) {
      xs[i] += diff
      diff = 0
    }
  }
  return xs.map((x) => x / unit)
}

/** 计算每条源行的计划转移额 */
function planTransfers(sourceRows: Row[], mode: TransferMode, ratio?: number, amount?: number): number[] {
  const values = sourceRows.map((r) => num(r.value))
  if (mode === 'all') return values
  if (mode === 'ratio') return values.map((v) => round2(v * (ratio as number)))
  return allocateAmount(values, amount as number)
}

// ---- 跨公司重分类 ----

async function previewCompanyTable(ops: TableOps, p: ReclassifyCompanyParams, filter: FactFilter, batchIds: string[], mode: TransferMode): Promise<PreviewResult> {
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

interface TransferResult { affected: number; merged: number; created: number; transferValue: number; snapshot: RowSnapshot }

/** all 模式：整行改挂目标公司，冲突时合并求和并删除源行；全程记录行级快照供撤销 */
async function transferAll(ops: TableOps, sourceRows: Row[], targetRows: Row[], sourceCompanyCode: string, targetCompanyCode: string): Promise<TransferResult> {
  const keyOf = companyKeyOf(ops)
  const targetByKey = new Map(targetRows.map((r) => [keyOf(r), r]))
  const snapshot = emptySnapshot()
  let affected = 0
  let merged = 0
  let transferValue = 0
  for (const s of sourceRows) {
    const t = targetByKey.get(keyOf(s))
    if (t) {
      // 合并求和：目标行值累加，删除源行
      snapshot.updated.push({ id: t.id, data: { value: num(t.value) } })
      snapshot.deleted.push(ops.createData(s, sourceCompanyCode, s.accountCode, num(s.value)))
      await ops.delegate.update({ where: { id: t.id }, data: { value: round2(num(t.value) + num(s.value)) } })
      await ops.delegate.delete({ where: { id: s.id } })
      merged++
    } else {
      snapshot.updated.push({ id: s.id, data: { companyCode: sourceCompanyCode } })
      await ops.delegate.update({ where: { id: s.id }, data: { companyCode: targetCompanyCode } })
    }
    transferValue += num(s.value)
    affected++
  }
  return { affected, merged, created: affected - merged, transferValue: round2(transferValue), snapshot }
}

/** ratio/amount 模式：源行调减（保留，即使为 0），目标同键行调增，无则新建；全程记录行级快照供撤销 */
async function transferPartial(ops: TableOps, sourceRows: Row[], xs: number[], targetRows: Row[], targetCompanyCode: string): Promise<TransferResult> {
  const keyOf = companyKeyOf(ops)
  const targetByKey = new Map(targetRows.map((r) => [keyOf(r), r]))
  const snapshot = emptySnapshot()
  let affected = 0
  let merged = 0
  let created = 0
  let transferValue = 0
  for (let i = 0; i < sourceRows.length; i++) {
    const x = xs[i]
    if (x === 0) continue
    const s = sourceRows[i]
    snapshot.updated.push({ id: s.id, data: { value: num(s.value) } })
    await ops.delegate.update({ where: { id: s.id }, data: { value: round2(num(s.value) - x) } })
    const t = targetByKey.get(keyOf(s))
    if (t) {
      snapshot.updated.push({ id: t.id, data: { value: num(t.value) } })
      await ops.delegate.update({ where: { id: t.id }, data: { value: round2(num(t.value) + x) } })
      merged++
    } else {
      const createdRow = await ops.delegate.create({ data: ops.createData(s, targetCompanyCode, s.accountCode, x) })
      snapshot.created.push(createdRow.id)
      created++
    }
    transferValue += x
    affected++
  }
  return { affected, merged, created, transferValue: round2(transferValue), snapshot }
}

// ---- 同公司科目间调整 ----

interface AdjustResult { affected: number; merged: number; created: number; decreased: number; increased: number; snapshot: RowSnapshot }

async function adjustSubjectInTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  p: AdjustSubjectParams,
  mode: AdjustMode,
  valueType: SubjectValueType,
  periodFilter: FactFilter,
  batchIds: string[],
): Promise<AdjustResult> {
  const ops = tableOps(tx, p.templateType)
  // 分摊最小单位：金额按分（两位小数），数量按整数
  const unit = valueType === 'quantity' ? 1 : 100
  const snapshot = emptySnapshot()
  let affected = 0
  let decreased = 0
  let merged = 0
  let created = 0
  let increased = 0

  // 调减侧（decrease/both）：按源行 value 占比分摊，分为单位运算保证合计恰等于 decreaseAmount
  let decXs: number[] = []
  let sourceRows: Row[] = []
  if (mode !== 'increase') {
    sourceRows = await ops.delegate.findMany({ where: ops.where({ ...periodFilter, accountCodes: [p.sourceAccountCode as string] }, batchIds, p.companyCode) })
    if (sourceRows.length === 0) throw errors.conflict('没有符合筛选条件的可调整数据')
    decXs = allocateAmount(sourceRows.map((r) => num(r.value)), p.decreaseAmount as number, unit)
    for (let i = 0; i < sourceRows.length; i++) {
      if (decXs[i] === 0) continue
      snapshot.updated.push({ id: sourceRows[i].id, data: { value: num(sourceRows[i].value) } })
      await ops.delegate.update({ where: { id: sourceRows[i].id }, data: { value: round2(num(sourceRows[i].value) - decXs[i]) } })
      decreased += decXs[i]
      affected++
    }
  }

  // 调增侧（both）：按调减的期间分布同比例分摊到目标科目（存在累加、不存在新建）
  const increaseAmount = p.increaseAmount ?? 0
  if (mode === 'both' && p.targetAccountCode && increaseAmount > 0) {
    const targetRows = await ops.delegate.findMany({ where: ops.where({ ...periodFilter, accountCodes: [p.targetAccountCode] }, batchIds, p.companyCode) })
    const targetByKey = new Map(targetRows.map((r) => [ops.periodKeyOf(r), r]))
    const incXs = allocateByWeights(decXs, increaseAmount, unit)
    for (let i = 0; i < sourceRows.length; i++) {
      const x = incXs[i]
      if (x === 0) continue
      const t = targetByKey.get(ops.periodKeyOf(sourceRows[i]))
      if (t) {
        snapshot.updated.push({ id: t.id, data: { value: num(t.value) } })
        await ops.delegate.update({ where: { id: t.id }, data: { value: round2(num(t.value) + x) } })
        merged++
      } else {
        const createdRow = await ops.delegate.create({ data: ops.createData(sourceRows[i], p.companyCode, p.targetAccountCode, x) })
        snapshot.created.push(createdRow.id)
        created++
      }
      increased += x
    }
  }

  // 仅调增（increase）：目标当期行存在则按各行 value 权重分摊累加（权重合计 ≤0 时全额落首行）；
  // 无目标行时取同公司同期任意事实行作模板新建（批次/期间维度/财年沿用模板行）
  if (mode === 'increase') {
    const amount = p.increaseAmount as number
    const target = p.targetAccountCode as string
    const targetRows = await ops.delegate.findMany({ where: ops.where({ ...periodFilter, accountCodes: [target] }, batchIds, p.companyCode) })
    if (targetRows.length > 0) {
      let incXs: number[]
      try {
        incXs = allocateByWeights(targetRows.map((r) => num(r.value)), amount, unit)
      } catch {
        incXs = targetRows.map((_, i) => (i === 0 ? amount : 0))
      }
      for (let i = 0; i < targetRows.length; i++) {
        const x = incXs[i]
        if (x === 0) continue
        snapshot.updated.push({ id: targetRows[i].id, data: { value: num(targetRows[i].value) } })
        await ops.delegate.update({ where: { id: targetRows[i].id }, data: { value: round2(num(targetRows[i].value) + x) } })
        merged++
        increased += x
        affected++
      }
    } else {
      const templateRows = await ops.delegate.findMany({ where: ops.where(periodFilter, batchIds, p.companyCode) })
      if (templateRows.length === 0) throw errors.conflict('该公司该期间暂无生效数据，无法调增')
      const createdRow = await ops.delegate.create({ data: ops.createData(templateRows[0], p.companyCode, target, amount) })
      snapshot.created.push(createdRow.id)
      created++
      increased += amount
      affected++
    }
  }
  return { affected, merged, created, decreased: round2(decreased), increased: round2(increased), snapshot }
}

/** 解析调整方式：未传时按旧参数推断（有调增侧为 both，否则仅调减），兼容历史调用 */
function resolveAdjustMode(p: AdjustSubjectParams): AdjustMode {
  if (p.adjustMode) {
    if (!['both', 'decrease', 'increase'].includes(p.adjustMode)) throw errors.badRequest('调整方式不合法')
    return p.adjustMode
  }
  if ((p.increaseAmount ?? 0) > 0) {
    if (!p.targetAccountCode) throw errors.badRequest('调增金额大于 0 时必须选择目标科目')
    return 'both'
  }
  return 'decrease'
}

function validateAmount(v: unknown, label: string, valueType: SubjectValueType): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw errors.badRequest(`${label}必须为大于 0 的数值${valueType === 'quantity' ? '' : '（万元）'}`)
  // 数量类科目按整数个口径调整，不允许小数
  if (valueType === 'quantity' && !Number.isInteger(v)) throw errors.badRequest(`${label}必须为大于 0 的整数（数量类科目）`)
}

/** 字段必填校验（不含金额分型规则，金额校验需先加载科目 valueType 后进行） */
function requireAdjustFields(p: AdjustSubjectParams, mode: AdjustMode): void {
  if (mode !== 'increase' && !p.sourceAccountCode) throw errors.badRequest('请选择源科目')
  if (mode !== 'decrease' && !p.targetAccountCode) throw errors.badRequest('请选择目标科目')
}

/** 金额/数量校验：按调整口径 valueType 分型（金额允许两位小数，数量要求正整数） */
function validateAdjustAmounts(p: AdjustSubjectParams, mode: AdjustMode, valueType: SubjectValueType): void {
  const label = valueType === 'quantity' ? '数量' : '金额'
  if (mode !== 'increase') validateAmount(p.decreaseAmount, `调减${label}`, valueType)
  if (mode !== 'decrease') validateAmount(p.increaseAmount, `调增${label}`, valueType)
}

async function validateCompanyExists(code: string): Promise<void> {
  const found = await prisma.company.findUnique({ where: { code }, select: { code: true } })
  if (!found) throw errors.badRequest('公司不存在')
}

export const ReclassificationService = {
  async previewCompany(params: ReclassifyCompanyParams, scope: Scope): Promise<PreviewResult> {
    const mode = validateTransferParams(params)
    const filter: FactFilter = { ...periodFilterOf(params.templateType, params.period), accountCodes: params.accountCodes }
    await validateCompanies(params.sourceCompanyCode, params.targetCompanyCode)
    await assertCompaniesInScope(scope, [params.sourceCompanyCode, params.targetCompanyCode])
    const batchIds = await activeBatchIds(params.templateType)
    if (batchIds.length === 0) return { affectedRows: 0, totalValue: 0, transferValue: 0, conflictRows: 0, createRows: 0 }
    return previewCompanyTable(tableOps(prisma, params.templateType), params, filter, batchIds, mode)
  },

  async reclassifyCompany(
    params: ReclassifyCompanyParams,
    scope: Scope,
    ctx: AuditCtx,
  ): Promise<{ affectedRows: number; mergedRows: number; createdRows: number; transferValue: number }> {
    const mode = validateTransferParams(params)
    const filter: FactFilter = { ...periodFilterOf(params.templateType, params.period), accountCodes: params.accountCodes }
    await validateCompanies(params.sourceCompanyCode, params.targetCompanyCode)
    await assertCompaniesInScope(scope, [params.sourceCompanyCode, params.targetCompanyCode])
    const batchIds = await activeBatchIds(params.templateType)
    if (batchIds.length === 0) throw errors.conflict('该模板类型暂无生效批次，无可重分类数据')

    const result = await prisma.$transaction(async (tx) => {
      const ops = tableOps(tx, params.templateType)
      const sourceRows = await ops.delegate.findMany({ where: ops.where(filter, batchIds, params.sourceCompanyCode) })
      if (sourceRows.length === 0) throw errors.conflict('没有符合筛选条件的可重分类数据')
      const targetRows = await ops.delegate.findMany({ where: ops.where(filter, batchIds, params.targetCompanyCode) })
      if (mode === 'all') return transferAll(ops, sourceRows, targetRows, params.sourceCompanyCode, params.targetCompanyCode)
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
        period: params.period,
        periodFrom: params.period,
        periodTo: params.period,
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
          snapshot: result.snapshot,
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
    const mode = resolveAdjustMode(params)
    requireAdjustFields(params, mode)
    const periodFilter = periodFilterOf(params.templateType, params.period)
    await validateCompanyExists(params.companyCode)
    await assertCompaniesInScope(scope, [params.companyCode])
    const valueType = await loadAndValidateAdjustSubjects(params.templateType, mode, mode === 'increase' ? undefined : params.sourceAccountCode, mode === 'decrease' ? undefined : params.targetAccountCode)
    validateAdjustAmounts(params, mode, valueType)
    const decreaseAmount = mode === 'increase' ? 0 : (params.decreaseAmount as number)
    const increaseAmount = mode === 'decrease' ? 0 : (params.increaseAmount as number)
    const netChange = round2(increaseAmount - decreaseAmount)
    const batchIds = await activeBatchIds(params.templateType)
    if (batchIds.length === 0) {
      return { affectedRows: 0, sourceTotal: 0, targetTotal: 0, decreaseAmount, increaseAmount, netChange, valueType }
    }
    const ops = tableOps(prisma, params.templateType)
    if (mode === 'increase') {
      // 仅调增：目标当期行存在则逆向分摊到各行；无目标行时需同期任意事实行作模板新建 1 行
      const targetRows = await ops.delegate.findMany({
        where: ops.where({ ...periodFilter, accountCodes: [params.targetAccountCode as string] }, batchIds, params.companyCode),
      })
      const targetTotal = round2(targetRows.reduce((s, r) => s + num(r.value), 0))
      let affectedRows = targetRows.length
      if (affectedRows === 0) {
        const templateRows = await ops.delegate.findMany({ where: ops.where(periodFilter, batchIds, params.companyCode) })
        affectedRows = templateRows.length > 0 ? 1 : 0
      }
      return { affectedRows, sourceTotal: 0, targetTotal, decreaseAmount, increaseAmount, netChange, valueType }
    }
    const sourceRows = await ops.delegate.findMany({
      where: ops.where({ ...periodFilter, accountCodes: [params.sourceAccountCode as string] }, batchIds, params.companyCode),
    })
    const sourceTotal = round2(sourceRows.reduce((s, r) => s + num(r.value), 0))
    if (sourceRows.length > 0 && decreaseAmount > sourceTotal) {
      throw errors.badRequest(`调减${valueType === 'quantity' ? '数量' : '金额'}不能超过源科目合计 ${sourceTotal}${valueType === 'quantity' ? '' : ' 万元'}`)
    }
    return { affectedRows: sourceRows.length, sourceTotal, decreaseAmount, increaseAmount, netChange, valueType }
  },

  async adjustSubject(
    params: AdjustSubjectParams,
    scope: Scope,
    ctx: AuditCtx,
  ): Promise<{ affectedRows: number; decreaseAmount: number; increaseAmount: number; netChange: number; mergedRows: number; createdRows: number }> {
    const mode = resolveAdjustMode(params)
    requireAdjustFields(params, mode)
    const periodFilter = periodFilterOf(params.templateType, params.period)
    if (!params.reason || !params.reason.trim()) throw errors.badRequest('请填写调整原因')
    await validateCompanyExists(params.companyCode)
    await assertCompaniesInScope(scope, [params.companyCode])
    const valueType = await loadAndValidateAdjustSubjects(params.templateType, mode, mode === 'increase' ? undefined : params.sourceAccountCode, mode === 'decrease' ? undefined : params.targetAccountCode)
    validateAdjustAmounts(params, mode, valueType)
    const batchIds = await activeBatchIds(params.templateType)
    if (batchIds.length === 0) throw errors.conflict('该模板类型暂无生效批次，无可调整数据')

    const result = await prisma.$transaction(async (tx) => adjustSubjectInTx(tx, params, mode, valueType, periodFilter, batchIds))
    const netChange = round2(result.increased - result.decreased)

    await prisma.reclassificationLog.create({
      data: {
        type: 'subject_adjust',
        templateType: params.templateType,
        sourceCompany: params.companyCode,
        sourceSubject: mode === 'increase' ? null : params.sourceAccountCode,
        targetSubject: mode === 'decrease' ? null : (params.targetAccountCode ?? null),
        period: params.period,
        periodFrom: params.period,
        periodTo: params.period,
        affectedRows: result.affected,
        operatedBy: ctx.userId,
        detail: {
          adjustMode: mode,
          valueType,
          decreaseAmount: result.decreased,
          increaseAmount: result.increased,
          netChange,
          reason: params.reason.trim(),
          mergedRows: result.merged,
          createdRows: result.created,
          snapshot: result.snapshot,
        } as never,
      },
    })
    await recordAudit(
      {
        userId: ctx.userId,
        module: 'data',
        action: 'reclassify',
        targetId: mode === 'increase'
          ? `${params.companyCode}:(仅调增)->${params.targetAccountCode}`
          : `${params.companyCode}:${params.sourceAccountCode}->${mode === 'decrease' ? '(仅调减)' : (params.targetAccountCode ?? '(仅调减)')}`,
        detail: {
          kind: 'subject_adjust',
          adjustMode: mode,
          valueType,
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
    const userIds = [...new Set(rows.flatMap((r) => [r.operatedBy, r.revertedBy]).filter(Boolean))] as string[]
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
    const nameMap = new Map(users.map((u) => [u.id, u.username]))
    const items = rows.map((r) => {
      // 行级快照仅供撤销使用，不随列表下发（控制体积）；以是否存在快照标记可撤销性
      const { snapshot, ...detailRest } = (r.detail ?? {}) as Record<string, unknown>
      return {
        id: r.id,
        type: r.type,
        templateType: r.templateType,
        sourceCompany: r.sourceCompany,
        targetCompany: r.targetCompany,
        sourceSubject: r.sourceSubject,
        targetSubject: r.targetSubject,
        period: r.period ?? r.periodFrom,
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
        affectedRows: r.affectedRows,
        operator: nameMap.get(r.operatedBy) ?? r.operatedBy,
        revertedAt: r.revertedAt ? r.revertedAt.toISOString() : null,
        revertedBy: r.revertedBy ? (nameMap.get(r.revertedBy) ?? r.revertedBy) : null,
        revertible: snapshot !== undefined && snapshot !== null && !r.revertedAt,
        detail: detailRest,
        createdAt: r.createdAt.toISOString(),
      }
    })
    return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },

  /**
   * 撤销重分类/科目调整：按日志中的行级快照逆向恢复（更新行回写、新建行删除、删除行重建）。
   * 已撤销、缺快照（历史记录）、涉及行已不存在或所属批次已不再生效时拒绝撤销。
   */
  async revertLog(id: string, scope: Scope, ctx: AuditCtx): Promise<{ restoredRows: number }> {
    const log = await prisma.reclassificationLog.findUnique({ where: { id } })
    if (!log) throw errors.notFound('重分类记录不存在')
    if (log.revertedAt) throw errors.conflict('该记录已撤销，不可重复撤销')
    if (log.type === 'subject') throw errors.conflict('科目归类调整（换父）请在科目树中反向操作恢复')
    const detail = (log.detail ?? {}) as { snapshot?: RowSnapshot }
    const snap = detail.snapshot
    if (!snap) throw errors.conflict('该记录缺少行级快照（历史数据），无法撤销')
    if (!log.templateType) throw errors.conflict('该记录缺少模板类型，无法撤销')
    // scope 守卫：涉及公司须在操作者数据范围内
    const involvedCompanies = [log.sourceCompany, log.targetCompany].filter(Boolean) as string[]
    if (involvedCompanies.length > 0) await assertCompaniesInScope(scope, involvedCompanies)
    const templateType = log.templateType as TemplateType

    const restored = await prisma.$transaction(async (tx) => {
      const ops = tableOps(tx, templateType)
      // 校验涉及行仍存在（批次被替换/清除后拒绝撤销）
      const updatedIds = snap.updated.map((u) => u.id)
      const updatedRows = updatedIds.length > 0 ? await ops.delegate.findMany({ where: { id: { in: updatedIds } } }) : []
      if (updatedRows.length !== updatedIds.length) throw errors.conflict('相关数据已被替换或清除，无法撤销')
      const createdRows = snap.created.length > 0 ? await ops.delegate.findMany({ where: { id: { in: snap.created } } }) : []
      if (createdRows.length !== snap.created.length) throw errors.conflict('相关数据已被替换或清除，无法撤销')
      // 涉及批次须仍生效（避免复活已归档批次的旧数据）
      const batchIds = new Set<string>()
      for (const r of [...updatedRows, ...createdRows]) batchIds.add(r.batchId)
      for (const d of snap.deleted) if (typeof d.batchId === 'string') batchIds.add(d.batchId)
      if (batchIds.size > 0) {
        const activeCount = await tx.importBatch.count({ where: { id: { in: [...batchIds] }, lifecycleStatus: 'active' } })
        if (activeCount !== batchIds.size) throw errors.conflict('相关批次已不再生效，无法撤销')
      }
      let n = 0
      for (const u of snap.updated) {
        await ops.delegate.update({ where: { id: u.id }, data: u.data })
        n++
      }
      for (const cid of snap.created) {
        await ops.delegate.delete({ where: { id: cid } })
        n++
      }
      for (const d of snap.deleted) {
        await ops.delegate.create({ data: d })
        n++
      }
      await tx.reclassificationLog.update({ where: { id }, data: { revertedAt: new Date(), revertedBy: ctx.userId } })
      return n
    })
    await recordAudit(
      { userId: ctx.userId, module: 'data', action: 'reclassify', targetId: id, detail: { kind: 'revert', type: log.type, templateType, restoredRows: restored } },
      ctx.traceId,
    )
    return { restoredRows: restored }
  },
}
