import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Drawer } from 'antd'
import {
  ArrowLeft, FileText, Loader2, FileDown, Download, Share2, Pencil, List, Link2,
  ChevronUp, Sparkles, X, Copy, Eye, TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FlashMessage } from '@/components/ui/flash-message'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { usePermission } from '@/hooks/usePermission'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { useAiStream } from '@/hooks/use-ai-stream'
import {
  useReport, useReportShare, useCreateReportShare, useRevokeReportShare,
  type ReportDetail,
} from '@/hooks/api-queries'
import { REPORT_STATUS_LABEL, REPORT_STATUS_BADGE_VARIANT } from '@/lib/constants'
import { api } from '@/lib/api'
import { exportReportToDocx, exportReportToPdf } from '@/lib/report-export'
import { cn } from '@/lib/utils'

/**
 * 报告阅读视图（/reports/:reportId/read）—— Power BI 式编制/阅读态分离。
 * - 隐藏编制工具栏/版本面板/AI 润色；顶部固定元信息条 + 操作（导出/分享/编辑）
 * - 左侧目录常驻 + scroll-spy 当前章节高亮 + 引用章节标识；移动端（≤768px）目录折叠为底部抽屉
 * - 首屏 AI 概述卡片（reports:create 权限可生成，SSE 流式预览）
 * - 顶部阅读进度条 + 回到顶部；@media print 打印样式（globals.css）
 * - 分享：仅 published 报告，有效期 7/30/永久，可复制链接/吊销
 */

export function ReportReader() {
  const { reportId } = useParams<{ reportId: string }>()
  const { data: report, isLoading, isError, error, refetch } = useReport(reportId ?? null)

  return (
    <div className="-mx-4 -mt-6 flex flex-col bg-page sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 print:-mx-0 print:bg-white">
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
        <ReaderShell report={report} />
      )}
    </div>
  )
}

