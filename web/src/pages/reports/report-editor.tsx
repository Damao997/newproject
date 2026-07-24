import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowUp, ArrowDown, Trash2, Plus, Save, History, FileDown, RefreshCw, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { sanitizeForDisplay } from '@/lib/sanitize'
import { exportReportToDocx, exportReportToPdf } from '@/lib/report-export'
import {
  useReport, useGenerateReportSections, useSetReportSections,
  useSaveReportVersion, useReportVersions,
} from '@/hooks/api-queries'
import { api } from '@/lib/api'
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

const STATUS_LABEL: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' }

export function ReportEditor({ reportId, onBack }: { reportId: string; onBack: () => void }) {
  const { can } = usePermission()
  const canUpdate = can('reports', 'update')
  const canExport = can('reports', 'export')

  const { data: report, isLoading } = useReport(reportId)
  const generateSections = useGenerateReportSections()
  const setSections = useSetReportSections()
  const saveVersion = useSaveReportVersion()
  const { data: versions } = useReportVersions(reportId)

  const [sections, setSectionsLocal] = useState<SectionEdit[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // 服务端章节 → 本地编辑态
  useEffect(() => {
    if (!report) return
    setSectionsLocal(
      report.sections.map((s) => ({
        key: s.id,
        id: s.id,
        analysisId: s.analysisId,
        title: s.title,
        content: s.content,
        missing: s.missing,
        sourceLabel: s.source ? `${s.source.companyName ?? s.source.companyCode} · ${s.source.subjectName ?? s.source.subjectCode}` : null,
      })),
    )
  }, [report?.id, report?.sections.length, report?.updatedAt])

  if (isLoading || !report) {
    return <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
  }

  const flash = (m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg(null), 2500)
  }

  const move = (index: number, dir: -1 | 1) => {
    setSectionsLocal((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const removeSection = (key: string) => setSectionsLocal((prev) => prev.filter((s) => s.key !== key))

  const addFreeSection = () =>
    setSectionsLocal((prev) => [...prev, { key: `new-${Date.now()}`, title: '自定义章节', content: '' }])

  const updateSection = (key: string, patch: Partial<SectionEdit>) =>
    setSectionsLocal((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  const persistSections = async () => {
    try {
      await setSections.mutateAsync({
        id: reportId,
        items: sections.map((s) => (s.analysisId ? { analysisId: s.analysisId } : { id: s.id, title: s.title, content: s.content })),
      })
      flash('章节已保存')
    } catch (e) {
      flash((e as Error).message || '保存失败')
    }
  }

  const handleGenerate = async () => {
    try {
      await generateSections.mutateAsync(reportId)
      flash('已按主体范围拉取单项分析生成章节')
    } catch (e) {
      flash((e as Error).message || '生成失败')
    }
  }

  const handleSaveVersion = async () => {
    const summary = window.prompt('版本说明（可选）', '') ?? undefined
    try {
      const { versionNo } = await saveVersion.mutateAsync({ id: reportId, changeSummary: summary })
      flash(`已保存为 v${versionNo}`)
    } catch (e) {
      flash((e as Error).message || '保存版本失败')
    }
  }

  const handleExport = async (format: 'docx' | 'pdf') => {
    try {
      const data = await api.exportReport(reportId, format)
      if (format === 'docx') await exportReportToDocx(data)
      else exportReportToPdf(data)
    } catch (e) {
      flash((e as Error).message || '导出失败')
    }
  }

  const busy = setSections.isPending || generateSections.isPending || saveVersion.isPending

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <Card className="animate-fade-in">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" /> 返回列表</Button>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">{report.title}</h3>
                <Badge variant="secondary">{STATUS_LABEL[report.status] ?? report.status}</Badge>
                <span className="text-[12px] text-muted-foreground">v{report.currentVersion}</span>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {report.companyScope.name ?? report.companyScope.code}（{report.companyScope.type === 'summary' ? '汇总主体' : '公司'}）｜财年 {report.fiscalYear}｜期间 {report.period}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canUpdate && (
              <>
                <Button variant="outline" size="sm" onClick={handleGenerate} disabled={busy}><RefreshCw className="mr-1 h-4 w-4" /> 拉取单项分析</Button>
                <Button variant="outline" size="sm" onClick={addFreeSection} disabled={busy}><Plus className="mr-1 h-4 w-4" /> 自由章节</Button>
                <Button variant="outline" size="sm" onClick={persistSections} disabled={busy}><Save className="mr-1 h-4 w-4" /> 保存章节</Button>
                <Button variant="outline" size="sm" onClick={handleSaveVersion} disabled={busy}><History className="mr-1 h-4 w-4" /> 存版本</Button>
              </>
            )}
            {canExport && (
              <>
                <Button variant="outline" size="sm" onClick={() => handleExport('docx')}><FileDown className="mr-1 h-4 w-4" /> Word</Button>
                <Button variant="outline" size="sm" onClick={() => handleExport('pdf')}><FileDown className="mr-1 h-4 w-4" /> PDF</Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => setShowVersions((v) => !v)}><History className="mr-1 h-4 w-4" /> 版本历史</Button>
          </div>
        </CardContent>
      </Card>

      {msg && <p className="px-1 text-[13px] text-primary">{msg}</p>}

      {/* 版本历史 */}
      {showVersions && (
        <Card className="animate-fade-in">
          <CardContent className="p-4">
            <h4 className="mb-2 text-sm font-medium text-foreground">版本历史</h4>
            {versions && versions.items.length > 0 ? (
              <ul className="space-y-1 text-[13px] text-muted-foreground">
                {versions.items.map((v) => (
                  <li key={v.id} className="flex items-center gap-2">
                    <Badge variant="outline">v{v.versionNo}</Badge>
                    <span>{v.changeSummary || '（无说明）'}</span>
                    <span className="text-[12px]">{new Date(v.changedAt).toLocaleString('zh-CN')}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">暂无版本快照</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* 章节列表 */}
      <div className="space-y-3">
        {sections.length === 0 && (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">暂无章节，点击「拉取单项分析」按主体范围生成，或添加自由章节。</CardContent></Card>
        )}
        {sections.map((s, idx) => (
          <Card key={s.key} className="animate-fade-in">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-[12px] text-muted-foreground">{idx + 1}</span>
                  {s.analysisId ? (
                    <Badge variant="outline" className="shrink-0"><Link2 className="mr-1 h-3 w-3" /> 引用</Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0">自由</Badge>
                  )}
                  {s.analysisId ? (
                    <span className="truncate text-sm font-medium text-foreground">{s.sourceLabel ?? s.title}</span>
                  ) : (
                    <Input value={s.title} onChange={(e) => updateSection(s.key, { title: e.target.value })} className="h-7 max-w-[240px]" disabled={!canUpdate} />
                  )}
                  {s.missing && <Badge variant="destructive">原文已删除</Badge>}
                </div>
                {canUpdate && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => move(idx, -1)} disabled={idx === 0}><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => move(idx, 1)} disabled={idx === sections.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => removeSection(s.key)} className="text-finance-red"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </div>
              {/* 引用章节实时展示最新正文（只读）；自由章节可编辑 */}
              {s.analysisId ? (
                <div className="prose-editor max-w-none rounded-md border bg-muted/20 px-3 py-2 text-[13px]" dangerouslySetInnerHTML={{ __html: sanitizeForDisplay(s.content || '<p>（暂无内容）</p>') }} />
              ) : (
                <RichTextEditor value={s.content} onChange={(html) => updateSection(s.key, { content: html })} editable={canUpdate} placeholder="撰写该章节内容…" polishEnabled />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
