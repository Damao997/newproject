import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { effectiveScope } from '../lib/scope-guard'
import type { AuthUserContext } from '../types/express'

/**
 * 汇总抵消调整服务：在汇总主体（如 ET0001）聚合口径上按科目/期间叠加抵消金额，
 * 解决内部公司间交易（如集团内现金流）在汇总层面的重复计算。
 * 与重分类（修改单体事实行）不同，抵消记录独立存储、聚合时叠加生效，单体报表不受影响；
 * 软删除即撤销抵消。每次操作写审计日志留痕。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & { dataScopeCodes?: string[] | null }
interface AuditCtx { userId: string; traceId?: string }

export interface ConsolidationAdjustParams {
  templateType: 'operating' | 'static' | 'cashflow'
  summaryCompanyCode: string
  accountCode: string
  /** 调整期间（单月 YYYY-MM） */
  period: string
  /** 抵消金额（万元）：正=调增、负=调减，非 0 */
  amount: number
  reason: string
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** 汇总主体「全有或全无」授权校验：与 resolveCompanyCodes 同口径，未完整授权即拒绝 */
async function assertSummaryInScope(summaryCode: string, scope: Scope): Promise<void> {
  const s = await effectiveScope(scope)
  if (s === null || s.type === 'all') return
  if (s.type === 'none') throw errors.forbidden('无数据范围，无法进行汇总抵消调整')
  if (!(s.type === 'companies' && s.summaryCodes.includes(summaryCode))) {
    throw errors.forbidden(`无权操作汇总主体 ${summaryCode}（成员范围超出数据权限）`)
  }
}

/** 校验汇总主体存在且为汇总类型 */
async function assertSummaryCompany(code: string): Promise<void> {
  const company = await prisma.company.findUnique({ where: { code }, select: { entityType: true } })
  if (!company) throw errors.badRequest('汇总主体不存在')
  if (company.entityType !== 'summary') throw errors.badRequest('抵消调整仅支持汇总主体（单体公司请使用科目间调整）')
}

/** 校验科目存在、属于所选模板科目树且为 data 类（data 叶子，避免 calc 公式计算覆盖抵消额） */
async function assertDataSubject(code: string, templateType: 'operating' | 'static' | 'cashflow'): Promise<void> {
  // 与 AggregationService.subjectTypeOf 口径一致：现金流模板取现金流科目树，静态取静态树，其余取经营树
  const expectedSubjectType = templateType === 'static' ? 'static' : templateType === 'cashflow' ? 'cashflow' : 'operating'
  const subject = await prisma.accountSubject.findUnique({ where: { code }, select: { code: true, subjectType: true } })
  if (!subject || subject.subjectType !== expectedSubjectType) throw errors.badRequest('科目不存在或不属于所选模板科目树')
  const metric = await prisma.metric.findUnique({ where: { code }, select: { dataType: true } })
  if ((metric?.dataType ?? 'data') !== 'data') throw errors.badRequest('仅支持对 data 类科目（叶子）做抵消调整，计算类科目由公式计算')
}

/** 校验公司存在且为单体公司 */
async function assertSingleCompany(code: string, label: string): Promise<void> {
  const company = await prisma.company.findUnique({ where: { code }, select: { entityType: true } })
  if (!company) throw errors.badRequest(`${label}不存在`)
  if (company.entityType !== 'single') throw errors.badRequest(`${label}必须是单体公司`)
}