function ReaderShell({ report }: { report: ReportDetail }) {
  const navigate = useNavigate()
  const { can } = usePermission()
  const { getDisplayName } = useCompanyDisplayName()
  const canCreate = can('reports', 'create')
  const canUpdate = can('reports', 'update')
  const canExport = can('reports', 'export')
  const { confirm, element: confirmElement } = useConfirm()
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const flash = (text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ type, text })
    window.setTimeout(() => setMsg(null), 3000)
  }
  const scopeName = getDisplayName(report.companyScope.code, report.companyScope.name ?? report.companyScope.code)

  // ===== scroll-spy：IntersectionObserver 高亮当前章节 =====
  const [activeId, setActiveId] = useState<string>('')
  const sectionsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = sectionsRef.current
    if (!container || report.sections.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        // 取视口内最靠上的章节为当前章节
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) setActiveId(visible[0].target.id.replace('reader-section-', ''))
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    )
    report.sections.forEach((s) => {
      const el = document.getElementById(`reader-section-${s.id}`)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [report.sections])

  // ===== 阅读进度条 + 回到顶部 =====
  const [progress, setProgress] = useState(0)
  const [showTop, setShowTop] = useState(false)
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement
      const total = h.scrollHeight - h.clientHeight
      setProgress(total > 0 ? Math.min(100, Math.round((h.scrollTop / total) * 100)) : 0)
      setShowTop(h.scrollTop > 600)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const jumpTo = (sectionId: string) => {
    setTocOpen(false)
    document.getElementById(`reader-section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ===== 移动端目录抽屉 =====
  const [tocOpen, setTocOpen] = useState(false)
  const OutlineList = ({ onJump }: { onJump: (id: string) => void }) => (
    <nav aria-label="章节目录">
      {report.sections.length === 0 ? (
        <p className="px-2 text-caption text-muted-foreground">该报告暂无章节。</p>
      ) : (
        <ul className="space-y-0.5">
          {report.sections.map((s, idx) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onJump(s.id)}
                className={cn(
                  'flex w-full items-center gap-2 border-l-2 border-transparent px-3 py-1.5 text-left text-caption transition-all hover:bg-muted hover:text-primary',
                  activeId === s.id && 'border-primary bg-primary/5 text-primary',
                )}
              >
                <span className="min-w-[20px] tabular-nums text-muted-foreground">{idx + 1}</span>
                <span className="truncate" title={s.title || '自定义章节'}>{s.title || '自定义章节'}</span>
                {s.analysisId && <Link2 className="ml-auto h-3 w-3 shrink-0 text-primary/60" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )

  // ===== 导出 =====
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

  // ===== AI 概述（reports:create 权限；SSE 流式） =====
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryText, setSummaryText] = useState('')
  const ai = useAiStream({
    path: '/ai/report-summary',
    body: () => ({ reportId: report.id }),
    onDone: (ft) => setSummaryText(ft || ''),
  })
  useEffect(() => {
    if (summaryOpen && !ai.streaming && !ai.preview && !summaryText && !ai.error) ai.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryOpen])

  // ===== 分享 =====
  const [shareOpen, setShareOpen] = useState(false)
  const { data: shareInfo } = useReportShare(shareOpen ? report.id : null)
  const createShare = useCreateReportShare()
  const revokeShare = useRevokeReportShare()
  const [expiresDays, setExpiresDays] = useState<string>('30')
  const shareUrl = shareInfo ? `${window.location.origin}/shared/${shareInfo.shareToken}` : ''

  const handleCreateShare = async (regenerate = false) => {
    try {
      await createShare.mutateAsync({ id: report.id, data: { expiresDays: expiresDays === 'permanent' ? null : Number(expiresDays), regenerate } })
      flash(regenerate ? '分享链接已重置' : '分享已开启')
    } catch (e) {
      flash((e as Error).message || '分享设置失败', 'error')
    }
  }

  const handleCopyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      flash('分享链接已复制')
    } catch (e) {
      console.error('复制分享链接失败', e)
      flash('复制失败，请手动选择链接复制', 'error')
    }
  }

  const handleRevokeShare = async () => {
    const ok = await confirm({
      title: '关闭分享',
      description: '关闭后已发出的链接将立即失效，不可恢复。确认关闭？',
      confirmText: '关闭分享',
      danger: true,
    })
    if (!ok) return
    try {
      await revokeShare.mutateAsync(report.id)
      flash('已关闭分享')
    } catch (e) {
      flash((e as Error).message || '关闭分享失败', 'error')
    }
  }

  return (
    <div className="animate-fade-in">
      {/* 阅读进度条 */}
      <div className="sticky top-0 z-20 h-0.5 w-full bg-transparent print:hidden">
        <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${progress}%` }} />
      </div>

      {/* 顶部元信息条 */}
      <div className="sticky top-0.5 z-10 border-b border-border bg-card/95 px-4 py-3 backdrop-blur sm:px-6 print:static print:border-0 print:bg-white print:px-0">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="ghost" size="sm" className="h-8 px-2 print:hidden" onClick={() => navigate('/reports')} aria-label="返回列表">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground" title={report.title}>{report.title}</h1>
          <div className="flex items-center gap-2 print:hidden">
            {/* 移动端目录抽屉触发 */}
            <Button variant="outline" size="sm" className="h-8 px-2 lg:hidden" onClick={() => setTocOpen(true)} aria-label="打开目录">
              <List className="h-4 w-4" />
            </Button>
            {canExport && (
              <>
                <Button variant="outline" size="sm" className="h-8" onClick={() => handleExport('docx')} disabled={exporting !== null}>
                  {exporting === 'docx' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1 h-3.5 w-3.5" />} Word
                </Button>
                <Button variant="outline" size="sm" className="h-8" onClick={() => handleExport('pdf')} disabled={exporting !== null}>
                  {exporting === 'pdf' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />} PDF
                </Button>
              </>
            )}
            {canUpdate && report.status === 'published' && (
              <Button variant="outline" size="sm" className="h-8" onClick={() => setShareOpen(true)}>
                <Share2 className="mr-1 h-3.5 w-3.5" /> 分享
              </Button>
            )}
            {canUpdate && report.status === 'draft' && (
              <Button variant="fused" size="sm" className="h-8" onClick={() => navigate(`/reports/${report.id}/edit`)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> 编辑
              </Button>
            )}
          </div>
        </div>
        <div className="mx-auto mt-1.5 flex max-w-[1080px] flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
          <Badge variant={REPORT_STATUS_BADGE_VARIANT[report.status] ?? 'secondary'}>
            {REPORT_STATUS_LABEL[report.status] ?? report.status}
          </Badge>
          <span>{scopeName}</span>
          <span className="before:mr-2 before:text-border before:content-['·']">财年 {report.fiscalYear} · 期间 {report.period}</span>
          <span className="before:mr-2 before:text-border before:content-['·']">v{report.currentVersion}</span>
          <span className="before:mr-2 before:text-border before:content-['·']">更新于 {new Date(report.updatedAt).toLocaleString('zh-CN')}</span>
        </div>
      </div>

      {/* 主体：左目录 + 正文 */}
      <div className="mx-auto flex max-w-[1080px] gap-6 px-4 py-6 sm:px-6">
        {/* 桌面目录（lg+ 常驻） */}
        <aside className="sticky top-24 hidden h-fit max-h-[calc(100vh-120px)] w-56 shrink-0 overflow-y-auto rounded-lg border border-border bg-card p-3 lg:block print:hidden">
          <div className="mb-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">章节目录</div>
          <OutlineList onJump={jumpTo} />
        </aside>

        {/* 正文 */}
        <main ref={sectionsRef} className="min-w-0 flex-1 space-y-4">
          {msg && <FlashMessage type={msg.type} className="print:hidden">{msg.text}</FlashMessage>}

          {/* AI 概述卡片（5 秒看到结论；编制权限可生成） */}
          {canCreate && report.sections.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4 print:hidden">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-body font-medium text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" /> AI 概述
                </span>
                <div className="flex items-center gap-2">
                  {summaryOpen && !ai.streaming && summaryText && (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-caption" onClick={() => ai.start()}>重新生成</Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7" onClick={() => setSummaryOpen((o) => !o)}>
                    {summaryOpen ? <X className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {summaryOpen ? '收起' : '生成概述'}
                  </Button>
                </div>
              </div>
              {summaryOpen && (
                <div className="mt-3 text-body leading-relaxed text-foreground" aria-live="polite">
                  {ai.error ? (
                    <span className="text-destructive">{ai.error}</span>
                  ) : ai.preview || summaryText ? (
                    <p className="whitespace-pre-wrap">{ai.preview || summaryText}</p>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> 生成中…</span>
                  )}
                </div>
              )}
            </div>
          )}

          {report.sections.length === 0 ? (
            <div className="rounded-lg border border-border bg-card">
              <EmptyState icon={FileText} title="该报告尚未编制章节" />
            </div>
          ) : (
            report.sections.map((s, idx) => (
              <section key={s.id} id={`reader-section-${s.id}`} className="scroll-mt-28 rounded-lg border border-border bg-card p-4 sm:p-6 lg:p-8 print:rounded-none print:border-0 print:p-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold leading-snug text-foreground">{idx + 1}. {s.title || '自定义章节'}</h2>
                  {s.analysisId && <span className="flex items-center gap-0.5 text-caption text-primary/70"><Link2 className="h-3 w-3" /> 实时引用</span>}
                  {s.source && (
                    <span className="text-caption text-muted-foreground">
                      {s.source.companyName ?? s.source.companyCode} · {s.source.subjectName ?? s.source.subjectCode} · {s.source.period}
                    </span>
                  )}
                </div>
                {s.missing ? (
                  <div className="flex items-center gap-2 rounded-md border border-dashed border-destructive-100 bg-destructive-50 px-4 py-3 text-body text-destructive">
                    <TriangleAlert className="h-4 w-4 shrink-0" />
                    该单项分析原文已删除，章节内容不可用。
                  </div>
                ) : (
                  <RichTextEditor
                    value={s.content}
                    onChange={() => {}}
                    editable={false}
                    className="rounded-none border-0"
                  />
                )}
              </section>
            ))
          )}

          <p className="pb-4 text-center text-caption text-muted-foreground">— 报告完 —</p>
        </main>
      </div>

      {/* 回到顶部 */}
      {showTop && (
        <button
          type="button"
          aria-label="回到顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:text-primary print:hidden"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
      )}

      {/* 移动端目录抽屉 */}
      <Drawer
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        placement="bottom"
        height="60%"
        title="章节目录"
      >
        <OutlineList onJump={jumpTo} />
      </Drawer>

      {/* 分享对话框 */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>分享报告</DialogTitle>
            <DialogDescription>生成只读链接，未登录同事可直接打开（内容随原文实时更新，仅已发布报告可分享）。</DialogDescription>
          </DialogHeader>
          {shareInfo ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-caption text-foreground" title={shareUrl}>{shareUrl}</span>
                <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={handleCopyShare}>
                  <Copy className="mr-1 h-3 w-3" /> 复制
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
                <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> 已被浏览 {shareInfo.viewCount} 次</span>
                <span>有效期至：{shareInfo.expiresAt ? new Date(shareInfo.expiresAt).toLocaleDateString('zh-CN') : '永久'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={expiresDays} onValueChange={setExpiresDays}>
                  <SelectTrigger className="h-8 w-32 text-caption"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 天</SelectItem>
                    <SelectItem value="30">30 天</SelectItem>
                    <SelectItem value="permanent">永久</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-8" disabled={createShare.isPending} onClick={() => handleCreateShare(false)}>
                  更新有效期
                </Button>
                <Button size="sm" variant="outline" className="h-8" disabled={createShare.isPending} onClick={() => handleCreateShare(true)}>
                  重置链接
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-destructive" disabled={revokeShare.isPending} onClick={handleRevokeShare}>
                  关闭分享
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Select value={expiresDays} onValueChange={setExpiresDays}>
                  <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 天有效</SelectItem>
                    <SelectItem value="30">30 天有效</SelectItem>
                    <SelectItem value="permanent">永久有效</SelectItem>
                  </SelectContent>
                </Select>
                <Button className="h-9" disabled={createShare.isPending} onClick={() => handleCreateShare(false)}>
                  {createShare.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} 生成分享链接
                </Button>
              </div>
              <p className="text-caption text-muted-foreground">链接可随时吊销或重置；每次访问均记入审计。</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {confirmElement}
    </div>
  )
}

export default ReportReader
