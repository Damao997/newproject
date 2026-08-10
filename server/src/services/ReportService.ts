import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { sanitizeRichText, richTextToPlainText } from '../lib/sanitize'
import { resolveScope } from '../middleware/scope'
import { currentScope } from '../middleware/scope-context'
import { SubjectAnalysisService, resolveScopeCompanyCodes, OVERVIEW_SUBJECT_CODE, OVERVIEW_SUBJECT_NAME, ALL_COMPANY_CODE, ALL_COMPANY_NAME, type AnalysisDTO } from './SubjectAnalysisService'
import type { AuthUserContext } from '../types/express'

/**
 * 汇总分析报告服务：按公司(EN)或汇总主体(ET)将名下单项分析"实时引用"编排为总体报告。
 * - 实时引用：report_section.analysis_id 指向 subject_analysis，展示时 join 最新正文；
 *   单项分析被软删除后章节保留，展示标记"原文已删除"。
 * - 版本快照：report_version.snapshot 冻结当时全文（含已删除原文），与实时引用并存。
 * - 导出：返回结构化章节（标题+纯文本正文），由前端 docx/jspdf 生成 Word/PDF。
 * - 数据范围：所有读写均按用户 scope 收敛（报告主体成员须全部落在可见范围内，默认拒绝）。
 * - 状态机：仅 draft 可编辑章节/存版本/回退；draft↔published、draft/published→archived、archived→draft。
 * - 并发：setSections/saveVersion 支持乐观锁（expectedUpdatedAt 不匹配返回 409）。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & { dataScopeCodes?: string[] | null }

export interface CompanyScope {
  type: 'company' | 'summary'
  code: string
  name?: string | null
}

export interface SectionView {
  id: string
  orderNo: number
  title: string
  /** 实时正文：引用章节取单项分析最新 content；自由章节取自身 content */
  content: string
  /** 引用的单项分析 ID（自由章节为 null） */
  analysisId: string | null
  /** 引用来源元信息（公司/科目），自由章节为 null */
  source: { companyCode: string; companyName: string | null; subjectCode: string; subjectName: string | null; period: string } | null
  /** 引用章节的原文是否已被删除 */
  missing: boolean
}

export interface ReportView {
  id: string
  title: string
  fiscalYear: string
  period: string
  companyScope: CompanyScope
  status: string
  currentVersion: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
  sections: SectionView[]
}

interface SnapshotSection {
  title: string
  content: string
  analysisId: string | null
  source: SectionView['source']
  missing: boolean
}

export interface VersionSnapshotView {
  versionNo: number
  changeSummary: string | null
  changedBy: string | null
  changedAt: string
  snapshot: {
    title: string
    fiscalYear: string
    period: string
    companyScope: CompanyScope
    sections: SnapshotSection[]
  }
}

function parseScope(raw: unknown): CompanyScope {
  const obj = (raw ?? {}) as Record<string, unknown>
  const type = obj.type === 'summary' ? 'summary' : 'company'
  return { type, code: String(obj.code ?? ''), name: (obj.name as string | null) ?? null }
}

/** 校验报告状态枚举，非法返回 null */
function validStatus(status: string | undefined): 'draft' | 'published' | 'archived' | null {
  if (!status) return null
  if (status === 'draft' || status === 'published' || status === 'archived') return status
  return null
}

/** 状态机：允许的状态迁移 */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['published', 'archived'],
  published: ['draft', 'archived'],
  archived: ['draft'],
}

/** 仅草稿可编辑（章节增删/生成/存版本/回退） */
function assertDraft(report: { status: string }): void {
  if (report.status !== 'draft') {
    throw errors.badRequest('仅草稿状态的报告可编辑，请先恢复为草稿')
  }
}

/** 乐观锁：客户端提交的 expectedUpdatedAt 与当前不一致 → 409 */
function assertNotStale(report: { updatedAt: Date }, expectedUpdatedAt?: string): void {
  if (expectedUpdatedAt && report.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw errors.conflict('报告已被其他人修改，请刷新后重试')
  }
}

