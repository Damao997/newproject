import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { resolveScope } from '../middleware/scope'
import { sanitizeRichText } from '../lib/sanitize'
import type { AuthUserContext } from '../types/express'

/**
 * 单项分析服务：公司(EN) × 科目(OP_/ST_) × 期间 的分析结论 CRUD。
 * - 数据范围：复用 resolveScope 解析用户可见公司集合，写读均按 scope 收敛（默认拒绝）。
 * - 幂等：同 (companyCode, subjectCode, period) 唯一，create 采用 upsert 语义（含软删除记录复活）。
 * - 富文本：content 存储前经 sanitize-html 白名单净化。
 * - 软删除：status=inactive（由 soft-delete 扩展自动过滤读操作）。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'>

export interface AnalysisInput {
  companyCode: string
  subjectCode: string
  subjectType?: 'operating' | 'static'
  fiscalYear: string
  period: string
  title: string
  content: string
  metricContext?: Record<string, unknown> | null
}

export interface AnalysisDTO {
  id: string
  companyCode: string
  companyName: string | null
  subjectCode: string
  subjectName: string | null
  subjectType: string
  fiscalYear: string
  period: string
  title: string
  content: string
  metricContext: Record<string, unknown> | null
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

/** 解析用户可见的单体公司编码集合（scope 收敛） */
export async function resolveScopeCompanyCodes(scope: Scope): Promise<string[]> {
  const s = await resolveScope(prisma, scope)
  if (s.type === 'all') {
    const all = await prisma.company.findMany({ where: { entityType: 'single', status: 'active' }, select: { code: true } })
    return all.map((c) => c.code)
  }
  if (s.type === 'companies') return s.companyCodes
  return []
}

/** 校验并收敛请求的公司编码到用户 scope 内；越权抛 403 */
async function assertCompanyInScope(scope: Scope, companyCode: string): Promise<void> {
  const allowed = await resolveScopeCompanyCodes(scope)
  if (!allowed.includes(companyCode)) {
    throw errors.forbidden('无权操作该公司的分析数据')
  }
}

/** 推断科目类型（operating/static），优先取入参，缺省查科目表 */
async function resolveSubjectType(subjectCode: string, given?: string): Promise<'operating' | 'static'> {
  if (given === 'operating' || given === 'static') return given
  const subject = await prisma.accountSubject.findUnique({ where: { code: subjectCode }, select: { subjectType: true } })
  if (!subject) throw errors.badRequest(`科目不存在：${subjectCode}`)
  return subject.subjectType
}

