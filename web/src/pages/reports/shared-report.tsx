import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileText, Loader2, TriangleAlert, Link2, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { api } from '@/lib/api'
import { REPORT_STATUS_LABEL, REPORT_STATUS_BADGE_VARIANT } from '@/lib/constants'

/**
 * 报告公开分享页（/shared/:token，免登录）：
 * - 调用公开端点 GET /api/v1/reports/shared/:token（token 即授权，独立限流）
 * - 只读浏览：标题/元信息/章节正文（图表节点无登录态时降级为占位说明）
 * - 内容为"实时只读"——随原文更新；报告撤回发布/吊销链接后立即失效
 */
export function SharedReportPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [retried, setRetried] = useState(0)
  const { data: report, isLoading, isError, error } = useQuery({
    queryKey: ['shared-report', token, retried] as const,
    queryFn: () => api.getSharedReport(token as string),
    retry: false,
    staleTime: 2 * 60 * 1000,
  })

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-[860px] px-4 py-8 sm:px-6">
        {isLoading ? (
          <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 报告加载中…
          </div>
        ) : isError || !report ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
            <TriangleAlert className="h-8 w-8 text-warning-strong" />
            <p className="text-body text-foreground">{(error as Error)?.message || '分享链接不存在或已失效'}</p>
            <Button variant="outline" size="sm" onClick={() => setRetried((r) => r + 1)}>重试</Button>
          </div>
        ) : (
          <div className="animate-fade-in space-y-4">
            {/* 元信息 */}
            <header className="rounded-lg border border-border bg-card p-5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={REPORT_STATUS_BADGE_VARIANT[report.status] ?? 'secondary'}>
                  {REPORT_STATUS_LABEL[report.status] ?? report.status}
                </Badge>
                <span className="text-caption text-muted-foreground">
                  分享只读版 · 内容随原文更新
                </span>
              </div>
              <h1 className="text-2xl font-semibold leading-tight text-foreground">{report.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
                <span>{report.companyScope.name ?? report.companyScope.code}</span>
                <span className="before:mr-2 before:text-border before:content-['·']">财年 {report.fiscalYear} · 期间 {report.period}</span>
                <span className="before:mr-2 before:text-border before:content-['·']">v{report.currentVersion}</span>
                <span className="before:mr-2 before:text-border before:content-['·']">更新于 {new Date(report.updatedAt).toLocaleString('zh-CN')}</span>
              </div>
            </header>

            {/* 章节正文 */}
            {report.sections.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-16 text-muted-foreground">
                <FileText className="h-8 w-8" />
                <p className="text-sm">该报告尚未编制章节</p>
              </div>
            ) : (
              report.sections.map((s, idx) => (
                <section key={s.id} className="rounded-lg border border-border bg-card p-4 sm:p-6 lg:p-8">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold leading-snug text-foreground">{idx + 1}. {s.title || '自定义章节'}</h2>
                    {s.analysisId && <span className="flex items-center gap-0.5 text-caption text-primary/70"><Link2 className="h-3 w-3" /> 实时引用</span>}
                  </div>
                  {s.missing ? (
                    <div className="flex items-center gap-2 rounded-md border border-dashed border-destructive-100 bg-destructive-50 px-4 py-3 text-body text-destructive">
                      <TriangleAlert className="h-4 w-4 shrink-0" />
                      该单项分析原文已删除，章节内容不可用。
                    </div>
                  ) : (
                    <RichTextEditor value={s.content} onChange={() => {}} editable={false} className="rounded-none border-0" />
                  )}
                </section>
              ))
            )}

            <footer className="flex flex-wrap items-center justify-between gap-2 pb-6 text-caption text-muted-foreground">
              <span>— 报告完 · 由「{report.companyScope.name ?? report.companyScope.code}」经营数据分析平台分享 —</span>
              <Button variant="outline" size="sm" className="h-7" onClick={() => navigate('/login')}>
                <LogIn className="mr-1 h-3 w-3" /> 登录查看更多
              </Button>
            </footer>
          </div>
        )}
      </div>
    </div>
  )
}

export default SharedReportPage
