import { useEffect, useMemo, useRef, useState } from 'react'
import { Save, Trash2, FileText, Sparkles, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SheetShell } from '@/components/ui/sheet-shell'
import { FlashMessage } from '@/components/ui/flash-message'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { ContextChip } from '@/components/analysis/context-chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useAiStream } from '@/hooks/use-ai-stream'
import { useAnalysisForm } from '@/hooks/use-analysis-form'
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
  subjectType: 'operating' | 'static' | 'cashflow'
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

export function AnalysisDrawer({ open, target, onClose }: AnalysisDrawerProps) {
  // 以 公司×科目×期间 为键重挂载表单：目标切换时所有 state（标题/正文/既有ID/反馈/AI 流）从零初始化，
  // 避免上一科目的内容残留到新科目（旧实现依赖异步查询结果回填，查询键命中缓存时会写入旧内容）。
  const targetKey = open && target ? `${target.companyCode}|${target.subjectCode}|${target.period}` : 'closed'
  if (!open || !target) return null
  return <DrawerBody key={targetKey} target={target} onClose={onClose} />
}

/** 抽屉表单主体：随 target 键重建，挂载后查询既有分析并一次性回填 */
function DrawerBody({ target, onClose }: { target: AnalysisTarget; onClose: () => void }) {
  // AI 初稿：流式预览 → 完成后"确认插入"正文（与润色预览→确认模式一致，不自动覆盖编辑器）
  const [aiDraft, setAiDraft] = useState('')
  const ai = useAiStream({
    path: '/ai/analyze',
    body: {
      companyCode: target.companyCode,
      subjectCode: target.subjectCode,
      subjectType: target.subjectType,
      period: target.period,
    },
    onDone: (finalText) => setAiDraft((finalText || '').trim()),
  })

  const metricContext = useMemo(() => {
    if (!target.metric) return null
    const m = target.metric
    // 无预算场景（如库存分析）：快照不含 budget/achievement，避免依赖全年预算口径
    return target.showBudget === false
      ? { actual: m.actual, samePeriod: m.samePeriod, ytd: m.ytd, samePeriodYtd: m.samePeriodYtd, yoy: calcYoy(m) }
      : {
          budget: m.budget, actual: m.actual, samePeriod: m.samePeriod, ytd: m.ytd,
          yoy: calcYoy(m), achievement: calcAchievement(m),
        }
  }, [target?.metric, target?.showBudget])

  // 表单状态机（既有查询回填/保存/删除）与往来抽屉共用
  const form = useAnalysisForm({
    fetchParams: { companyCode: target.companyCode, subjectCode: target.subjectCode, period: target.period },
    buildPayload: (title, content) => ({
      companyCode: target.companyCode,
      subjectCode: target.subjectCode,
      subjectType: target.subjectType,
      fiscalYear: target.fiscalYear,
      period: target.period,
      title,
      content,
      metricContext,
    }),
    defaultTitle: () => `${target.subjectName} 分析`,
  })

  const handleGenerateDraft = () => {
    setAiDraft('')
    ai.start()
  }

  /** 确认插入：将已生成的初稿追加到正文编辑器（带 data-ai-suggested 标识） */
  const handleInsertDraft = () => {
    if (!aiDraft) return
    form.setContent(`${form.content ?? ''}${wrapAiDraft(aiDraft)}`)
    setAiDraft('')
  }

  // 已保存内容快照：回填完成（title 首次非空）与保存成功后记录；与当前值对比判断是否有未保存修改
  const savedRef = useRef<{ title: string; content: string } | null>(null)
  // 注意：依赖仅 [form.title] 是有意为之——title/content 变化不应刷新快照（否则保存后继续编辑会把未保存值误记为已保存）
  useEffect(() => {
    if (!savedRef.current && form.title) {
      savedRef.current = { title: form.title, content: form.content }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.title])
  useEffect(() => {
    if (form.feedback?.type === 'ok') {
      savedRef.current = { title: form.title, content: form.content }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.feedback])
  const isDirty = savedRef.current !== null && (form.title !== savedRef.current.title || form.content !== savedRef.current.content)

  // 统一关闭流程：有未保存修改时先确认（X/遮罩/Escape/取消按钮均走此路径）
  const { confirm, element } = useConfirm()
  const handleClose = async () => {
    if (isDirty) {
      const ok = await confirm({
        title: '放弃未保存内容？',
        description: '关闭将丢失尚未保存的标题或正文修改。',
        confirmText: '放弃修改',
      })
      if (!ok) return
    }
    onClose()
  }

  const m = target.metric
  return (
    <>
    <SheetShell
      onClose={() => void handleClose()}
      icon={<FileText className="mt-0.5 h-5 w-5 text-primary" />}
      title="单项分析"
      description={`${target.companyName} · ${target.subjectName} · ${target.period}`}
      footer={(
        <>
          <div>
            {form.existingId && (
              <Button variant="outline" size="sm" onClick={form.remove} disabled={form.busy} className="text-destructive">
                <Trash2 className="mr-1 h-4 w-4" /> 删除
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleClose()} disabled={form.busy}>取消</Button>
            <Button size="sm" onClick={form.save} disabled={form.busy || !form.title.trim()}>
              <Save className="mr-1 h-4 w-4" /> 保存
            </Button>
          </div>
        </>
      )}
    >
        {/* 指标上下文：按值类型格式化，仅金额类标注“(万)”；同比统一按相对增长率；达成率 = 本年累计 / 全年预算 */}
        {m && (() => {
          const vt = target.valueType
          const unit = vt === 'ratio' || vt === 'quantity' ? '' : '(万)'
          const fmt = (v: number) => formatMetricValue(v, vt)
          const yoyText = formatPercent(calcYoy(m))
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
            <Input id="analysis-title" value={form.title} onChange={(e) => form.setTitle(e.target.value)} placeholder="如：灶具收入分析" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>分析内容</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateDraft}
                disabled={ai.streaming}
                aria-busy={ai.streaming}
                className="h-7 text-primary"
              >
                {ai.streaming ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                AI 生成初稿
              </Button>
            </div>
            {(ai.streaming || ai.preview || aiDraft || ai.error) && (
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-body leading-relaxed" aria-live="polite">
                {ai.error ? (
                  <span className="text-destructive">{ai.error}</span>
                ) : (
                  <>
                    <p className="mb-1 flex items-center gap-1 text-caption text-muted-foreground">
                      <Sparkles className="h-3 w-3 text-primary" />
                      {ai.streaming ? 'AI 初稿生成中…（模型推理通常需 10-40 秒）' : 'AI 初稿已生成（预览确认后插入正文）'}
                    </p>
                    <p className="whitespace-pre-wrap text-foreground">{ai.preview || aiDraft || '…'}</p>
                    {aiDraft && !ai.streaming && (
                      <Button variant="outline" size="sm" onClick={handleInsertDraft} className="mt-2 h-7 text-primary">
                        <Check className="mr-1 h-3.5 w-3.5" /> 插入正文
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
            <RichTextEditor value={form.content} onChange={form.setContent} placeholder="撰写该指标的分析结论…" polishEnabled />
          </div>
          {form.feedback && (
            <FlashMessage type={form.feedback.type === 'ok' ? 'success' : 'error'}>{form.feedback.msg}</FlashMessage>
          )}
        </div>
      </SheetShell>
      {element}
      {form.confirmElement}
    </>
  )
}
