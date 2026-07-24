import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { sanitizeRichText, richTextToPlainText } from '../lib/sanitize'
import { SubjectAnalysisService, type AnalysisDTO } from './SubjectAnalysisService'
import type { AuthUserContext } from '../types/express'

/**
 * 汇总分析报告服务：按公司(EN)或汇总主体(ET)将名下单项分析"实时引用"编排为总体报告。
 * - 实时引用：report_section.analysis_id 指向 subject_analysis，展示时 join 最新正文；
 *   单项分析被软删除后章节保留，展示标记"原文已删除"。
 * - 版本快照：report_version.snapshot 冻结当时全文（含已删除原文），与实时引用并存。
 * - 导出：返回结构化章节（标题+纯文本正文），由前端 docx/jspdf 生成 Word/PDF。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'>

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

/** 依据报告的 companyScope 拉取名下单项分析（ET 自动展开为旗下单体公司） */
async function fetchScopeAnalyses(scope: Scope, companyScope: CompanyScope, period: string): Promise<AnalysisDTO[]> {
  const codes = companyScope.type === 'summary' ? [companyScope.code] : [companyScope.code]
  const { items } = await SubjectAnalysisService.batchForCompanies(scope, { companyCodes: codes, period })
  return items
}

export const ReportService = {
  /** 列表（分页） */
  async list(params: { page?: number; pageSize?: number; status?: string }): Promise<{ items: Omit<ReportView, 'sections'>[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, params.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20))
    const status = validStatus(params.status)
    const where = status ? { status } : {}
    const [rows, total] = await Promise.all([
      prisma.report.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.report.count({ where }),
    ])
    const items = rows.map((r) => ({
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
    }))
    return { items, total, page, pageSize }
  },

  /** 详情（含章节，实时引用 join 最新单项分析） */
  async getById(id: string): Promise<ReportView> {
    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) throw errors.notFound('报告不存在')
    const sections = await this.getSections(id)
    return {
      id: report.id,
      title: report.title,
      fiscalYear: report.fiscalYear,
      period: report.period,
      companyScope: parseScope(report.companyScope),
      status: report.status,
      currentVersion: report.currentVersion,
      createdBy: report.createdBy,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      sections,
    }
  },

  /** 读取报告章节（实时引用解析） */
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
        title: `${cMap.get(a.companyCode) ?? a.companyCode} · ${sMap.get(a.subjectCode) ?? a.subjectCode}`,
        content: a.content,
        analysisId: a.id,
        source: { companyCode: a.companyCode, companyName: cMap.get(a.companyCode) ?? null, subjectCode: a.subjectCode, subjectName: sMap.get(a.subjectCode) ?? null, period: a.period },
        missing: false,
      }
    })
  },

  /** 创建报告（空章节，随后调用 generateSections） */
  async create(input: { title: string; fiscalYear: string; period: string; companyScope: CompanyScope }, userId: string): Promise<ReportView> {
    if (!input.title?.trim() || !input.fiscalYear || !input.period || !input.companyScope?.code) {
      throw errors.badRequest('标题、财年、期间、主体范围为必填项')
    }
    const company = await prisma.company.findUnique({ where: { code: input.companyScope.code }, select: { code: true, name: true, entityType: true } })
    if (!company) throw errors.badRequest(`主体不存在：${input.companyScope.code}`)
    const scopeType: CompanyScope['type'] = company.entityType === 'summary' ? 'summary' : 'company'
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
    return this.getById(report.id)
  },

  /** 更新报告（标题/状态） */
  async update(id: string, patch: { title?: string; status?: string }, userId: string): Promise<ReportView> {
    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) throw errors.notFound('报告不存在')
    const data: Record<string, unknown> = { updatedBy: userId }
    if (patch.title !== undefined) data.title = patch.title.trim() || report.title
    if (patch.status !== undefined) {
      if (!['draft', 'published', 'archived'].includes(patch.status)) throw errors.badRequest('非法状态')
      data.status = patch.status
    }
    await prisma.report.update({ where: { id }, data })
    return this.getById(id)
  },

  /** 归档（软删除语义：status=archived） */
  async archive(id: string, userId: string): Promise<void> {
    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) throw errors.notFound('报告不存在')
    await prisma.report.update({ where: { id }, data: { status: 'archived', updatedBy: userId } })
  },

  /**
   * 按 companyScope 拉取名下单项分析生成章节（实时引用）。
   * 已存在的引用章节按 analysisId 去重保留；新增分析追加为章节。
   */
  async generateSections(scope: Scope, reportId: string, userId: string): Promise<ReportView> {
    const report = await prisma.report.findUnique({ where: { id: reportId } })
    if (!report) throw errors.notFound('报告不存在')
    const companyScope = parseScope(report.companyScope)
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
    return this.getById(reportId)
  },

  /**
   * 重排/增删章节。items 为有序数组：
   * - { analysisId } 引用章节（若不存在则创建）
   * - { title, content } 自由章节（无 id 则创建，有 id 则更新）
   * 未在 items 中出现的既有章节将被删除。
   */
  async setSections(reportId: string, items: Array<{ id?: string; analysisId?: string | null; title?: string; content?: string }>, userId: string): Promise<ReportView> {
    const report = await prisma.report.findUnique({ where: { id: reportId } })
    if (!report) throw errors.notFound('报告不存在')
    const existing = await prisma.reportSection.findMany({ where: { reportId } })
    const existingIds = new Set(existing.map((s) => s.id))
    const keepIds = new Set<string>()

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const orderNo = i + 1
      if (it.analysisId) {
        // 引用章节
        const found = existing.find((s) => s.analysisId === it.analysisId)
        if (found) {
          keepIds.add(found.id)
          await prisma.reportSection.update({ where: { id: found.id }, data: { orderNo } })
        } else {
          const a = await prisma.subjectAnalysis.findFirst({ where: { id: it.analysisId, status: { in: ['active', 'inactive'] } } })
          if (!a) throw errors.badRequest(`引用的单项分析不存在：${it.analysisId}`)
          await prisma.reportSection.create({ data: { reportId, analysisId: a.id, title: it.title || a.title, content: a.content, orderNo } })
        }
      } else {
        // 自由章节
        const title = (it.title ?? '').trim() || '自定义章节'
        const content = sanitizeRichText(it.content ?? '')
        if (it.id && existingIds.has(it.id)) {
          keepIds.add(it.id)
          await prisma.reportSection.update({ where: { id: it.id }, data: { title, content, orderNo, analysisId: null } })
        } else {
          await prisma.reportSection.create({ data: { reportId, title, content, orderNo } })
        }
      }
    }

    // 删除未保留的既有章节
    const toDelete = existing.filter((s) => !keepIds.has(s.id)).map((s) => s.id)
    if (toDelete.length > 0) {
      await prisma.reportSection.deleteMany({ where: { id: { in: toDelete } } })
    }
    await prisma.report.update({ where: { id: reportId }, data: { updatedBy: userId } })
    return this.getById(reportId)
  },

  /** 保存版本快照（冻结当前全文，含已删除原文） */
  async saveVersion(reportId: string, changeSummary: string | undefined, userId: string): Promise<{ versionNo: number }> {
    const report = await prisma.report.findUnique({ where: { id: reportId } })
    if (!report) throw errors.notFound('报告不存在')
    const sections = await this.getSections(reportId)
    const snapshot = {
      title: report.title,
      fiscalYear: report.fiscalYear,
      period: report.period,
      companyScope: parseScope(report.companyScope),
      sections: sections.map((s) => ({ title: s.title, content: s.content, analysisId: s.analysisId, source: s.source, missing: s.missing })),
    }
    const versionNo = report.currentVersion + 1
    await prisma.$transaction([
      prisma.reportVersion.create({ data: { reportId, versionNo, snapshot: snapshot as never, changeSummary: changeSummary ?? null, changedBy: userId } }),
      prisma.report.update({ where: { id: reportId }, data: { currentVersion: versionNo, updatedBy: userId } }),
    ])
    return { versionNo }
  },

  /** 版本历史 */
  async listVersions(reportId: string): Promise<{ items: { id: string; versionNo: number; changeSummary: string | null; changedBy: string | null; changedAt: string }[] }> {
    const rows = await prisma.reportVersion.findMany({ where: { reportId }, orderBy: { versionNo: 'desc' } })
    return {
      items: rows.map((v) => ({ id: v.id, versionNo: v.versionNo, changeSummary: v.changeSummary, changedBy: v.changedBy, changedAt: v.changedAt.toISOString() })),
    }
  },

  /** 导出结构化数据（前端据此生成 Word/PDF） */
  async exportStructured(reportId: string): Promise<{ title: string; fiscalYear: string; period: string; scopeName: string | null; generatedAt: string; sections: { title: string; content: string; plainText: string; missing: boolean }[] }> {
    const report = await this.getById(reportId)
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
