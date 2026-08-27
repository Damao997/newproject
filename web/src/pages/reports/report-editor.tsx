import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import {
  ArrowLeft, ArrowUp, ArrowDown, Trash2, Plus, Save, History, FileDown, RefreshCw, Link2,
  Send, Undo2, Eye, Sparkles, Loader2, MoreHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FlashMessage } from '@/components/ui/flash-message'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { sanitizeForDisplay } from '@/lib/sanitize'
import { exportReportToDocx, exportReportToPdf } from '@/lib/report-export'
import { useAiStream } from '@/hooks/use-ai-stream'
import {
  useReport, useGenerateReportSections, useSetReportSections,
  useSaveReportVersion, useReportVersions, useUpdateReport,
  useReportVersionSnapshot, useRollbackReportVersion,
} from '@/hooks/api-queries'
import { api } from '@/lib/api'
import { REPORT_STATUS_LABEL, REPORT_STATUS_BADGE_VARIANT } from '@/lib/constants'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { usePermission } from '@/hooks/usePermission'

/** 章节本地编辑态 */
interface SectionEdit {
  key: string
  id?: string
  analysisId?: string | null
  title: string
  content: string
  missing?: boolean
  sourceLabel?: string | null
}

/** 纯文本 → 段落 HTML（AI 概述插入用） */
function plainTextToHtml(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('')
}

