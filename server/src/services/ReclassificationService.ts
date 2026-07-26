import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { resolveCompanyCodes } from './AggregationService'
import type { AuthUserContext } from '../types/express'

/**
 * 数据重分类服务：
 * - 跨公司重分类（主）：把生效批次中源公司的事实数据改挂到目标公司；
 *   目标公司已存在同唯一键行时合并求和（值相加、删除源行），保持合计不变。
 * - 科目归类调整（辅）见 DataService.reclassifySubject。
 * 每次操作写 ReclassificationLog + 审计日志；源/目标公司须在操作者数据范围内（scope 守卫）。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'>
type TemplateType = 'operating' | 'static' | 'budget'

interface AuditCtx { userId: string; traceId?: string }

export interface ReclassifyCompanyParams {
  templateType: TemplateType
  sourceCompanyCode: string
  targetCompanyCode: string
  accountCodes?: string[]
  periodFrom?: string
  periodTo?: string
}

export interface PreviewResult {
  affectedRows: number
  totalValue: number
  conflictRows: number
}

const num = (v: unknown): number => Number(String(v ?? 0))

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

/** scope 守卫：源/目标公司均须在操作者数据范围内 */
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

// ---- 各事实表的 where 构造与唯一键（不含 companyCode）----

function operatingWhere(p: ReclassifyCompanyParams, batchIds: string[], companyCode: string): Record<string, unknown> {
  const where: Record<string, unknown> = { batchId: { in: batchIds }, companyCode }
  if (p.accountCodes && p.accountCodes.length > 0) where.accountCode = { in: p.accountCodes }
  const period: Record<string, string> = {}
  if (p.periodFrom) period.gte = p.periodFrom
  if (p.periodTo) period.lte = p.periodTo
  if (Object.keys(period).length > 0) where.period = period
  return where
}

function staticWhere(p: ReclassifyCompanyParams, batchIds: string[], companyCode: string): Record<string, unknown> {
  const where: Record<string, unknown> = { batchId: { in: batchIds }, companyCode }
  if (p.accountCodes && p.accountCodes.length > 0) where.accountCode = { in: p.accountCodes }
  const snap: Record<string, Date> = {}
  if (p.periodFrom) snap.gte = monthStart(p.periodFrom)
  if (p.periodTo) snap.lte = monthEnd(p.periodTo)
  if (Object.keys(snap).length > 0) where.snapshotDate = snap
  return where
}

function budgetWhere(p: ReclassifyCompanyParams, batchIds: string[], companyCode: string): Record<string, unknown> {
  const where: Record<string, unknown> = { batchId: { in: batchIds }, companyCode }
  if (p.accountCodes && p.accountCodes.length > 0) where.accountCode = { in: p.accountCodes }
  const period: Record<string, string> = {}
  if (p.periodFrom) period.gte = p.periodFrom
  if (p.periodTo) period.lte = p.periodTo
  if (Object.keys(period).length > 0) where.period = period
  return where
}

interface Row { id: string; value: unknown; accountCode: string; periodDimCode: string; batchId: string; period?: string; fiscalYear?: string; snapshotDate?: Date }
type Delegate = {
  findMany: (args: { where: Record<string, unknown> }) => Promise<Row[]>
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
  delete: (args: { where: { id: string } }) => Promise<unknown>
}