function toDTO(row: {
  id: string
  companyCode: string
  subjectCode: string
  subjectType: 'operating' | 'static'
  fiscalYear: string
  period: string
  title: string
  content: string
  metricContext: unknown
  createdBy: string | null
  updatedBy: string | null
  createdAt: Date
  updatedAt: Date
}, companyName: string | null, subjectName: string | null): AnalysisDTO {
  return {
    id: row.id,
    companyCode: row.companyCode,
    companyName,
    subjectCode: row.subjectCode,
    subjectName,
    subjectType: row.subjectType,
    fiscalYear: row.fiscalYear,
    period: row.period,
    title: row.title,
    content: row.content,
    metricContext: (row.metricContext as Record<string, unknown> | null) ?? null,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 批量补充公司名/科目名 */
async function enrich(rows: Awaited<ReturnType<typeof prisma.subjectAnalysis.findMany>>): Promise<AnalysisDTO[]> {
  const companyCodes = Array.from(new Set(rows.map((r) => r.companyCode)))
  const subjectCodes = Array.from(new Set(rows.map((r) => r.subjectCode)))
  const [companies, subjects] = await Promise.all([
    prisma.company.findMany({ where: { code: { in: companyCodes } }, select: { code: true, name: true } }),
    prisma.accountSubject.findMany({ where: { code: { in: subjectCodes } }, select: { code: true, name: true } }),
  ])
  const cMap = new Map(companies.map((c) => [c.code, c.name]))
  const sMap = new Map(subjects.map((s) => [s.code, s.name]))
  return rows.map((r) => toDTO(r, cMap.get(r.companyCode) ?? null, sMap.get(r.subjectCode) ?? null))
}

export const SubjectAnalysisService = {
  /** 列表：按公司/科目/期间过滤，scope 收敛 */
  async list(scope: Scope, filter: { companyCode?: string; subjectCode?: string; period?: string }): Promise<{ items: AnalysisDTO[]; total: number }> {
    const allowed = await resolveScopeCompanyCodes(scope)
    const companyCodes = filter.companyCode ? allowed.filter((c) => c === filter.companyCode) : allowed
    const where = {
      companyCode: { in: companyCodes },
      ...(filter.subjectCode ? { subjectCode: filter.subjectCode } : {}),
      ...(filter.period ? { period: filter.period } : {}),
    }
    const rows = await prisma.subjectAnalysis.findMany({ where, orderBy: [{ companyCode: 'asc' }, { subjectCode: 'asc' }] })
    const items = await enrich(rows)
    return { items, total: items.length }
  },

  /** 详情（scope 校验） */
  async getById(scope: Scope, id: string): Promise<AnalysisDTO> {
    const row = await prisma.subjectAnalysis.findFirst({ where: { id } })
    if (!row) throw errors.notFound('单项分析不存在')
    await assertCompanyInScope(scope, row.companyCode)
    const [dto] = await enrich([row])
    return dto
  },

  /** 新增（幂等 upsert：命中唯一键则更新并复活软删除记录） */
  async create(scope: Scope, input: AnalysisInput, userId: string): Promise<AnalysisDTO> {
    if (!input.companyCode || !input.subjectCode || !input.fiscalYear || !input.period) {
      throw errors.badRequest('公司、科目、财年、期间为必填项')
    }
    await assertCompanyInScope(scope, input.companyCode)
    const subjectType = await resolveSubjectType(input.subjectCode, input.subjectType)
    const content = sanitizeRichText(input.content)
    const title = input.title?.trim() || input.subjectCode
    const data = {
      companyCode: input.companyCode,
      subjectCode: input.subjectCode,
      subjectType,
      fiscalYear: input.fiscalYear,
      period: input.period,
      title,
      content,
      metricContext: (input.metricContext ?? undefined) as never,
      status: 'active' as const,
      updatedBy: userId,
    }
    const row = await prisma.subjectAnalysis.upsert({
      where: {
        companyCode_subjectCode_period: {
          companyCode: input.companyCode,
          subjectCode: input.subjectCode,
          period: input.period,
        },
      },
      create: { ...data, createdBy: userId },
      update: data,
    })
    const [dto] = await enrich([row])
    return dto
  },

  /** 编辑（公司/科目/期间不可变更，仅改标题/正文/上下文） */
  async update(scope: Scope, id: string, patch: { title?: string; content?: string; metricContext?: Record<string, unknown> | null }, userId: string): Promise<AnalysisDTO> {
    const existing = await prisma.subjectAnalysis.findFirst({ where: { id } })
    if (!existing) throw errors.notFound('单项分析不存在')
    await assertCompanyInScope(scope, existing.companyCode)
    const data: Record<string, unknown> = { updatedBy: userId }
    if (patch.title !== undefined) data.title = patch.title.trim() || existing.subjectCode
    if (patch.content !== undefined) data.content = sanitizeRichText(patch.content)
    if (patch.metricContext !== undefined) data.metricContext = patch.metricContext as never
    const row = await prisma.subjectAnalysis.update({ where: { id }, data })
    const [dto] = await enrich([row])
    return dto
  },

  /** 软删除 */
  async remove(scope: Scope, id: string, userId: string): Promise<void> {
    const existing = await prisma.subjectAnalysis.findFirst({ where: { id } })
    if (!existing) throw errors.notFound('单项分析不存在')
    await assertCompanyInScope(scope, existing.companyCode)
    await prisma.subjectAnalysis.update({ where: { id }, data: { status: 'inactive', updatedBy: userId } })
  },

  /**
   * 批量取数（供汇总报告编制）：传入公司编码（可含 ET 汇总主体，自动展开为旗下单体公司），
   * 收敛到用户 scope 后按 period 过滤。返回按 公司→科目 分组的原始行。
   */
  async batchForCompanies(
    scope: Scope,
    params: { companyCodes: string[]; period?: string },
  ): Promise<{ items: AnalysisDTO[]; resolvedCompanyCodes: string[] }> {
    const allowed = await resolveScopeCompanyCodes(scope)
    const allowedSet = new Set(allowed)

    // 展开 ET 汇总主体 → 旗下单体公司
    const expanded = new Set<string>()
    for (const code of params.companyCodes) {
      if (allowedSet.has(code)) {
        expanded.add(code)
        continue
      }
      // 可能是汇总主体(ET)，查聚合映射
      const mappings = await prisma.companyAggregationMap.findMany({
        where: { summaryCompanyCode: code },
        select: { singleCompanyCode: true },
      })
      for (const m of mappings) {
        if (allowedSet.has(m.singleCompanyCode)) expanded.add(m.singleCompanyCode)
      }
    }
    const resolvedCompanyCodes = Array.from(expanded)
    const rows = await prisma.subjectAnalysis.findMany({
      where: {
        companyCode: { in: resolvedCompanyCodes },
        ...(params.period ? { period: params.period } : {}),
      },
      orderBy: [{ companyCode: 'asc' }, { subjectCode: 'asc' }],
    })
    const items = await enrich(rows)
    return { items, resolvedCompanyCodes }
  },
}
