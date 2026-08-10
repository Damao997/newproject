import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { resolveScope } from '../middleware/scope'
import { currentScope } from '../middleware/scope-context'
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
  subjectType?: 'operating' | 'static' | 'transaction'
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
  const s = currentScope() ?? (await resolveScope(prisma, scope))
  if (s.type === 'all') {
    const all = await prisma.company.findMany({ where: { entityType: 'single', status: 'active' }, select: { code: true } })
    return all.map((c) => c.code)
  }
  if (s.type === 'companies') return s.companyCodes
  return []
}

/** 解析用户可见的汇总主体编码集合（companies 范围下授权 dataScope 中的汇总主体；与指标页聚合口径对齐） */
export async function resolveScopeSummaryCodes(scope: Scope): Promise<string[]> {
  const s = currentScope() ?? (await resolveScope(prisma, scope))
  if (s.type === 'all') {
    const all = await prisma.company.findMany({ where: { entityType: 'summary', status: 'active' }, select: { code: true } })
    return all.map((c) => c.code)
  }
  if (s.type === 'companies') return s.summaryCodes
  return []
}

/** 用户是否为全量数据范围（scopeValue '*'）——ALL 归档（含跨公司汇总金额）仅全量用户可见可操作 */
export async function isFullScope(scope: Scope): Promise<boolean> {
  const s = currentScope() ?? (await resolveScope(prisma, scope))
  return s.type === 'all'
}

/** 校验并收敛请求的公司编码到用户 scope 内；越权抛 403。ALL 归档属全局资产：仅全量数据范围用户可操作 */
async function assertCompanyInScope(scope: Scope, companyCode: string): Promise<void> {
  if (companyCode === ALL_COMPANY_CODE) {
    if (!(await isFullScope(scope))) throw errors.forbidden('无权操作全局预分析归档（需要全部数据范围）')
    return
  }
  const [allowed, summaryCodes] = await Promise.all([resolveScopeCompanyCodes(scope), resolveScopeSummaryCodes(scope)])
  if (!allowed.includes(companyCode) && !summaryCodes.includes(companyCode)) {
    throw errors.forbidden('无权操作该公司的分析数据')
  }
}

/** 往来单项分析对象（六大往来类型粒度）：TXN_* 编码 → 中文名，不属于 accountSubject 体系 */
export const TRANSACTION_SUBJECTS: Record<string, string> = {
  TXN_AR: '应收账款',
  TXN_AROT: '其他应收款',
  TXN_PER_AR: '预收账款',
  TXN_AP: '应付账款',
  TXN_APOT: '其他应付款',
  TXN_PER_AP: '预付账款',
}

/** AI 全局预分析归档的约定科目编码（subject_analysis.subject_code），展示名映射见 enrich */
export const OVERVIEW_SUBJECT_CODE = 'OVERVIEW'
export const OVERVIEW_SUBJECT_NAME = '全局预分析'
/** 全部主体归档时的约定公司编码（company_code 无 FK 约束，可存约定值） */
export const ALL_COMPANY_CODE = 'ALL'
export const ALL_COMPANY_NAME = '全部主体'

/** 推断科目类型（operating/static/transaction/overview），优先取入参，缺省查科目表 */
async function resolveSubjectType(subjectCode: string, given?: string): Promise<'operating' | 'static' | 'transaction' | 'overview'> {
  if (given === 'overview') return 'overview'
  if (given === 'transaction') {
    if (!TRANSACTION_SUBJECTS[subjectCode]) throw errors.badRequest(`往来分析对象不存在：${subjectCode}`)
    return 'transaction'
  }
  if (given === 'operating' || given === 'static') return given
  // 未显式给类型时，TXN_* 编码按往来类型解析，其余查科目表
  if (TRANSACTION_SUBJECTS[subjectCode]) return 'transaction'
  const subject = await prisma.accountSubject.findUnique({ where: { code: subjectCode }, select: { subjectType: true } })
  if (!subject) throw errors.badRequest(`科目不存在：${subjectCode}`)
  return subject.subjectType
}

/** 纯文本转义 HTML 特殊字符（归档富文本转换前使用） */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** AI 预分析纯文本 → 富文本 HTML：按行转 <p>，分节标题行（"一、…"）加粗 */
export function plainTextToRichHtml(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[一二三四五六七八九十]+、/.test(l) ? `<p><strong>${escapeHtml(l)}</strong></p>` : `<p>${escapeHtml(l)}</p>`))
    .join('')
}

