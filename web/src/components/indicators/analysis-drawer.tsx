import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Save, Trash2, FileText, Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { useAnalyses, useCreateAnalysis, useUpdateAnalysis, useDeleteAnalysis } from '@/hooks/api-queries'
import { streamAI, type StreamController } from '@/lib/ai-stream'
import { formatMetricValue, formatPercent, type MetricValueType } from '@/lib/utils'
import { calcYoy, calcAchievement, type MetricValue } from '@/lib/metric-values'

/** 将 AI 初稿纯文本包装为带 data-ai-suggested 标识的 HTML 段 */
function wrapAiDraft(text: string): string {
  const paras = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => `<p>${l.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('')
  return `<div data-ai-suggested="true">${paras}<p><em>本段内容由 AI 辅助生成，最终数据以指标表为准</em></p></div>`
}

/**
 * 单项分析编辑抽屉：针对 公司 × 科目 × 期间 撰写/编辑/删除分析结论。
 * 顶部展示该指标的结构化上下文（预算/实际/同比/达成率），正文为 TipTap 富文本。
 */

export interface AnalysisTarget {
  companyCode: string
  companyName: string
  subjectCode: string
  subjectName: string
  subjectType: 'operating' | 'static'
  /** 值类型：决定指标上下文的格式化与单位标注（缺省金额） */
  valueType?: MetricValueType
  /** 是否展示预算类指标上下文（缺省 true；库存等无预算场景传 false，隐藏全年预算/达成率并排除保存字段） */
  showBudget?: boolean
  fiscalYear: string
  period: string
  metric?: MetricValue
}

interface AnalysisDrawerProps {
  open: boolean
  target: AnalysisTarget | null
  onClose: () => void
}

function ContextChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-md border bg-muted/30 px-3 py-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="font-num text-[13px] text-foreground">{value}</span>
    </div>
  )
}

export function AnalysisDrawer({ open, target, onClose }: AnalysisDrawerProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [existingId, setExistingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  // AI 初稿流式状态
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiPreview, setAiPreview] = useState('')
  const [aiError, setAiError] = useState<string | null>(null)
  const aiCtrlRef = useRef<StreamController | null>(null)

  // 读取该 公司×科目×期间 既有分析
  const { data } = useAnalyses(
    open && target ? { companyCode: target.companyCode, subjectCode: target.subjectCode, period: target.period } : { companyCode: '__none__' },
  )
  const existing = data?.items?.[0]

  // 目标切换 / 打开时回填表单
  useEffect(() => {
    if (!open || !target) return
    if (existing) {
      setExistingId(existing.id)
      setTitle(existing.title)
      setContent(existing.content)
    } else {
      setExistingId(null)
      setTitle(`${target.subjectName} 分析`)
      setContent('')
    }
    setFeedback(null)
  }, [open, target?.companyCode, target?.subjectCode, target?.period, existing?.id])

  const createMutation = useCreateAnalysis()
  const updateMutation = useUpdateAnalysis()
  const deleteMutation = useDeleteAnalysis()
  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

  const metricContext = useMemo(() => {
    if (!target?.metric) return null
    const m = target.metric
    // 无预算场景（如库存分析）：快照不含 budget/achievement，避免依赖全年预算口径
    return target.showBudget === false
      ? { actual: m.actual, samePeriod: m.samePeriod, ytd: m.ytd, samePeriodYtd: m.samePeriodYtd, yoy: calcYoy(m) }
      : {
          budget: m.budget, actual: m.actual, samePeriod: m.samePeriod, ytd: m.ytd,
          yoy: calcYoy(m), achievement: calcAchievement(m),
        }
  }, [target?.metric, target?.showBudget])

  if (!open || !target) return null

  const handleGenerateDraft = () => {
    setAiError(null)
    setAiPreview('')
    setAiStreaming(true)
    aiCtrlRef.current?.abort()
    aiCtrlRef.current = streamAI('/ai/analyze', {
      companyCode: target.companyCode,
      subjectCode: target.subjectCode,
      subjectType: target.subjectType,
      period: target.period,
    }, {
      onToken: (d) => setAiPreview((p) => p + d),
      onDone: (finalText) => {
        setAiStreaming(false)
        const draft = (finalText || '').trim()
        if (draft) setContent((prev) => `${prev ?? ''}${wrapAiDraft(draft)}`)
      },
      onError: (msg) => { setAiError(msg); setAiStreaming(false) },
    })
  }

  const handleSave = async () => {
    setFeedback(null)
    try {
      if (existingId) {
        await updateMutation.mutateAsync({ id: existingId, data: { title, content, metricContext } })
        setFeedback({ type: 'ok', msg: '已保存修改' })
      } else {
        const created = await createMutation.mutateAsync({
          companyCode: target.companyCode,
          subjectCode: target.subjectCode,
          subjectType: target.subjectType,
          fiscalYear: target.fiscalYear,
          period: target.period,
          title,
          content,
          metricContext,
        })
        setExistingId(created.id)
        setFeedback({ type: 'ok', msg: '已新增分析' })
      }
    } catch (e) {
      setFeedback({ type: 'err', msg: (e as Error).message || '保存失败' })
    }
  }

  const handleDelete = async () => {
    if (!existingId) return
    if (!window.confirm('确认删除该单项分析？删除后引用它的报告章节将标记为“原文已删除”。')) return
    setFeedback(null)
    try {
      await deleteMutation.mutateAsync(existingId)
      setExistingId(null)
      setTitle(`${target.subjectName} 分析`)
      setContent('')
      setFeedback({ type: 'ok', msg: '已删除' })
    } catch (e) {
      setFeedback({ type: 'err', msg: (e as Error).message || '删除失败' })
    }
  }

  const m = target.metric
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col border-l bg-background shadow-xl animate-in slide-in-from-right duration-200">
        {/* 头部 */}
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div className="flex items-start gap-2">
            <FileText className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <h3 className="text-base font-semibold text-foreground">单项分析</h3>
              <p className="text-[13px] text-muted-foreground">
                {target.companyName} · {target.subjectName} · {target.period}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 指标上下文：按值类型格式化，仅金额类标注“(万)”；比率科目同比为百分点差；达成率 = 本年累计 / 全年预算 */}
        {m && (() => {
          const vt = target.valueType
          const unit = vt === 'ratio' || vt === 'quantity' ? '' : '(万)'
          const fmt = (v: number) => formatMetricValue(v, vt)
          const yoyText = vt === 'ratio' ? `${((m.actual - m.samePeriod) * 100).toFixed(1)}pp` : formatPercent(calcYoy(m))
          if (target.showBudget === false) {
            // 无预算场景（如库存分析）：仅展示库存语义指标，不呈现全年预算/达成率
            return (
              <div className="grid grid-cols-2 gap-2 border-b px-5 py-3 sm:grid-cols-4">
                <ContextChip label={`本期金额${unit}`} value={fmt(m.actual)} />
                <ContextChip label={`年初金额${unit}`} value={fmt(m.budget)} />
                <ContextChip label={`同期金额${unit}`} value={fmt(m.samePeriod)} />
                <ContextChip label="同比" value={yoyText} />
              </div>
            )
          }
          return (
            <div className="grid grid-cols-3 gap-2 border-b px-5 py-3 sm:grid-cols-6">
              <ContextChip label={`全年预算${unit}`} value={fmt(m.budget)} />
              <ContextChip label={`本月实际${unit}`} value={fmt(m.actual)} />
              <ContextChip label={`本年累计${unit}`} value={fmt(m.ytd)} />
              <ContextChip label={`同期${unit}`} value={fmt(m.samePeriod)} />
              <ContextChip label="同比" value={yoyText} />
              <ContextChip label="达成率" value={formatPercent(calcAchievement(m))} />
            </div>
          )
        })()}

        {/* 表单 */}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="analysis-title">分析标题</Label>
            <Input id="analysis-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：灶具收入分析" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>分析内容</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateDraft}
                disabled={aiStreaming}
                className="h-7 text-primary"
              >
                {aiStreaming ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                AI 生成初稿
              </Button>
            </div>
            {(aiStreaming || aiPreview || aiError) && (
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-[13px] leading-relaxed">
                {aiError ? (
                  <span className="text-finance-red">{aiError}</span>
                ) : (
                  <>
                    <p className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Sparkles className="h-3 w-3 text-primary" /> AI 初稿预览{aiStreaming ? '（生成中…）' : '（已完成，自动插入下方编辑器）'}
                    </p>
                    <p className="whitespace-pre-wrap text-foreground">{aiPreview || '…'}</p>
                  </>
                )}
              </div>
            )}
            <RichTextEditor value={content} onChange={setContent} placeholder="撰写该指标的分析结论…" polishEnabled />
          </div>
          {feedback && (
            <p className={feedback.type === 'ok' ? 'text-[13px] text-finance-green' : 'text-[13px] text-finance-red'}>{feedback.msg}</p>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between border-t px-5 py-3">
          <div>
            {existingId && (
              <Button variant="outline" size="sm" onClick={handleDelete} disabled={busy} className="text-finance-red">
                <Trash2 className="mr-1 h-4 w-4" /> 删除
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>取消</Button>
            <Button size="sm" onClick={handleSave} disabled={busy || !title.trim()}>
              <Save className="mr-1 h-4 w-4" /> {existingId ? '保存修改' : '新增分析'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