/** 校验报告主体范围完全落在用户 scope 内（默认拒绝，防水平越权） */
async function assertReportInScope(scope: Scope, companyScope: CompanyScope): Promise<void> {
  const s = currentScope() ?? (await resolveScope(prisma, scope))
  if (s.type === 'all') return
  if (s.type === 'none') throw errors.forbidden('无权访问该报告')
  // 汇总主体：由 resolveScope 按「全有或全无」预判定
  if (companyScope.type === 'summary') {
    if (!s.summaryCodes.includes(companyScope.code)) {
      throw errors.forbidden('无权访问该报告（主体范围超出数据权限）')
    }
    return
  }
  if (!s.companyCodes.includes(companyScope.code)) {
    throw errors.forbidden('无权访问该报告（主体范围超出数据权限）')
  }
}

/** 依据报告的 companyScope 拉取名下单项分析（ET 自动展开为旗下单体公司） */
async function fetchScopeAnalyses(scope: Scope, companyScope: CompanyScope, period: string): Promise<AnalysisDTO[]> {
  const { items } = await SubjectAnalysisService.batchForCompanies(scope, { companyCodes: [companyScope.code], period })
  return items
}

function toListItem(r: {
  id: string
  title: string
  fiscalYear: string
  period: string
  companyScope: unknown
  status: string
  currentVersion: number
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}): Omit<ReportView, 'sections'> {
  return {
    id: r.id,
    title: r.title,
    fiscalYear: r.fiscalYear,
    period: r.period,
    companyScope: parseScope(r.companyScope),
    status: r.status,
    currentVersion: r.currentVersion,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

export const ReportService = {
  /**
   * 列表（分页，scope 收敛）。status 未指定时默认排除已归档；status='all' 返回全部。
   * 支持 keyword 按标题模糊搜索。
   */
  async list(scope: Scope, params: { page?: number; pageSize?: number; status?: string; keyword?: string }): Promise<{ items: Omit<ReportView, 'sections'>[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, params.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))
    const status = validStatus(params.status)
    const keyword = params.keyword?.trim()
    const where = {
      ...(status
        ? { status }
        : params.status === 'all'
          ? {}
          : { status: { in: ['draft', 'published'] as ('draft' | 'published')[] } }),
      ...(keyword ? { title: { contains: keyword } } : {}),
    }

    const s = currentScope() ?? (await resolveScope(prisma, scope))
    if (s.type === 'none') return { items: [], total: 0, page, pageSize }

    if (s.type === 'all') {
      const [rows, total] = await Promise.all([
        prisma.report.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.report.count({ where }),
      ])
      return { items: rows.map(toListItem), total, page, pageSize }
    }

    // 受限 scope：报告量级小，取回后在内存按主体授权过滤
    // 汇总主体的「全有或全无」判定已由 resolveScope 收敛进 summaryCodes，与详情校验口径一致
    const rows = await prisma.report.findMany({ where, orderBy: { updatedAt: 'desc' } })
    const allowedSingles = new Set(s.companyCodes)
    const allowedSummaries = new Set(s.summaryCodes)
    const parsed = rows.map((r) => ({ row: r, cs: parseScope(r.companyScope) }))
    const visible = parsed.filter(({ cs }) =>
      cs.type === 'summary' ? allowedSummaries.has(cs.code) : allowedSingles.has(cs.code),
    )
    const total = visible.length
    const items = visible.slice((page - 1) * pageSize, page * pageSize).map(({ row }) => toListItem(row))
    return { items, total, page, pageSize }
  },

  /** 详情（含章节，实时引用 join 最新单项分析；scope 校验） */
  async getById(scope: Scope, id: string): Promise<ReportView> {
    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) throw errors.notFound('报告不存在')
    const companyScope = parseScope(report.companyScope)
    await assertReportInScope(scope, companyScope)
    const sections = await this.getSections(id)
    return { ...toListItem(report), companyScope, sections }
  },

  /** 读取报告章节（实时引用解析）。调用方须先完成 scope 校验。 */
  async getSections(reportId: string): Promise<SectionView[]> {
    const rows = await prisma.reportSection.findMany({ where: { reportId }, orderBy: { orderNo: 'asc' } })
    const analysisIds = rows.map((r) => r.analysisId).filter((x): x is string => !!x)
    // 含已软删除的单项分析（显式 status in active/inactive 接管软删除过滤）
    const analyses = analysisIds.length > 0
      ? await prisma.subjectAnalysis.findMany({ where: { id: { in: analysisIds }, status: { in: ['active', 'inactive'] } } })
      : []
    const aMap = new Map(analyses.map((a) => [a.id, a]))
    // 补充公司名/科目名
    const companyCodes = Array.from(new Set(analyses.map((a) => a.companyCode)))
    const subjectCodes = Array.from(new Set(analyses.map((a) => a.subjectCode)))
    const [companies, subjects] = await Promise.all([
      prisma.company.findMany({ where: { code: { in: companyCodes } }, select: { code: true, name: true } }),
      prisma.accountSubject.findMany({ where: { code: { in: subjectCodes } }, select: { code: true, name: true } }),
    ])
    const cMap = new Map(companies.map((c) => [c.code, c.name]))
    const sMap = new Map(subjects.map((s) => [s.code, s.name]))

    return rows.map((r) => {
      if (!r.analysisId) {
        return { id: r.id, orderNo: r.orderNo, title: r.title, content: r.content ?? '', analysisId: null, source: null, missing: false }
      }
      const a = aMap.get(r.analysisId)
      if (!a || a.status === 'inactive') {
        // 原文已删除：用章节自身缓存的标题/内容占位
        return { id: r.id, orderNo: r.orderNo, title: r.title, content: r.content ?? '', analysisId: r.analysisId, source: null, missing: true }
      }
      return {
        id: r.id,
        orderNo: r.orderNo,
        title: `${cMap.get(a.companyCode) ?? (a.companyCode === ALL_COMPANY_CODE ? ALL_COMPANY_NAME : a.companyCode)} · ${sMap.get(a.subjectCode) ?? (a.subjectCode === OVERVIEW_SUBJECT_CODE ? OVERVIEW_SUBJECT_NAME : a.subjectCode)}`,
        content: a.content,
        analysisId: a.id,
        source: {
          companyCode: a.companyCode,
          companyName: cMap.get(a.companyCode) ?? (a.companyCode === ALL_COMPANY_CODE ? ALL_COMPANY_NAME : null),
          subjectCode: a.subjectCode,
          subjectName: sMap.get(a.subjectCode) ?? (a.subjectCode === OVERVIEW_SUBJECT_CODE ? OVERVIEW_SUBJECT_NAME : null),
          period: a.period,
        },
        missing: false,
      }
    })
  },

  /** 创建报告（空章节，随后调用 generateSections；主体范围须落在用户 scope 内） */
  async create(scope: Scope, input: { title: string; fiscalYear: string; period: string; companyScope: CompanyScope }, userId: string): Promise<ReportView> {
    if (!input.title?.trim() || !input.fiscalYear || !input.period || !input.companyScope?.code) {
      throw errors.badRequest('标题、财年、期间、主体范围为必填项')
    }
    const company = await prisma.company.findUnique({ where: { code: input.companyScope.code }, select: { code: true, name: true, entityType: true } })
    if (!company) throw errors.badRequest(`主体不存在：${input.companyScope.code}`)
    const scopeType: CompanyScope['type'] = company.entityType === 'summary' ? 'summary' : 'company'
    await assertReportInScope(scope, { type: scopeType, code: company.code })
    const report = await prisma.report.create({
      data: {
        title: input.title.trim(),
        fiscalYear: input.fiscalYear,
        period: input.period,
        companyScope: { type: scopeType, code: company.code, name: company.name } as never,
        status: 'draft',
        currentVersion: 1,
        createdBy: userId,
        updatedBy: userId,
      },
    })
    return this.getById(scope, report.id)
  },

  /** 更新报告（标题仅草稿可改；状态按状态机迁移） */
  async update(scope: Scope, id: string, patch: { title?: string; status?: string }, userId: string): Promise<ReportView> {
    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) throw errors.notFound('报告不存在')
    await assertReportInScope(scope, parseScope(report.companyScope))
    const data: Record<string, unknown> = { updatedBy: userId }
    if (patch.title !== undefined) {
      assertDraft(report)
      data.title = patch.title.trim() || report.title
    }
    if (patch.status !== undefined && patch.status !== report.status) {
      if (!validStatus(patch.status)) throw errors.badRequest('非法状态')
      if (!STATUS_TRANSITIONS[report.status]?.includes(patch.status)) {
        throw errors.badRequest(`不允许的状态迁移：${report.status} → ${patch.status}`)
      }
      data.status = patch.status
    }
    await prisma.report.update({ where: { id }, data })
    return this.getById(scope, id)
  },

  /** 归档（软删除语义：status=archived） */
  async archive(scope: Scope, id: string, userId: string): Promise<void> {
    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) throw errors.notFound('报告不存在')
    await assertReportInScope(scope, parseScope(report.companyScope))
    await prisma.report.update({ where: { id }, data: { status: 'archived', updatedBy: userId } })
  },

  /**
   * 按 companyScope 拉取名下单项分析生成章节（实时引用，仅草稿）。
   * 已存在的引用章节按 analysisId 去重保留；新增分析追加为章节。
   */
  async generateSections(scope: Scope, reportId: string, userId: string): Promise<ReportView> {
    const report = await prisma.report.findUnique({ where: { id: reportId } })
    if (!report) throw errors.notFound('报告不存在')
    const companyScope = parseScope(report.companyScope)
    await assertReportInScope(scope, companyScope)
    assertDraft(report)
    const analyses = await fetchScopeAnalyses(scope, companyScope, report.period)

    const existing = await prisma.reportSection.findMany({ where: { reportId }, orderBy: { orderNo: 'asc' } })
    const existingAnalysisIds = new Set(existing.map((s) => s.analysisId).filter((x): x is string => !!x))
    let orderNo = existing.reduce((max, s) => Math.max(max, s.orderNo), 0)

    const toCreate = analyses.filter((a) => !existingAnalysisIds.has(a.id))
    if (toCreate.length > 0) {
      await prisma.reportSection.createMany({
        data: toCreate.map((a) => {
          orderNo += 1
          return {
            reportId,
            analysisId: a.id,
            title: `${a.companyName ?? a.companyCode} · ${a.subjectName ?? a.subjectCode}`,
            content: a.content,
            orderNo,
          }
        }),
      })
    }
    await prisma.report.update({ where: { id: reportId }, data: { updatedBy: userId } })
    return this.getById(scope, reportId)
  },

  /**
   * 重排/增删章节（仅草稿；事务原子提交；乐观锁防丢更新）。items 为有序数组：
   * - { analysisId } 引用章节（若不存在则创建；引用的分析须在用户 scope 内）
   * - { title, content } 自由章节（无 id 则创建，有 id 则更新）
   * 未在 items 中出现的既有章节将被删除。
   */
  async setSections(
    scope: Scope,
    reportId: string,
    items: Array<{ id?: string; analysisId?: string | null; title?: string; content?: string }>,
    userId: string,
    expectedUpdatedAt?: string,
  ): Promise<ReportView> {
    const report = await prisma.report.findUnique({ where: { id: reportId } })
    if (!report) throw errors.notFound('报告不存在')
    await assertReportInScope(scope, parseScope(report.companyScope))
    assertDraft(report)
    assertNotStale(report, expectedUpdatedAt)

    const existing = await prisma.reportSection.findMany({ where: { reportId } })
    const existingIds = new Set(existing.map((s) => s.id))
    const existingByAnalysis = new Map(existing.filter((s) => s.analysisId).map((s) => [s.analysisId as string, s]))

    // 新引用的单项分析批量校验：存在性 + scope 内（防止挂接他人分析读取正文）
    const newRefIds = [...new Set(items.filter((it) => it.analysisId && !existingByAnalysis.has(it.analysisId)).map((it) => it.analysisId as string))]
    const refAnalyses = newRefIds.length > 0
      ? await prisma.subjectAnalysis.findMany({ where: { id: { in: newRefIds }, status: { in: ['active', 'inactive'] } } })
      : []
    const refMap = new Map(refAnalyses.map((a) => [a.id, a]))
    if (newRefIds.length > 0) {
      const allowed = new Set(await resolveScopeCompanyCodes(scope))
      for (const rid of newRefIds) {
        const a = refMap.get(rid)
        if (!a) throw errors.badRequest(`引用的单项分析不存在：${rid}`)
        // AI 全局预分析归档（OVERVIEW）为全局口径（'ALL' 主体无公司归属），任何用户可引用；
        // 普通科目分析仍须在用户 scope 内
        if (a.subjectCode !== OVERVIEW_SUBJECT_CODE && !allowed.has(a.companyCode)) throw errors.forbidden('无权引用该公司的单项分析')
      }
    }

    await prisma.$transaction(async (tx) => {
      const keepIds = new Set<string>()
      const creates: { reportId: string; analysisId?: string; title: string; content: string; orderNo: number }[] = []

      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        const orderNo = i + 1
        if (it.analysisId) {
          // 引用章节
          const found = existingByAnalysis.get(it.analysisId)
          if (found) {
            keepIds.add(found.id)
            await tx.reportSection.update({ where: { id: found.id }, data: { orderNo } })
          } else {
            const a = refMap.get(it.analysisId)!
            creates.push({ reportId, analysisId: a.id, title: it.title || a.title, content: a.content, orderNo })
          }
        } else {
          // 自由章节
          const title = (it.title ?? '').trim() || '自定义章节'
          const content = sanitizeRichText(it.content ?? '')
          if (it.id && existingIds.has(it.id)) {
            keepIds.add(it.id)
            await tx.reportSection.update({ where: { id: it.id }, data: { title, content, orderNo, analysisId: null } })
          } else {
            creates.push({ reportId, title, content, orderNo })
          }
        }
      }

      if (creates.length > 0) {
        await tx.reportSection.createMany({ data: creates })
      }
      // 删除未保留的既有章节
      const toDelete = existing.filter((s) => !keepIds.has(s.id)).map((s) => s.id)
      if (toDelete.length > 0) {
        await tx.reportSection.deleteMany({ where: { id: { in: toDelete } } })
      }
      await tx.report.update({ where: { id: reportId }, data: { updatedBy: userId } })
    })
    return this.getById(scope, reportId)
  },

  /** 保存版本快照（仅草稿；事务内递增版本号，唯一约束防并发重复；乐观锁） */
  async saveVersion(scope: Scope, reportId: string, changeSummary: string | undefined, userId: string, expectedUpdatedAt?: string): Promise<{ versionNo: number }> {
    const report = await prisma.report.findUnique({ where: { id: reportId } })
    if (!report) throw errors.notFound('报告不存在')
    await assertReportInScope(scope, parseScope(report.companyScope))
    assertDraft(report)
    assertNotStale(report, expectedUpdatedAt)
    const sections = await this.getSections(reportId)
    const snapshot = {
      title: report.title,
      fiscalYear: report.fiscalYear,
      period: report.period,
      companyScope: parseScope(report.companyScope),
      sections: sections.map((s) => ({ title: s.title, content: s.content, analysisId: s.analysisId, source: s.source, missing: s.missing })),
    }
    const versionNo = await prisma.$transaction(async (tx) => {
      // 事务内重读版本号，配合 (report_id, version_no) 唯一约束防并发重复
      const cur = await tx.report.findUnique({ where: { id: reportId }, select: { currentVersion: true } })
      const next = (cur?.currentVersion ?? report.currentVersion) + 1
      await tx.reportVersion.create({ data: { reportId, versionNo: next, snapshot: snapshot as never, changeSummary: changeSummary ?? null, changedBy: userId } })
      await tx.report.update({ where: { id: reportId }, data: { currentVersion: next, updatedBy: userId } })
      return next
    })
    return { versionNo }
  },

  /** 版本历史 */
  async listVersions(scope: Scope, reportId: string): Promise<{ items: { id: string; versionNo: number; changeSummary: string | null; changedBy: string | null; changedAt: string }[] }> {
    const report = await prisma.report.findUnique({ where: { id: reportId } })
    if (!report) throw errors.notFound('报告不存在')
    await assertReportInScope(scope, parseScope(report.companyScope))
    const rows = await prisma.reportVersion.findMany({ where: { reportId }, orderBy: { versionNo: 'desc' } })
    return {
      items: rows.map((v) => ({ id: v.id, versionNo: v.versionNo, changeSummary: v.changeSummary, changedBy: v.changedBy, changedAt: v.changedAt.toISOString() })),
    }
  },

  /** 查看版本快照内容 */
  async getVersion(scope: Scope, reportId: string, versionNo: number): Promise<VersionSnapshotView> {
    const report = await prisma.report.findUnique({ where: { id: reportId } })
    if (!report) throw errors.notFound('报告不存在')
    await assertReportInScope(scope, parseScope(report.companyScope))
    const v = await prisma.reportVersion.findFirst({ where: { reportId, versionNo } })
    if (!v) throw errors.notFound(`版本不存在：v${versionNo}`)
    const raw = (v.snapshot ?? {}) as Record<string, unknown>
    const sections = Array.isArray(raw.sections) ? (raw.sections as SnapshotSection[]) : []
    return {
      versionNo: v.versionNo,
      changeSummary: v.changeSummary,
      changedBy: v.changedBy,
      changedAt: v.changedAt.toISOString(),
      snapshot: {
        title: String(raw.title ?? report.title),
        fiscalYear: String(raw.fiscalYear ?? report.fiscalYear),
        period: String(raw.period ?? report.period),
        companyScope: parseScope(raw.companyScope),
        sections,
      },
    }
  },

  /**
   * 回退到指定版本（仅草稿）：用快照章节整体替换当前章节。
   * 引用章节保留 analysisId（展示时继续实时 join；原文已删则以快照缓存正文占位）。
   */
  async rollbackVersion(scope: Scope, reportId: string, versionNo: number, userId: string): Promise<ReportView> {
    const report = await prisma.report.findUnique({ where: { id: reportId } })
    if (!report) throw errors.notFound('报告不存在')
    await assertReportInScope(scope, parseScope(report.companyScope))
    assertDraft(report)
    const version = await this.getVersion(scope, reportId, versionNo)
    await prisma.$transaction(async (tx) => {
      await tx.reportSection.deleteMany({ where: { reportId } })
      if (version.snapshot.sections.length > 0) {
        await tx.reportSection.createMany({
          data: version.snapshot.sections.map((s, i) => ({
            reportId,
            analysisId: s.analysisId ?? undefined,
            title: s.title,
            content: s.content,
            orderNo: i + 1,
          })),
        })
      }
      await tx.report.update({ where: { id: reportId }, data: { updatedBy: userId } })
    })
    return this.getById(scope, reportId)
  },

  /** 导出结构化数据（前端据此生成 Word/PDF；scope 校验） */
  async exportStructured(scope: Scope, reportId: string): Promise<{ title: string; fiscalYear: string; period: string; scopeName: string | null; generatedAt: string; sections: { title: string; content: string; plainText: string; missing: boolean }[] }> {
    const report = await this.getById(scope, reportId)
    return {
      title: report.title,
      fiscalYear: report.fiscalYear,
      period: report.period,
      scopeName: report.companyScope.name ?? report.companyScope.code,
      generatedAt: new Date().toISOString(),
      sections: report.sections.map((s) => ({ title: s.title, content: s.content, plainText: richTextToPlainText(s.content), missing: s.missing })),
    }
  },
}