export function ReportEditor() {
  const { reportId = '' } = useParams<{ reportId: string }>()
  const navigate = useNavigate()
  const { can } = usePermission()
  const canUpdate = can('reports', 'update')
  const canExport = can('reports', 'export')
  const { headerRef } = useStickyHeader()

  const { data: report, isLoading, isError } = useReport(reportId)
  const generateSections = useGenerateReportSections()
  const setSections = useSetReportSections()
  const saveVersion = useSaveReportVersion()
  const updateReport = useUpdateReport()
  const rollbackVersion = useRollbackReportVersion()
  const { data: versions } = useReportVersions(reportId)
  const { confirm, element: confirmElement } = useConfirm()
  const { getDisplayName } = useCompanyDisplayName()

  const [sections, setSectionsLocal] = useState<SectionEdit[]>([])
  const [dirty, setDirty] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [versionDialogOpen, setVersionDialogOpen] = useState(false)
  const [versionSummary, setVersionSummary] = useState('')
  const [viewVersionNo, setViewVersionNo] = useState<number | null>(null)
  const [aiOpen, setAiOpen] = useState(false)

  // 服务端章节 → 本地编辑态（有未保存编辑时不覆盖，防止 refetch 吞掉用户输入）
  useEffect(() => {
    if (!report || dirty) return
    setSectionsLocal(
      report.sections.map((s) => ({
        key: s.id,
        id: s.id,
        analysisId: s.analysisId,
        title: s.title,
        content: s.content,
        missing: s.missing,
        sourceLabel: s.source ? `${getDisplayName(s.source.companyCode, s.source.companyName)} · ${s.source.subjectName ?? s.source.subjectCode}` : null,
      })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id, report?.updatedAt, dirty])

  // 未保存编辑离开页面提示
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // 路由直达 /reports/:id/edit 时报告可能不存在（404/已删除）：显式错误态而非永久加载中
  if (isError || (!report && !isLoading)) {
    return (
      <PageContainer title="报告编辑" stickyHeader headerRef={headerRef}>
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">报告不存在或已删除</p>
          <Button variant="fused" size="sm" className="mt-3" onClick={() => navigate('/reports')}>返回报告列表</Button>
        </div>
      </PageContainer>
    )
  }

  if (isLoading || !report) {
    return (
      <PageContainer title="报告编辑" stickyHeader headerRef={headerRef}>
        <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
      </PageContainer>
    )
  }

  const isDraft = report.status === 'draft'
  const canEdit = canUpdate && isDraft

  const flash = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setMsg({ type, text })
    window.setTimeout(() => setMsg(null), 2500)
  }

  const markDirty = () => setDirty(true)

  const handleBack = async () => {
    if (dirty) {
      const ok = await confirm({
        title: '存在未保存的章节修改',
        description: '返回列表将丢弃未保存的修改，确认离开？',
        confirmText: '放弃修改并离开',
        danger: true,
      })
      if (!ok) return
    }
    navigate('/reports')
  }

  const move = (index: number, dir: -1 | 1) => {
    setSectionsLocal((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    markDirty()
  }

  const removeSection = (key: string) => {
    setSectionsLocal((prev) => prev.filter((s) => s.key !== key))
    markDirty()
  }

  const addFreeSection = (title = '自定义章节', content = '') => {
    setSectionsLocal((prev) => [...prev, { key: `new-${Date.now()}`, title, content }])
    markDirty()
  }

  const updateSection = (key: string, patch: Partial<SectionEdit>) => {
    setSectionsLocal((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
    markDirty()
  }

  const persistSections = async () => {
    try {
      await setSections.mutateAsync({
        id: reportId,
        items: sections.map((s) => (s.analysisId ? { analysisId: s.analysisId } : { id: s.id, title: s.title, content: s.content })),
        expectedUpdatedAt: report.updatedAt,
      })
      setDirty(false)
      flash('章节已保存')
    } catch (e) {
      flash((e as Error).message || '保存失败', 'error')
    }
  }

  const handleGenerate = async () => {
    try {
      await generateSections.mutateAsync(reportId)
      setDirty(false)
      flash('已按主体范围拉取单项分析生成章节')
    } catch (e) {
      flash((e as Error).message || '生成失败', 'error')
    }
  }

  const handleSaveVersion = async () => {
    try {
      const { versionNo } = await saveVersion.mutateAsync({
        id: reportId,
        changeSummary: versionSummary.trim() || undefined,
        expectedUpdatedAt: report.updatedAt,
      })
      setVersionDialogOpen(false)
      setVersionSummary('')
      flash(`已保存为 v${versionNo}`)
    } catch (e) {
      flash((e as Error).message || '保存版本失败', 'error')
    }
  }

  const handleStatusChange = async (status: string, label: string) => {
    if (dirty && status === 'published') {
      flash('存在未保存的章节修改，请先保存章节', 'info')
      return
    }
    try {
      await updateReport.mutateAsync({ id: reportId, data: { status } })
      flash(label)
    } catch (e) {
      flash((e as Error).message || '状态更新失败', 'error')
    }
  }

  const handleRollback = async (versionNo: number) => {
    const ok = await confirm({
      title: `回退到 v${versionNo}`,
      description: '当前章节将被该版本快照整体替换（引用章节保留实时引用）。建议先「存版本」保留当前内容。',
      confirmText: '回退',
      danger: true,
    })
    if (!ok) return
    try {
      await rollbackVersion.mutateAsync({ id: reportId, versionNo })
      setDirty(false)
      setViewVersionNo(null)
      flash(`已回退到 v${versionNo}`)
    } catch (e) {
      flash((e as Error).message || '回退失败', 'error')
    }
  }

  const handleExport = async (format: 'docx' | 'pdf') => {
    try {
      const data = await api.exportReport(reportId, format)
      if (format === 'docx') await exportReportToDocx(data)
      else await exportReportToPdf(data)
    } catch (e) {
      flash((e as Error).message || '导出失败', 'error')
    }
  }

  const busy = setSections.isPending || generateSections.isPending || saveVersion.isPending || updateReport.isPending || rollbackVersion.isPending

  return (
    <PageContainer title="报告编辑" stickyHeader headerRef={headerRef}>
      <div className="space-y-3">
      {/* 工具栏：主动作常驻（AI 概述/保存章节/发布），次动作收入「更多」菜单 */}
      <Card className="animate-fade-in border border-border">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-foreground">{report.title}</h3>
              <Badge variant={REPORT_STATUS_BADGE_VARIANT[report.status] ?? 'secondary'}>{REPORT_STATUS_LABEL[report.status] ?? report.status}</Badge>
              <span className="text-helper text-muted-foreground">v{report.currentVersion}</span>
              {dirty && <Badge variant="destructive">未保存</Badge>}
            </div>
            <p className="text-helper text-muted-foreground">
              {report.companyScope.name ?? report.companyScope.code}（{report.companyScope.type === 'summary' ? '汇总主体' : '公司'}）｜财年 {report.fiscalYear}｜期间 {report.period}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <>
                <Button variant="outline" size="sm" onClick={() => setAiOpen(true)} disabled={busy}><Sparkles className="mr-1 h-4 w-4" /> AI 概述</Button>
                <Button variant="outline" size="sm" onClick={persistSections} disabled={busy}><Save className="mr-1 h-4 w-4" /> 保存章节</Button>
                <Button size="sm" onClick={() => handleStatusChange('published', '报告已发布')} disabled={busy}><Send className="mr-1 h-4 w-4" /> 发布</Button>
              </>
            )}
            {canUpdate && report.status === 'published' && (
              <Button variant="outline" size="sm" onClick={() => handleStatusChange('draft', '已撤回为草稿')} disabled={busy}><Undo2 className="mr-1 h-4 w-4" /> 撤回为草稿</Button>
            )}
            {canUpdate && report.status === 'archived' && (
              <Button variant="outline" size="sm" onClick={() => handleStatusChange('draft', '已恢复为草稿')} disabled={busy}><Undo2 className="mr-1 h-4 w-4" /> 恢复为草稿</Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="更多操作">
                  <MoreHorizontal className="mr-1 h-4 w-4" /> 更多
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={handleBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> 返回列表
                </DropdownMenuItem>
                {canEdit && (
                  <>
                    <DropdownMenuItem onClick={handleGenerate} disabled={busy}>
                      <RefreshCw className="mr-2 h-4 w-4" /> 拉取单项分析
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => addFreeSection()} disabled={busy}>
                      <Plus className="mr-2 h-4 w-4" /> 自由章节
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setVersionDialogOpen(true)} disabled={busy}>
                      <History className="mr-2 h-4 w-4" /> 存版本
                    </DropdownMenuItem>
                  </>
                )}
                {canExport && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleExport('docx')}>
                      <FileDown className="mr-2 h-4 w-4" /> 导出 Word
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport('pdf')}>
                      <FileDown className="mr-2 h-4 w-4" /> 导出 PDF
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowVersions((v) => !v)}>
                  <History className="mr-2 h-4 w-4" /> 版本历史
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      {msg && <FlashMessage type={msg.type} className="px-1">{msg.text}</FlashMessage>}
      {!isDraft && (
        <p className="px-1 text-body text-muted-foreground">
          当前报告为{REPORT_STATUS_LABEL[report.status] ?? report.status}状态，内容只读；如需修改请先{report.status === 'published' ? '撤回' : '恢复'}为草稿。
        </p>
      )}

      {/* 版本历史 */}
      {showVersions && (
        <Card className="animate-fade-in border border-border">
          <CardContent className="p-4">
            <h4 className="mb-2 text-sm font-medium text-foreground">版本历史</h4>
            {versions && versions.items.length > 0 ? (
              <ul className="space-y-1 text-body text-muted-foreground">
                {versions.items.map((v) => (
                  <li key={v.id} className="flex items-center gap-2">
                    <Badge variant="outline">v{v.versionNo}</Badge>
                    <span>{v.changeSummary || '（无说明）'}</span>
                    <span className="text-helper">{new Date(v.changedAt).toLocaleString('zh-CN')}</span>
                    <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setViewVersionNo(v.versionNo)}>
                      <Eye className="mr-1 h-3.5 w-3.5" /> 查看
                    </Button>
                    {canEdit && (
                      <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => handleRollback(v.versionNo)} disabled={busy}>
                        <Undo2 className="mr-1 h-3.5 w-3.5" /> 回退
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted-foreground">暂无版本快照</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* 章节列表 */}
      <div className="space-y-3">
        {sections.length === 0 && (
          <Card className="border border-border"><CardContent className="py-12 text-center text-sm text-muted-foreground">暂无章节{canEdit ? '，点击「拉取单项分析」按主体范围生成，或添加自由章节。' : '。'}</CardContent></Card>
        )}
        {sections.map((s, idx) => (
          <Card key={s.key} className="animate-fade-in border border-border">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-helper text-muted-foreground">{idx + 1}</span>
                  {s.analysisId ? (
                    <Badge variant="outline" className="shrink-0"><Link2 className="mr-1 h-3 w-3" /> 引用</Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0">自由</Badge>
                  )}
                  {s.analysisId ? (
                    <span className="truncate text-sm font-medium text-foreground">{s.sourceLabel ?? s.title}</span>
                  ) : (
                    <Input value={s.title} onChange={(e) => updateSection(s.key, { title: e.target.value })} className="h-7 max-w-[240px]" disabled={!canEdit} />
                  )}
                  {s.missing && <Badge variant="destructive">原文已删除</Badge>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" aria-label="上移章节" onClick={() => move(idx, -1)} disabled={idx === 0}><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" aria-label="下移章节" onClick={() => move(idx, 1)} disabled={idx === sections.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" aria-label="删除章节" onClick={() => removeSection(s.key)} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </div>
              {/* 引用章节实时展示最新正文（只读）；自由章节草稿态可编辑 */}
              {s.analysisId ? (
                <div className="prose-editor max-w-none rounded-md border bg-muted/20 px-3 py-2 text-body" dangerouslySetInnerHTML={{ __html: sanitizeForDisplay(s.content || '<p>（暂无内容）</p>') }} />
              ) : canEdit ? (
                <RichTextEditor value={s.content} onChange={(html) => updateSection(s.key, { content: html })} editable placeholder="撰写该章节内容…" polishEnabled />
              ) : (
                <div className="prose-editor max-w-none rounded-md border bg-muted/20 px-3 py-2 text-body" dangerouslySetInnerHTML={{ __html: sanitizeForDisplay(s.content || '<p>（暂无内容）</p>') }} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 存版本对话框 */}
      <Dialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>保存版本快照</DialogTitle>
            <DialogDescription>冻结当前全文为 v{report.currentVersion + 1}，可随时查看或回退。</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input value={versionSummary} onChange={(e) => setVersionSummary(e.target.value)} placeholder="版本说明（可选），如：月度定稿" autoFocus />
            {dirty && <p className="text-helper text-destructive">存在未保存的章节修改，快照将基于已保存内容，建议先「保存章节」。</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionDialogOpen(false)}>取消</Button>
            <Button onClick={handleSaveVersion} disabled={saveVersion.isPending}>保存版本</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 版本快照查看 */}
      <VersionSnapshotDialog reportId={reportId} versionNo={viewVersionNo} onClose={() => setViewVersionNo(null)} canRollback={canEdit} onRollback={handleRollback} busy={busy} />

      {/* AI 总体概述 */}
      <AISummaryDialog
        reportId={reportId}
        open={aiOpen}
        onOpenChange={setAiOpen}
        onInsert={(text) => {
          addFreeSection('总体概述', `<div data-ai-suggested="true">${plainTextToHtml(text)}<p><em>本段内容由 AI 辅助生成，最终数据以指标表为准</em></p></div>`)
          setAiOpen(false)
          flash('已插入「总体概述」自由章节，请保存章节')
        }}
      />

      {confirmElement}
      </div>
    </PageContainer>
  )
}

/** 版本快照只读查看对话框 */
function VersionSnapshotDialog({ reportId, versionNo, onClose, canRollback, onRollback, busy }: {
  reportId: string
  versionNo: number | null
  onClose: () => void
  canRollback: boolean
  onRollback: (versionNo: number) => void
  busy: boolean
}) {
  const { data, isLoading } = useReportVersionSnapshot(versionNo ? reportId : null, versionNo)
  return (
    <Dialog open={!!versionNo} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>版本快照 v{versionNo}</DialogTitle>
          <DialogDescription>
            {data ? `${data.changeSummary || '（无说明）'}｜${new Date(data.changedAt).toLocaleString('zh-CN')}` : '加载中…'}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
        ) : (
          <div className="space-y-3">
            {data.snapshot.sections.length === 0 && <p className="text-sm text-muted-foreground">该版本无章节。</p>}
            {data.snapshot.sections.map((s, i) => (
              <div key={i} className="rounded-md border p-3">
                <p className="mb-1 text-sm font-medium text-foreground">{i + 1}. {s.title}{s.missing && <Badge variant="destructive" className="ml-2">原文已删除</Badge>}</p>
                <div className="prose-editor max-w-none text-body" dangerouslySetInnerHTML={{ __html: sanitizeForDisplay(s.content || '<p>（暂无内容）</p>') }} />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          {canRollback && versionNo && (
            <Button variant="outline" onClick={() => onRollback(versionNo)} disabled={busy}><Undo2 className="mr-1 h-4 w-4" /> 回退到此版本</Button>
          )}
          <Button onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** AI 总体概述对话框：SSE 流式预览 → 确认插入为自由章节 */
function AISummaryDialog({ reportId, open, onOpenChange, onInsert }: {
  reportId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onInsert: (text: string) => void
}) {
  const [text, setText] = useState('')
  const ai = useAiStream({
    path: '/ai/report-summary',
    body: { reportId },
    onDone: (finalText) => {
      if (finalText) setText(finalText)
    },
  })

  const start = () => {
    setText('')
    ai.start()
  }

  const stop = ai.abort

  const handleOpenChange = (v: boolean) => {
    if (!v) stop()
    onOpenChange(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI 总体概述</DialogTitle>
          <DialogDescription>基于报告各章节内容生成「总体概述」初稿（预览确认后插入，不直接修改报告）。</DialogDescription>
        </DialogHeader>
        <div aria-live="polite" className="min-h-[160px] whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-body leading-6 text-foreground">
          {text || ai.preview || (ai.streaming ? '生成中…' : '点击「开始生成」获取概述初稿。')}
          {ai.streaming && <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        {ai.error && <p className="text-body text-destructive">{ai.error}</p>}
        <DialogFooter>
          {ai.streaming ? (
            <Button variant="outline" onClick={stop}>停止</Button>
          ) : (
            <Button variant="outline" onClick={start}><Sparkles className="mr-1 h-4 w-4" /> {text ? '重新生成' : '开始生成'}</Button>
          )}
          <Button onClick={() => onInsert(text)} disabled={!text || ai.streaming}>插入为自由章节</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
