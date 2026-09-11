import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Sparkles, Save, Download, FileDown, Search, FileText, Loader2, History, RotateCcw, Eye, GitCommitVertical, AlertTriangle, Link2,
  Plus, ArrowUp, ArrowDown, Trash2, Copy, LayoutTemplate,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Pill } from '@/components/ui/pill'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { FlashMessage } from '@/components/ui/flash-message'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { usePermission } from '@/hooks/usePermission'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import {
  useReport, useReportVersions, useReportVersionSnapshot,
  useGenerateReportSections, useSetReportSections, useSaveReportVersion, useRollbackReportVersion, useUpdateReport,
  useCreateReportTemplate,
  type ReportDetail, type ReportVersionItem,
} from '@/hooks/api-queries'
import type { ReportSectionView } from '@/lib/api'
import { REPORT_STATUS_LABEL, REPORT_STATUS_BADGE_VARIANT } from '@/lib/constants'
import { api, ApiError } from '@/lib/api'
import { exportReportToDocx, exportReportToPdf } from '@/lib/report-export'
import { cn } from '@/lib/utils'

/**
 * 报告编辑器（/reports/:reportId/edit，别名 /reports/editor/:reportId）：
 * - 章节列表渲染 + RichTextEditor 编辑（含 AI 润色 SSE / 链接编辑 / 表格 / 图片）
 * - 章节管理：添加空白章节 / 删除 / 上移下移 / 章节标题编辑（保存时全量有序提交）
 * - AI 按报告主体范围生成引用章节（generateReportSections）
 * - 章节整体保存（setReportSections，乐观锁 expectedUpdatedAt，409 冲突对话框可复制本地修改）
 * - 编辑安全感：未保存标识 / beforeunload 守卫 / sessionStorage 草稿暂存与恢复
 * - 版本管理：保存版本 / 版本列表 / 快照查看 / 回滚
 * - 导出 Word / PDF（api.exportReport + report-export，富文本格式保真）
 * 状态机：仅草稿可编辑章节 / 存版本 / 回滚；已发布、已归档只读。
 */

/** 乐观锁 409：优先按 api 层透传的 HTTP 状态码识别，文案匹配仅作兜底 */
function isConflictError(e: unknown): boolean {
  if (e instanceof ApiError && e.status === 409) return true
  const msg = (e as Error)?.message ?? ''
  return msg.includes('已被其他人修改') || msg.includes('请刷新')
}

/** 富文本 → 纯文本（冲突对话框复制用，简版转换足够） */
function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/blockquote|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 编辑器内章节视图：服务端章节（id 为真实 id）与本地新增章节（id 为 local- 前缀临时 id）统一形态 */
interface EditorSection {
  id: string
  analysisId: string | null
  title: string
  content: string
  source: ReportSectionView['source']
  missing: boolean
}

const TEMP_ID_PREFIX = 'local-'
const isTempId = (id: string) => id.startsWith(TEMP_ID_PREFIX)

/** sessionStorage 暂存结构：结构变更（sections，可为 null=仅内容修改）+ 内容草稿 */
interface StoredDraft {
  sections: EditorSection[] | null
  drafts: Record<string, string>
  savedAt: string
}

function parseStoredDraft(raw: string | null): StoredDraft | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as Partial<StoredDraft>
    if (!obj || typeof obj !== 'object' || typeof obj.drafts !== 'object' || obj.drafts === null) return null
    const sections = Array.isArray(obj.sections)
      ? obj.sections.filter((s): s is EditorSection =>
          !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.title === 'string' && typeof s.content === 'string')
      : null
    const hasDrafts = Object.keys(obj.drafts).length > 0
    if (!sections && !hasDrafts) return null
    if (sections && sections.length === 0 && !hasDrafts) return null
    return { sections, drafts: obj.drafts, savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : '' }
  } catch {
    return null
  }
}

export function ReportEditor() {
  const { reportId } = useParams<{ reportId: string }>()

  const { data: report, isLoading, isError, error, refetch } = useReport(reportId ?? null)

  return (
    <div className="-mx-4 -mt-6 flex flex-col bg-page sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {isLoading ? (
        <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">报告加载中…</div>
      ) : isError || !report ? (
        <div className="px-4 py-16 sm:px-6">
          <EmptyState
            icon={FileText}
            title="报告加载失败"
            description={(error as Error)?.message ?? '报告不存在或已被删除'}
            action={<Button variant="outline" size="sm" onClick={() => refetch()}>重试</Button>}
          />
        </div>
      ) : (
        <EditorShell report={report} onReload={() => refetch()} />
      )}
    </div>
  )
}