export const ConsolidationService = {
  /**
   * 解析两个单体公司共同所属的汇总主体（company_aggregation_map 直接映射交集 + 权限过滤）。
   * 嵌套汇总（parent_code 上溯）本期不展开；isInternalElimination 仅展示提示，不阻断创建。
   */
  async commonSummariesOf(
    singleA: string,
    singleB: string,
    scope: Scope,
  ): Promise<{ summaries: { code: string; name: string; isInternalElimination: boolean }[] }> {
    if (singleA === singleB) throw errors.badRequest('两个单体公司不能相同')
    await assertSingleCompany(singleA, '单体公司 A')
    await assertSingleCompany(singleB, '单体公司 B')
    const maps = await prisma.companyAggregationMap.findMany({
      where: { singleCompanyCode: { in: [singleA, singleB] } },
      select: { summaryCompanyCode: true, singleCompanyCode: true, isInternalElimination: true },
    })
    const bySingle = (code: string) => new Map(
      maps.filter((m) => m.singleCompanyCode === code).map((m) => [m.summaryCompanyCode, m.isInternalElimination]),
    )
    const setA = bySingle(singleA)
    const setB = bySingle(singleB)
    const commonCodes = [...setA.keys()].filter((c) => setB.has(c))
    if (commonCodes.length === 0) return { summaries: [] }

    // 权限过滤：仅保留操作者被完整授权的汇总主体（「全有或全无」口径，与 createAdjustment 一致）
    const s = await effectiveScope(scope)
    const allowed = new Set(s === null || s.type === 'all' ? commonCodes : (s.type === 'companies' ? s.summaryCodes : []))
    const visible = commonCodes.filter((c) => allowed.has(c))
    if (visible.length === 0) return { summaries: [] }

    const companies = await prisma.company.findMany({ where: { code: { in: visible } }, select: { code: true, name: true } })
    const nameMap = new Map(companies.map((c) => [c.code, c.name]))
    return {
      summaries: visible.map((code) => ({
        code,
        name: nameMap.get(code) ?? code,
        // 两单体在该汇总下的映射均标记内部抵消才视为 true
        isInternalElimination: !!setA.get(code) && !!setB.get(code),
      })),
    }
  },

  async createAdjustment(params: ConsolidationAdjustParams, scope: Scope, ctx: AuditCtx): Promise<{ id: string }> {
    const reason = params.reason?.trim()
    if (!reason) throw errors.badRequest('请填写调整原因')
    if (typeof params.period !== 'string' || !PERIOD_RE.test(params.period)) throw errors.badRequest('请选择调整期间（单月 YYYY-MM）')
    if (typeof params.amount !== 'number' || !Number.isFinite(params.amount) || params.amount === 0) {
      throw errors.badRequest('调整金额必须为非 0 数值（万元，正=调增、负=调减）')
    }
    await assertSummaryCompany(params.summaryCompanyCode)
    await assertDataSubject(params.accountCode, params.templateType)
    await assertSummaryInScope(params.summaryCompanyCode, scope)

    const created = await prisma.consolidationAdjustment.create({
      data: {
        templateType: params.templateType,
        summaryCompanyCode: params.summaryCompanyCode,
        accountCode: params.accountCode,
        period: params.period,
        amount: params.amount,
        reason,
        createdBy: ctx.userId,
      },
      select: { id: true },
    })
    await recordAudit(
      {
        userId: ctx.userId,
        module: 'data',
        action: 'consolidation',
        targetId: `${params.summaryCompanyCode}:${params.accountCode}:${params.period}`,
        detail: {
          kind: 'create',
          templateType: params.templateType,
          summaryCompanyCode: params.summaryCompanyCode,
          accountCode: params.accountCode,
          period: params.period,
          amount: params.amount,
          reason,
          adjustmentId: created.id,
        },
      },
      ctx.traceId,
    )
    return created
  },

  async listAdjustments(params: { page: number; pageSize: number }, scope?: Scope) {
    // 数据范围过滤：与写路径同口径（'all'/无上下文不过滤；'companies' 收敛到授权汇总主体；'none' 返回空）
    const s = await effectiveScope(scope)
    if (s?.type === 'none') return { items: [], total: 0, page: params.page, pageSize: params.pageSize, totalPages: 0 }
    const where = { deletedAt: null, ...(s?.type === 'companies' ? { summaryCompanyCode: { in: s.summaryCodes } } : {}) }
    const [rows, total] = await Promise.all([
      prisma.consolidationAdjustment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.consolidationAdjustment.count({ where }),
    ])
    const userIds = [...new Set(rows.map((r) => r.createdBy))]
    const [users, companies, subjects] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }),
      prisma.company.findMany({ where: { code: { in: rows.map((r) => r.summaryCompanyCode) } }, select: { code: true, name: true } }),
      prisma.accountSubject.findMany({ where: { code: { in: rows.map((r) => r.accountCode) } }, select: { code: true, name: true } }),
    ])
    const nameMap = new Map(users.map((u) => [u.id, u.username]))
    const companyMap = new Map(companies.map((c) => [c.code, c.name]))
    const subjectMap = new Map(subjects.map((s) => [s.code, s.name]))
    const items = rows.map((r) => ({
      id: r.id,
      templateType: r.templateType,
      summaryCompanyCode: r.summaryCompanyCode,
      summaryCompanyName: companyMap.get(r.summaryCompanyCode) ?? r.summaryCompanyCode,
      accountCode: r.accountCode,
      accountName: subjectMap.get(r.accountCode) ?? r.accountCode,
      period: r.period,
      amount: r.amount,
      reason: r.reason,
      operator: nameMap.get(r.createdBy) ?? r.createdBy,
      createdAt: r.createdAt.toISOString(),
    }))
    return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },

  /** 删除（撤销）抵消调整：软删除 + 审计；须对该汇总主体有完整数据权限 */
  async deleteAdjustment(id: string, scope: Scope, ctx: AuditCtx): Promise<{ deleted: boolean }> {
    const row = await prisma.consolidationAdjustment.findUnique({ where: { id } })
    if (!row || row.deletedAt) throw errors.notFound('抵消调整记录不存在')
    await assertSummaryInScope(row.summaryCompanyCode, scope)
    await prisma.consolidationAdjustment.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: ctx.userId, updatedAt: new Date() },
    })
    await recordAudit(
      {
        userId: ctx.userId,
        module: 'data',
        action: 'consolidation',
        targetId: id,
        detail: {
          kind: 'delete',
          templateType: row.templateType,
          summaryCompanyCode: row.summaryCompanyCode,
          accountCode: row.accountCode,
          period: row.period,
          amount: row.amount,
        },
      },
      ctx.traceId,
    )
    return { deleted: true }
  },
}