interface Adapter {
  delegate: Delegate
  sourceWhere: Record<string, unknown>
  targetWhere: Record<string, unknown>
  keyOf: (r: Row) => string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAdapter(db: any, p: ReclassifyCompanyParams, batchIds: string[]): Adapter {
  if (p.templateType === 'operating') {
    return {
      delegate: db.factOperating as Delegate,
      sourceWhere: operatingWhere(p, batchIds, p.sourceCompanyCode),
      targetWhere: operatingWhere(p, batchIds, p.targetCompanyCode),
      keyOf: (r) => `${r.accountCode}|${r.period}|${r.periodDimCode}|${r.batchId}`,
    }
  }
  if (p.templateType === 'static') {
    return {
      delegate: db.factStatic as Delegate,
      sourceWhere: staticWhere(p, batchIds, p.sourceCompanyCode),
      targetWhere: staticWhere(p, batchIds, p.targetCompanyCode),
      keyOf: (r) => `${r.accountCode}|${r.snapshotDate?.toISOString()}|${r.periodDimCode}|${r.batchId}`,
    }
  }
  return {
    delegate: db.factBudget as Delegate,
    sourceWhere: budgetWhere(p, batchIds, p.sourceCompanyCode),
    targetWhere: budgetWhere(p, batchIds, p.targetCompanyCode),
    keyOf: (r) => `${r.accountCode}|${r.fiscalYear}|${r.period}|${r.batchId}`,
  }
}

async function previewTable(a: Adapter): Promise<PreviewResult> {
  const sourceRows = await a.delegate.findMany({ where: a.sourceWhere })
  const targetRows = await a.delegate.findMany({ where: a.targetWhere })
  const targetKeys = new Set(targetRows.map(a.keyOf))
  let totalValue = 0
  let conflictRows = 0
  for (const r of sourceRows) {
    totalValue += num(r.value)
    if (targetKeys.has(a.keyOf(r))) conflictRows++
  }
  return { affectedRows: sourceRows.length, totalValue: Number(totalValue.toFixed(2)), conflictRows }
}

async function reclassifyTable(a: Adapter, targetCompanyCode: string): Promise<{ affected: number; merged: number }> {
  const sourceRows = await a.delegate.findMany({ where: a.sourceWhere })
  const targetRows = await a.delegate.findMany({ where: a.targetWhere })
  const targetByKey = new Map(targetRows.map((r) => [a.keyOf(r), r]))
  let affected = 0
  let merged = 0
  for (const s of sourceRows) {
    const t = targetByKey.get(a.keyOf(s))
    if (t) {
      // 合并求和：目标行值累加，删除源行
      await a.delegate.update({ where: { id: t.id }, data: { value: num(t.value) + num(s.value) } })
      await a.delegate.delete({ where: { id: s.id } })
      merged++
    } else {
      await a.delegate.update({ where: { id: s.id }, data: { companyCode: targetCompanyCode } })
    }
    affected++
  }
  return { affected, merged }
}

export const ReclassificationService = {
  async previewCompany(params: ReclassifyCompanyParams, scope: Scope): Promise<PreviewResult> {
    await validateCompanies(params.sourceCompanyCode, params.targetCompanyCode)
    await assertCompaniesInScope(scope, [params.sourceCompanyCode, params.targetCompanyCode])
    const batchIds = await activeBatchIds(params.templateType)
    if (batchIds.length === 0) return { affectedRows: 0, totalValue: 0, conflictRows: 0 }
    return previewTable(buildAdapter(prisma, params, batchIds))
  },

  async reclassifyCompany(params: ReclassifyCompanyParams, scope: Scope, ctx: AuditCtx): Promise<{ affectedRows: number; mergedRows: number }> {
    await validateCompanies(params.sourceCompanyCode, params.targetCompanyCode)
    await assertCompaniesInScope(scope, [params.sourceCompanyCode, params.targetCompanyCode])
    const batchIds = await activeBatchIds(params.templateType)
    if (batchIds.length === 0) throw errors.conflict('该模板类型暂无生效批次，无可重分类数据')

    const result = await prisma.$transaction(async (tx) => reclassifyTable(buildAdapter(tx, params, batchIds), params.targetCompanyCode))
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
        detail: { mergedRows: result.merged, accountCodes: params.accountCodes ?? null } as never,
      },
    })
    await recordAudit(
      {
        userId: ctx.userId,
        module: 'data',
        action: 'reclassify',
        targetId: `${params.sourceCompanyCode}->${params.targetCompanyCode}`,
        detail: { kind: 'company', templateType: params.templateType, affectedRows: result.affected, mergedRows: result.merged },
      },
      ctx.traceId,
    )
    return { affectedRows: result.affected, mergedRows: result.merged }
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
      createdAt: r.createdAt.toISOString(),
    }))
    return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },
}