function toDTO(row: {
  id: string
  companyCode: string
  subjectCode: string
  subjectType: 'operating' | 'static' | 'transaction' | 'overview'
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
  // 往来分析对象（TXN_*）不在科目表中，名称取静态映射；全局预分析（OVERVIEW）与全部主体（ALL）取约定名称
  return rows.map((r) =>
    toDTO(
      r,
      cMap.get(r.companyCode) ?? (r.companyCode === ALL_COMPANY_CODE ? ALL_COMPANY_NAME : null),
      sMap.get(r.subjectCode) ?? TRANSACTION_SUBJECTS[r.subjectCode] ?? (r.subjectCode === OVERVIEW_SUBJECT_CODE ? OVERVIEW_SUBJECT_NAME : null),
    ),
  )
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
    /** 分析类型过滤：'overview' = 仅 AI 全局预分析归档；'normal' = 排除预分析；缺省不限 */
    subjectType?: 'overview' | 'normal'
    keyword?: string
    includeInactive?: boolean
    page?: number
    pageSize?: number
  }): Promise<{ items: AnalysisListItem[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filter.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20))
    const keyword = filter.keyword?.trim()
    const allowed = await resolveScopeCompanyCodes(scope)
    const summaryCodes = await resolveScopeSummaryCodes(scope)
    const visibleCodes = [...new Set([...allowed, ...summaryCodes])]
    // 全部主体的预分析归档（ALL）含跨公司汇总金额：仅全量数据范围用户可见
    const companyCodes = filter.companyCode
      ? visibleCodes.filter((c) => c === filter.companyCode)
      : ((await isFullScope(scope)) ? [...visibleCodes, ALL_COMPANY_CODE] : visibleCodes)
    const where = {
      companyCode: { in: companyCodes },
      ...(filter.subjectCode ? { subjectCode: filter.subjectCode } : {}),
      // 分析类型：AI 预分析归档（OVERVIEW）与普通科目分析互斥
      ...(filter.subjectType === 'overview' ? { subjectCode: OVERVIEW_SUBJECT_CODE } : {}),
      ...(filter.subjectType === 'normal' ? { subjectCode: { not: OVERVIEW_SUBJECT_CODE } } : {}),
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
        // 排除 AI 全局预分析归档（OVERVIEW）：报告章节自动填充只取科目级分析
        subjectCode: { not: OVERVIEW_SUBJECT_CODE },
        ...(params.period ? { period: params.period } : {}),
      },
      orderBy: [{ companyCode: 'asc' }, { subjectCode: 'asc' }],
    })
    const items = await enrich(rows)
    return { items, resolvedCompanyCodes }
  },

  /**
   * AI 全局预分析归档（供 AIProxyService 调用）：主体（全部主体=ALL）× 全局预分析 × 期间 幂等覆盖。
   * 纯文本报告转富文本 HTML 存储；复用 subject_analysis 的软删除与列表管理机制。
   */
  async archiveOverview(params: {
    companyCode?: string
    period: string
    content: string
    metricContext?: Record<string, unknown> | null
    userId: string
  }): Promise<AnalysisDTO> {
    const { period, userId } = params
    if (!period || !params.content?.trim()) throw errors.badRequest('期间与内容为必填项')
    const companyCode = params.companyCode?.trim() || ALL_COMPANY_CODE
    if (companyCode !== ALL_COMPANY_CODE) {
      const company = await prisma.company.findUnique({ where: { code: companyCode }, select: { code: true } })
      if (!company) throw errors.badRequest(`公司不存在：${companyCode}`)
    }
    const content = sanitizeRichText(plainTextToRichHtml(params.content))
    const data = {
      companyCode,
      subjectCode: OVERVIEW_SUBJECT_CODE,
      subjectType: 'overview' as const,
      fiscalYear: period.slice(0, 4),
      period,
      title: OVERVIEW_SUBJECT_NAME,
      content,
      metricContext: (params.metricContext ?? undefined) as never,
      status: 'active' as const,
      updatedBy: userId,
    }
    const row = await prisma.subjectAnalysis.upsert({
      where: {
        companyCode_subjectCode_period: {
          companyCode,
          subjectCode: OVERVIEW_SUBJECT_CODE,
          period,
        },
      },
      create: { ...data, createdBy: userId },
      update: data,
    })
    const [dto] = await enrich([row])
    return dto
  },
}
