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

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & { dataScopeCodes?: string[] | null }

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
  status: string
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

/** 引用该分析的报告章节来源 */
export interface AnalysisRef {
  reportId: string
  reportTitle: string
  reportStatus: string
}

export type AnalysisListItem = AnalysisDTO & { refs: AnalysisRef[] }

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
  status: 'active' | 'inactive'
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
    status: row.status,
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
  /**
   * 列表（管理视图）：按公司/科目/期间过滤，scope 收敛；支持标题/正文关键词、分页、
   * 含已删除（显式 status 过滤接管软删除扩展）；附带每条被报告章节引用的来源（refs）。
   */
  async list(scope: Scope, filter: {
    companyCode?: string
    subjectCode?: string
    period?: string
    keyword?: string
    includeInactive?: boolean
    page?: number
    pageSize?: number
  }): Promise<{ items: AnalysisListItem[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filter.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20))
    const keyword = filter.keyword?.trim()
    const allowed = await resolveScopeCompanyCodes(scope)
    const companyCodes = filter.companyCode ? allowed.filter((c) => c === filter.companyCode) : allowed
    const where = {
      companyCode: { in: companyCodes },
      ...(filter.subjectCode ? { subjectCode: filter.subjectCode } : {}),
      ...(filter.period ? { period: filter.period } : {}),
      ...(keyword ? { OR: [{ title: { contains: keyword } }, { content: { contains: keyword } }] } : {}),
      // 显式声明 status 即接管软删除过滤（见 middleware/soft-delete.ts hasStatusFilter）
      ...(filter.includeInactive ? { status: { in: ['active', 'inactive'] as ('active' | 'inactive')[] } } : {}),
    }
    const [rows, total] = await Promise.all([
      prisma.subjectAnalysis.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.subjectAnalysis.count({ where }),
    ])
    const dtos = await enrich(rows)

    // 引用情况：当页 ids 一次性查章节 → 批量查报告标题/状态
    const ids = rows.map((r) => r.id)
    const sections = ids.length > 0
      ? await prisma.reportSection.findMany({ where: { analysisId: { in: ids } }, select: { analysisId: true, reportId: true } })
      : []
    const reportIds = [...new Set(sections.map((s) => s.reportId))]
    const reports = reportIds.length > 0
      ? await prisma.report.findMany({ where: { id: { in: reportIds } }, select: { id: true, title: true, status: true } })
      : []
    const rMap = new Map(reports.map((r) => [r.id, r]))
    const refsMap = new Map<string, AnalysisRef[]>()
    for (const s of sections) {
      if (!s.analysisId) continue
      const report = rMap.get(s.reportId)
      if (!report) continue
      const list = refsMap.get(s.analysisId) ?? []
      list.push({ reportId: report.id, reportTitle: report.title, reportStatus: report.status })
      refsMap.set(s.analysisId, list)
    }
    const items = dtos.map((d) => ({ ...d, refs: refsMap.get(d.id) ?? [] }))
    return { items, total, page, pageSize }
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

  /** 恢复软删除记录（status → active；需显式 status 过滤才能命中 inactive 行） */
  async restore(scope: Scope, id: string, userId: string): Promise<AnalysisDTO> {
    const existing = await prisma.subjectAnalysis.findFirst({ where: { id, status: { in: ['active', 'inactive'] } } })
    if (!existing) throw errors.notFound('单项分析不存在')
    await assertCompanyInScope(scope, existing.companyCode)
    const row = await prisma.subjectAnalysis.update({ where: { id }, data: { status: 'active', updatedBy: userId } })
    const [dto] = await enrich([row])
    return dto
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

    // 展开 ET 汇总主体 → 旗下单体公司（非 scope 内编码一次性批量查聚合映射，避免逐条往返）
    const expanded = new Set<string>()
    const maybeSummary: string[] = []
    for (const code of params.companyCodes) {
      if (allowedSet.has(code)) expanded.add(code)
      else maybeSummary.push(code)
    }
    if (maybeSummary.length > 0) {
      const mappings = await prisma.companyAggregationMap.findMany({
        where: { summaryCompanyCode: { in: maybeSummary } },
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