function EditorShell({ report, onReload }: { report: ReportDetail; onReload: () => void }) {
  const { can } = usePermission()
  const { getDisplayName } = useCompanyDisplayName()
  const canUpdate = can('reports', 'update')
  const canExport = can('reports', 'export')
  const editable = canUpdate && report.status === 'draft'

  const { confirm, element: confirmElement } = useConfirm()

  // 章节本地草稿：sectionId → html；服务端快照变化（保存/回滚/生成/他人修改）时整体重置
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // 章节结构本地态：null=未做结构变更（直接用服务端数据）；增删/排序/改标题时固化一份副本
  const [localSections, setLocalSections] = useState<EditorSection[] | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const flash = (text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ type, text })
    window.setTimeout(() => setMsg(null), 3000)
  }

  const sections: EditorSection[] = useMemo(
    () => localSections ?? report.sections,
    [localSections, report.sections],
  )

  useEffect(() => {
    setDrafts({})
    setLocalSections(null)
  }, [report.updatedAt])

  const setDraft = (sectionId: string, html: string) => {
    setDrafts((prev) => ({ ...prev, [sectionId]: html }))
  }
  const effectiveContent = (s: EditorSection) => drafts[s.id] ?? s.content

  // 内容脏检测（正文章节草稿）+ 结构脏检测（增删/排序/标题与服务器不一致）
  const contentDirty = sections.some((s) => !s.analysisId && drafts[s.id] !== undefined && drafts[s.id] !== s.content)
  const structureDirty = localSections !== null && (
    localSections.length !== report.sections.length ||
    localSections.some((s, i) => {
      const r = report.sections[i]
      return !r || s.id !== r.id || s.analysisId !== r.analysisId || s.title !== r.title
    })
  )
  const dirty = contentDirty || structureDirty

  // ===== 编辑安全感：sessionStorage 暂存 + 恢复提示 + beforeunload 守卫 =====
  const draftKey = `report-drafts:${report.id}`
  const [restorable, setRestorable] = useState<StoredDraft | null>(null)

  // 挂载时检查上次未保存的本地草稿（SPA 路由跳转/浏览器刷新后的找回入口）
  useEffect(() => {
    setRestorable(parseStoredDraft(window.sessionStorage.getItem(draftKey)))
  }, [draftKey])

  // 有未保存修改时写入暂存（保存成功/显式丢弃时清除；非脏态不覆盖既有暂存）
  useEffect(() => {
    if (!editable || !dirty) return
    try {
      window.sessionStorage.setItem(draftKey, JSON.stringify({ sections: localSections, drafts, savedAt: new Date().toISOString() } satisfies StoredDraft))
    } catch (e) {
      // 隐私模式/配额满时降级为无暂存，不阻断编辑
      console.error('报告草稿暂存失败', e)
    }
  }, [editable, dirty, localSections, drafts, draftKey])

  // 刷新/关闭页面前守卫（SPA 路由跳转由 sessionStorage 暂存兜底）
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const applyRestorable = () => {
    if (!restorable) return
    if (restorable.sections) setLocalSections(restorable.sections)
    setDrafts(restorable.drafts)
    setRestorable(null)
    flash('已恢复本地草稿，记得保存')
  }

  const discardRestorable = () => {
    try {
      window.sessionStorage.removeItem(draftKey)
    } catch (e) {
      console.error('清除报告草稿暂存失败', e)
    }
    setRestorable(null)
  }

  // ===== 章节管理：添加 / 删除 / 上移下移 / 标题编辑 =====
  const mutateSections = (fn: (base: EditorSection[]) => EditorSection[]) => {
    setLocalSections((prev) => fn(prev ?? report.sections))
  }

  const addSection = () => {
    mutateSections((base) => [
      ...base,
      { id: `${TEMP_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, analysisId: null, title: '', content: '', source: null, missing: false },
    ])
  }

  const removeSection = async (index: number) => {
    const s = sections[index]
    const ok = await confirm({
      title: '删除章节',
      description: `确认删除章节「${s.title || '自定义章节'}」？删除需点击「保存章节」后生效。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    mutateSections((base) => base.filter((_, i) => i !== index))
  }

  const moveSection = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= sections.length) return
    mutateSections((base) => {
      const next = [...base]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const updateSectionTitle = (index: number, title: string) => {
    mutateSections((base) => {
      const next = [...base]
      next[index] = { ...next[index], title }
      return next
    })
  }

  // 章节保存（全量有序提交 + 乐观锁）
  const setSections = useSetReportSections()
  const handleSaveSections = async () => {
    if (!editable || !dirty) return
    try {
      const items = sections.map((s) =>
        s.analysisId
          ? { analysisId: s.analysisId }
          : { id: isTempId(s.id) ? undefined : s.id, title: s.title.trim() || '自定义章节', content: effectiveContent(s) },
      )
      await setSections.mutateAsync({ id: report.id, items, expectedUpdatedAt: report.updatedAt })
      // 保存成功后清除本地暂存（refetch 触发 updatedAt 变化，本地态随之重置）
      try {
        window.sessionStorage.removeItem(draftKey)
      } catch (e) {
        console.error('清除报告草稿暂存失败', e)
      }
      setRestorable(null)
      flash('章节已保存')
    } catch (e) {
      if (isConflictError(e)) {
        openConflict()
      } else {
        flash((e as Error).message || '保存失败', 'error')
      }
    }
  }

  // ===== 409 冲突对话框：本地修改可复制，避免“直接还原丢弃” =====
  const [conflict, setConflict] = useState<{ changed: { title: string; text: string }[]; structural: boolean } | null>(null)
  const openConflict = () => {
    const changed = sections
      .filter((s) => !s.analysisId && drafts[s.id] !== undefined && drafts[s.id] !== s.content)
      .map((s) => ({ title: s.title || '自定义章节', text: htmlToText(drafts[s.id] ?? '') }))
    setConflict({ changed, structural: structureDirty })
  }

  const copyConflictText = async () => {
    if (!conflict) return
    const text = conflict.changed.map((c) => `【${c.title}】\n${c.text}`).join('\n\n') || '（无文本修改）'
    try {
      await navigator.clipboard.writeText(text)
      flash('本地修改已复制到剪贴板')
    } catch (e) {
      console.error('复制本地修改失败', e)
      flash('复制失败，请在对话框中手动选中文本复制', 'error')
    }
  }

  const discardConflictAndReload = () => {
    discardRestorable()
    setConflict(null)
    onReload()
  }

  // AI 生成章节：按报告主体范围拉取最新单项分析生成/更新引用章节
  const generateSections = useGenerateReportSections()
  const handleGenerate = async () => {
    if (!editable) return
    const ok = await confirm({
      title: 'AI 生成章节',
      description: '将按报告主体范围拉取最新单项分析，生成/更新实时引用章节；已有正文章节保留。继续？',
      confirmText: '生成',
    })
    if (!ok) return
    try {
      await generateSections.mutateAsync(report.id)
      flash('章节已生成')
    } catch (e) {
      if (isConflictError(e)) {
        openConflict()
      } else {
        flash((e as Error).message || '生成失败', 'error')
      }
    }
  }

  // 标题重命名（失焦提交）
  const updateReport = useUpdateReport()
  const [titleDraft, setTitleDraft] = useState(report.title)
  const titleLoadedId = useRef(report.id)
  if (titleLoadedId.current !== report.id) {
    titleLoadedId.current = report.id
    setTitleDraft(report.title)
  }
  const handleTitleBlur = async () => {
    const next = titleDraft.trim()
    if (!editable || !next || next === report.title) {
      setTitleDraft(report.title)
      return
    }
    try {
      await updateReport.mutateAsync({ id: report.id, data: { title: next } })
      flash('标题已更新')
    } catch (e) {
      setTitleDraft(report.title)
      flash((e as Error).message || '标题更新失败', 'error')
    }
  }

  // 导出 Word / PDF
  const [exporting, setExporting] = useState<'docx' | 'pdf' | null>(null)
  const handleExport = async (format: 'docx' | 'pdf') => {
    setExporting(format)
    try {
      const data = await api.exportReport(report.id, format)
      if (format === 'docx') await exportReportToDocx(data)
      else await exportReportToPdf(data)
    } catch (e) {
      flash((e as Error).message || '导出失败', 'error')
    } finally {
      setExporting(null)
    }
  }

  // 图表插入上下文：期间取报告期间；公司取报告主体（单体公司才有科目指标口径，汇总主体由用户在插入对话框自行选择）
  const chartContext = useMemo(
    () => ({ companyCode: report.companyScope.type === 'company' ? report.companyScope.code : '', period: report.period }),
    [report.companyScope, report.period],
  )

  // 另存为模板：当前章节（本地态优先）快照为自定义模板蓝图
  const canCreate = can('reports', 'create')
  const createTemplate = useCreateReportTemplate()
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDesc, setTemplateDesc] = useState('')
  const handleSaveAsTemplate = async () => {
    const name = templateName.trim()
    if (!name) return
    try {
      await createTemplate.mutateAsync({
        name,
        description: templateDesc.trim() || undefined,
        sections: sections.map((s) => ({ title: s.title || '自定义章节', content: effectiveContent(s) })),
      })
      setTemplateDialogOpen(false)
      flash(`已保存为模板「${name}」`)
    } catch (e) {
      flash((e as Error).message || '保存模板失败', 'error')
    }
  }

  // 版本管理
  const { data: versionsData, isLoading: versionsLoading } = useReportVersions(report.id)
  const versions = versionsData?.items ?? []
  const saveVersion = useSaveReportVersion()
  const rollbackVersion = useRollbackReportVersion()
  const [versionDialogOpen, setVersionDialogOpen] = useState(false)
  const [changeSummary, setChangeSummary] = useState('')
  const [viewingVersion, setViewingVersion] = useState<ReportVersionItem | null>(null)

  const handleOpenSaveVersion = () => {
    setChangeSummary('')
    setVersionDialogOpen(true)
  }

  const handleSaveVersion = async () => {
    try {
      const res = await saveVersion.mutateAsync({
        id: report.id,
        changeSummary: changeSummary.trim() || undefined,
        expectedUpdatedAt: report.updatedAt,
      })
      setVersionDialogOpen(false)
      flash(`已保存版本 v${res.versionNo}`)
    } catch (e) {
      if (isConflictError(e)) {
        setVersionDialogOpen(false)
        openConflict()
      } else {
        flash((e as Error).message || '保存版本失败', 'error')
      }
    }
  }

  const handleRollback = async (v: ReportVersionItem) => {
    const ok = await confirm({
      title: `回滚到 v${v.versionNo}`,
      description: '当前章节内容将被该版本快照覆盖（仅草稿可回滚，回滚后可再存新版本）。确认回滚？',
      confirmText: '回滚',
      danger: true,
    })
    if (!ok) return
    try {
      await rollbackVersion.mutateAsync({ id: report.id, versionNo: v.versionNo })
      flash(`已回滚到 v${v.versionNo}`)
    } catch (e) {
      if (isConflictError(e)) {
        openConflict()
      } else {
        flash((e as Error).message || '回滚失败', 'error')
      }
    }
  }

  // 左侧大纲搜索 + 定位
  const [outlineQuery, setOutlineQuery] = useState('')
  const outlineSections = useMemo(() => {
    const q = outlineQuery.trim().toLowerCase()
    return q ? sections.filter((s) => s.title.toLowerCase().includes(q)) : sections
  }, [sections, outlineQuery])

  const jumpTo = (sectionId: string) => {
    document.getElementById(`report-section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // 底部时间线：最近 5 个版本升序展示
  const timelineVersions = useMemo(
    () => [...versions].sort((a, b) => a.versionNo - b.versionNo).slice(-5),
    [versions],
  )

  const scopeName = getDisplayName(report.companyScope.code, report.companyScope.name ?? report.companyScope.code)

  return (
    <div className="animate-fade-in space-y-0">
      {/* 顶部 PageHead：标题 + 状态 + 操作 */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-card px-4 py-4 sm:px-6">
        <div className="min-w-0">
          {editable ? (
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleBlur}
              aria-label="报告标题"
              className="w-full max-w-[480px] rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-2xl font-semibold leading-tight text-foreground transition-colors hover:border-input focus:border-primary focus:bg-card focus:outline-none"
            />
          ) : (
            <h1 className="px-1.5 text-2xl font-semibold leading-tight text-foreground">{report.title}</h1>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 text-body text-muted-foreground">
            <Badge variant={REPORT_STATUS_BADGE_VARIANT[report.status] ?? 'secondary'}>
              {REPORT_STATUS_LABEL[report.status] ?? report.status}
            </Badge>
            <span>{scopeName}</span>
            <span className="before:mr-2 before:text-border before:content-['·']">财年 {report.fiscalYear} · 期间 {report.period}</span>
            <span className="before:mr-2 before:text-border before:content-['·']">v{report.currentVersion}</span>
            <span className="before:mr-2 before:text-border before:content-['·']">更新于 {new Date(report.updatedAt).toLocaleString('zh-CN')}</span>
            {editable && dirty && (
              <span className="before:mr-2 before:text-border before:content-['·'] text-warning-strong">● 有未保存修改</span>
            )}
            {!editable && (
              <span className="before:mr-2 before:text-border before:content-['·'] text-warning-strong">
                仅草稿可编辑章节{canUpdate ? '' : '（无编辑权限）'}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <>
              <Button variant="fused" size="sm" onClick={handleGenerate} disabled={generateSections.isPending}>
                {generateSections.isPending
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                AI 生成章节
              </Button>
              <Button variant="outline" size="sm" onClick={handleSaveSections} disabled={!dirty || setSections.isPending}>
                {setSections.isPending
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <Save className="mr-1.5 h-3.5 w-3.5" />}
                保存章节{dirty ? ' *' : ''}
              </Button>
              <Button variant="outline" size="sm" onClick={handleOpenSaveVersion} disabled={saveVersion.isPending}>
                <GitCommitVertical className="mr-1.5 h-3.5 w-3.5" /> 保存版本
              </Button>
              {canCreate && (
                <Button variant="outline" size="sm" onClick={() => { setTemplateName(''); setTemplateDesc(''); setTemplateDialogOpen(true) }}>
                  <LayoutTemplate className="mr-1.5 h-3.5 w-3.5" /> 另存为模板
                </Button>
              )}
            </>
          )}
          {canExport && (
            <>
              <Button variant="outline" size="sm" onClick={() => handleExport('docx')} disabled={exporting !== null}>
                {exporting === 'docx' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
                导出 Word
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleExport('pdf')} disabled={exporting !== null}>
                {exporting === 'pdf' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                导出 PDF
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 三栏布局：左大纲 / 中编辑 / 右信息+版本 */}
      <div className="grid grid-cols-[120px_minmax(0,1fr)_140px] border-b border-border bg-muted lg:grid-cols-[240px_minmax(0,1fr)_280px]">
        {/* 左侧章节大纲 */}
        <aside className="border-r border-border bg-card">
          <div className="py-4">
            <div className="px-3 pb-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground lg:px-5 lg:text-xs">章节大纲</div>
            <div className="relative mx-3 mb-3 lg:mx-4">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground lg:left-2.5 lg:h-3.5 lg:w-3.5" />
              <input
                value={outlineQuery}
                onChange={(e) => setOutlineQuery(e.target.value)}
                placeholder="搜索章节…"
                className="h-6 w-full rounded-sm border border-border bg-muted pl-6 pr-2 text-[10px] text-foreground transition-colors focus:border-primary focus:outline-none lg:h-7 lg:pl-8 lg:text-caption"
              />
            </div>
            {sections.length === 0 ? (
              <p className="px-3 text-[10px] leading-relaxed text-muted-foreground lg:px-5 lg:text-caption">
                暂无章节，可「AI 生成章节」或手动添加空白章节。
              </p>
            ) : (
              outlineSections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jumpTo(s.id)}
                  className="flex w-full items-center gap-1.5 border-l-2 border-transparent px-3 py-1 text-left text-[10px] leading-tight text-foreground transition-all hover:bg-muted hover:text-primary lg:px-5 lg:py-1.5 lg:text-caption"
                >
                  <span className="min-w-[18px] tabular-nums text-muted-foreground lg:min-w-[22px]">{sections.indexOf(s) + 1}</span>
                  <span className="truncate" title={s.title || '自定义章节'}>{s.title || '自定义章节'}</span>
                  {s.analysisId && <Link2 className="ml-auto h-3 w-3 shrink-0 text-primary/60" />}
                </button>
              ))
            )}
          </div>
        </aside>

        {/* 中部：章节编辑区 */}
        <section className="bg-muted px-2 py-3 sm:px-4 sm:py-6 lg:px-8">
          <div className="mx-auto max-w-[820px] space-y-3 lg:space-y-4">
            {msg && (
              <Card className="rounded-large p-2.5">
                <FlashMessage type={msg.type}>{msg.text}</FlashMessage>
              </Card>
            )}

            {/* 本地草稿恢复提示（上次会话未保存的修改） */}
            {editable && restorable && (
              <Card className="flex flex-wrap items-center justify-between gap-2 rounded-large p-3">
                <span className="text-body text-foreground">
                  检测到未保存的本地草稿{restorable.savedAt ? `（${new Date(restorable.savedAt).toLocaleString('zh-CN')}）` : ''}，是否恢复？
                </span>
                <span className="flex items-center gap-2">
                  <Button size="sm" onClick={applyRestorable}>恢复</Button>
                  <Button size="sm" variant="ghost" onClick={discardRestorable}>丢弃</Button>
                </span>
              </Card>
            )}

            {sections.length === 0 ? (
              <div className="rounded-large border border-border bg-card">
                <EmptyState
                  icon={Sparkles}
                  title="报告还没有章节"
                  description={editable
                    ? '可让 AI 按主体范围生成引用章节，或手动添加空白章节自由撰写。'
                    : '该报告尚未编制章节。'}
                  action={editable && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={handleGenerate} disabled={generateSections.isPending}>
                        {generateSections.isPending
                          ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                        AI 生成章节
                      </Button>
                      <Button size="sm" variant="outline" onClick={addSection}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> 添加空白章节
                      </Button>
                    </div>
                  )}
                />
              </div>
            ) : (
              <>
                {sections.map((s, idx) => (
                  <SectionPaper
                    key={s.id}
                    section={s}
                    index={idx}
                    total={sections.length}
                    editable={editable && !s.analysisId && !s.missing}
                    canManage={editable}
                    content={effectiveContent(s)}
                    dirty={drafts[s.id] !== undefined && drafts[s.id] !== s.content}
                    chartContext={chartContext}
                    onChange={(html) => setDraft(s.id, html)}
                    onTitleChange={(t) => updateSectionTitle(idx, t)}
                    onMoveUp={() => moveSection(idx, -1)}
                    onMoveDown={() => moveSection(idx, 1)}
                    onRemove={() => removeSection(idx)}
                  />
                ))}
                {editable && (
                  <button
                    type="button"
                    onClick={addSection}
                    className="flex w-full items-center justify-center gap-1.5 rounded-large border border-dashed border-border bg-card/50 px-4 py-3 text-body text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Plus className="h-4 w-4" /> 添加空白章节
                  </button>
                )}
              </>
            )}
          </div>
        </section>

        {/* 右侧：报告信息 + 版本历史 */}
        <aside className="border-l border-border bg-card">
          <div className="border-b border-border px-2 py-2 lg:px-5 lg:py-4">
            <div className="mb-1.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground lg:mb-2.5 lg:text-xs">报告信息</div>
            <div className="space-y-1 text-[10px] leading-relaxed text-muted-foreground lg:text-caption">
              <div className="flex justify-between gap-2"><span>主体</span><span className="truncate text-foreground" title={scopeName}>{scopeName}</span></div>
              <div className="flex justify-between gap-2"><span>类型</span><span className="text-foreground">{report.companyScope.type === 'summary' ? '汇总主体' : '单体公司'}</span></div>
              <div className="flex justify-between gap-2"><span>期间</span><span className="text-foreground">{report.period}</span></div>
              <div className="flex justify-between gap-2"><span>章节数</span><span className="text-foreground">{sections.length}</span></div>
              <div className="flex justify-between gap-2"><span>当前版本</span><span className="text-foreground">v{report.currentVersion}</span></div>
            </div>
          </div>
          <div className="px-2 py-2 lg:px-5 lg:py-4">
            <div className="mb-1.5 flex items-center justify-between text-[9px] font-medium uppercase tracking-wider text-muted-foreground lg:mb-2.5 lg:text-xs">
              <span>版本历史</span>
              {versionsLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            {versions.length === 0 ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground lg:text-caption">
                暂无版本快照。编辑章节后点击「保存版本」留存快照。
              </p>
            ) : (
              <ul className="space-y-1.5">
                {versions.slice(0, 8).map((v) => (
                  <li key={v.id} className="rounded-sm border border-border bg-card px-1.5 py-1 lg:px-2 lg:py-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-medium text-foreground lg:text-caption">v{v.versionNo}</span>
                      <span className="flex items-center gap-0.5">
                        <button
                          type="button"
                          aria-label={`查看 v${v.versionNo} 快照`}
                          onClick={() => setViewingVersion(v)}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-primary"
                        >
                          <Eye className="h-3 w-3" />
                        </button>
                        {editable && (
                          <button
                            type="button"
                            aria-label={`回滚到 v${v.versionNo}`}
                            onClick={() => handleRollback(v)}
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-primary"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="truncate text-[9px] text-muted-foreground lg:text-[11px]" title={v.changeSummary ?? ''}>
                      {v.changeSummary || '无变更说明'}
                    </div>
                    <div className="text-[9px] text-muted-foreground lg:text-[11px]">
                      {new Date(v.changedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {v.changedBy ? ` · ${v.changedBy}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {/* 底部版本时间线（真实版本快照，最多展示最近 5 个） */}
      {timelineVersions.length > 0 && (
        <div className="sticky bottom-0 z-10 border-t border-border bg-card px-4 py-4 sm:px-8">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-caption font-medium text-muted-foreground">
              版本时间线（共 {versions.length} 个版本，当前 v{report.currentVersion}）
            </span>
            {editable && (
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-caption" onClick={handleOpenSaveVersion} disabled={saveVersion.isPending}>
                {saveVersion.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <History className="mr-1 h-3 w-3" />}
                保存当前为版本
              </Button>
            )}
          </div>
          <div className="mt-2 flex items-start">
            {timelineVersions.map((v, i) => (
              <TimelineStep
                key={v.id}
                index={i + 1}
                title={`v${v.versionNo}${v.changeSummary ? ` · ${v.changeSummary}` : ''}`}
                desc={`${new Date(v.changedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}${v.changedBy ? ` · ${v.changedBy}` : ''}`}
                done={v.versionNo < report.currentVersion}
                current={v.versionNo === report.currentVersion}
                onClick={() => setViewingVersion(v)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 保存版本对话框 */}
      <Dialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>保存版本快照</DialogTitle>
            <DialogDescription>
              将当前章节内容留存为 v{report.currentVersion + 1} 快照，可随时查看或回滚。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="change-summary">变更说明（可选）</Label>
              <Textarea
                id="change-summary"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                rows={3}
                placeholder="如：更新收入结构章节、AI 润色完成"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionDialogOpen(false)} disabled={saveVersion.isPending}>取消</Button>
            <Button onClick={handleSaveVersion} disabled={saveVersion.isPending}>
              {saveVersion.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} 保存版本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 另存为模板对话框 */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>另存为模板</DialogTitle>
            <DialogDescription>
              将当前 {sections.length} 个章节（含未保存的本地修改）保存为自定义模板，新建报告时可一键套用。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">模板名称</Label>
              <Input
                id="template-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="如：季度经营分析模板"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-desc">说明（可选）</Label>
              <Input
                id="template-desc"
                value={templateDesc}
                onChange={(e) => setTemplateDesc(e.target.value)}
                placeholder="模板适用场景说明"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)} disabled={createTemplate.isPending}>取消</Button>
            <Button onClick={handleSaveAsTemplate} disabled={!templateName.trim() || createTemplate.isPending}>
              {createTemplate.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} 保存模板
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 版本快照查看 */}
      <VersionSnapshotDialog
        reportId={report.id}
        version={viewingVersion}
        onClose={() => setViewingVersion(null)}
      />

      {/* 409 冲突对话框：报告已被他人修改，本地修改可复制后重载 */}
      <Dialog open={!!conflict} onOpenChange={(o) => { if (!o) setConflict(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>报告已被其他人修改</DialogTitle>
            <DialogDescription>
              保存前有其他用户更新了该报告，本地未保存修改无法自动合并。建议先复制留存，再加载最新内容。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[45vh] space-y-2 overflow-y-auto">
            {conflict && conflict.changed.length > 0 ? (
              conflict.changed.map((c, i) => (
                <div key={i} className="rounded-md border border-border">
                  <div className="border-b bg-muted/50 px-3 py-1.5 text-body font-medium text-foreground">{c.title}</div>
                  <p className="whitespace-pre-wrap px-3 py-2 text-caption leading-relaxed text-muted-foreground">
                    {c.text || '（空内容）'}
                  </p>
                </div>
              ))
            ) : (
              <p className="py-2 text-body text-muted-foreground">未检测到正文文本修改。</p>
            )}
            {conflict?.structural && (
              <p className="text-caption text-warning-strong">另有章节结构调整（新增/删除/排序/标题）未在上方列出。</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflict(null)}>取消</Button>
            <Button variant="outline" onClick={copyConflictText}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> 复制全部修改
            </Button>
            <Button onClick={discardConflictAndReload}>放弃修改并加载最新</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmElement}
    </div>
  )
}

/** 单章节纸张块：正文章节可编辑（RichTextEditor），引用章节只读展示实时分析内容 */
function SectionPaper({
  section, index, total, editable, canManage, content, dirty, chartContext,
  onChange, onTitleChange, onMoveUp, onMoveDown, onRemove,
}: {
  section: EditorSection
  index: number
  total: number
  editable: boolean
  canManage: boolean
  content: string
  dirty: boolean
  chartContext?: { companyCode: string; period: string }
  onChange: (html: string) => void
  onTitleChange: (title: string) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  const canEditTitle = canManage && !section.analysisId
  return (
    <div id={`report-section-${section.id}`} className="relative rounded-large border border-border bg-card p-3 shadow-sm scroll-mt-24 sm:p-6 sm:px-8 lg:p-10">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {canEditTitle ? (
          <input
            value={section.title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="章节标题…"
            aria-label="章节标题"
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-lg font-semibold leading-snug text-foreground transition-colors hover:border-input focus:border-primary focus:outline-none"
          />
        ) : (
          <h2 className="text-lg font-semibold leading-snug text-foreground">
            {index + 1}. {section.title || '自定义章节'}
          </h2>
        )}
        {dirty && <Pill tone="orange">未保存</Pill>}
        {section.analysisId ? (
          <Pill tone="blue" className="gap-0.5"><Link2 className="h-3 w-3" /> 引用单项分析</Pill>
        ) : (
          <Pill tone="gray">正文</Pill>
        )}
        {section.source && (
          <span className="text-caption text-muted-foreground">
            {section.source.companyName ?? section.source.companyCode} · {section.source.subjectName ?? section.source.subjectCode} · {section.source.period}
          </span>
        )}
        {canManage && (
          <span className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              aria-label="上移"
              title="上移"
              disabled={index === 0}
              onClick={onMoveUp}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="下移"
              title="下移"
              disabled={index === total - 1}
              onClick={onMoveDown}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="删除章节"
              title="删除章节"
              onClick={onRemove}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive-50 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>

      {section.missing ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-destructive-100 bg-destructive-50 px-4 py-3 text-body text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          该单项分析原文已删除，章节内容不可用。
        </div>
      ) : section.analysisId ? (
        <>
          <RichTextEditor value={content} onChange={onChange} editable={false} />
          <p className="mt-1.5 text-caption text-muted-foreground">实时引用：内容随单项分析更新，如需修改请前往「单项分析报告」编辑原文。</p>
        </>
      ) : (
        <RichTextEditor
          value={content}
          onChange={onChange}
          editable={editable}
          polishEnabled={editable}
          chartContext={chartContext}
          placeholder="撰写章节内容…"
        />
      )}
    </div>
  )
}

function TimelineStep({
  index, title, desc, done, current, onClick,
}: {
  index: number
  title: string
  desc: string
  done?: boolean
  current?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-1 items-start text-left',
        // 段间连接线
        'after:absolute after:left-7 after:right-0 after:top-3.5 after:h-px after:bg-border after:content-[""]',
        done && 'after:!bg-primary',
      )}
    >
      <div
        className={cn(
          'z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-card text-caption font-medium tabular-nums',
          done && 'border-primary bg-primary !text-card',
          current && 'border-primary bg-card text-primary shadow-[0_0_0_3px_rgba(22,119,255,0.1)]',
          !done && !current && 'border-input text-muted-foreground',
        )}
      >
        {index}
      </div>
      <div className="ml-2.5 flex-1 pt-0.5">
        <div className="truncate text-caption font-medium text-foreground" title={title}>{title}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{desc}</div>
      </div>
    </button>
  )
}

/** 版本快照查看：只读渲染快照章节 */
function VersionSnapshotDialog({ reportId, version, onClose }: {
  reportId: string
  version: ReportVersionItem | null
  onClose: () => void
}) {
  const { data: snapshot, isLoading } = useReportVersionSnapshot(
    version ? reportId : null,
    version ? version.versionNo : null,
  )

  return (
    <Dialog open={!!version} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>版本快照 v{version?.versionNo}</DialogTitle>
          <DialogDescription>
            {version?.changeSummary || '无变更说明'}
            {version ? ` · ${new Date(version.changedAt).toLocaleString('zh-CN')}${version.changedBy ? ` · ${version.changedBy}` : ''}` : ''}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">快照加载中…</div>
        ) : !snapshot ? (
          <div className="py-12 text-center text-sm text-muted-foreground">快照内容为空</div>
        ) : (
          <div className="space-y-4">
            {snapshot.snapshot.sections.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">该版本未留存章节内容</p>
            ) : (
              snapshot.snapshot.sections.map((s, idx) => (
                <div key={idx} className="rounded-md border border-border">
                  <div className="border-b bg-muted/50 px-3 py-1.5 text-body font-medium text-foreground">
                    {idx + 1}. {s.title}
                  </div>
                  {s.missing ? (
                    <p className="px-3 py-2 text-body text-muted-foreground">（该单项分析原文已删除）</p>
                  ) : (
                    <RichTextEditor value={s.content} onChange={() => {}} editable={false} className="rounded-none border-0" />
                  )}
                </div>
              ))
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ReportEditor
