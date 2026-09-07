import { FileText } from 'lucide-react'
import { cn, formatMetricValue, formatMoneyWan } from '@/lib/utils'
import type { KeyMetricsGroup } from '@/types'

/** 差距分析输入行：与整体核心指标总览的渲染行同构（label + valueType + 指标组） */
export interface GapAnalysisRow {
  key: string
  label: string
  valueType: 'amount' | 'quantity' | 'ratio'
  g: KeyMetricsGroup
}

/** 差距分析条目：key=行标识；text=完整句（含【指标名】前缀与句读标点） */
export interface GapAnalysisItem {
  key: string
  label: string
  text: string
}

/** 同比子句口径与 DeltaTag 一致：入参为小数比率，|v|<0.05% 视为持平；prefix 区分「同比/财年同比」 */
function yoyPhrase(yoy: number, prefix: '' | '财年'): string {
  if (!Number.isFinite(yoy) || Math.abs(yoy) < 0.0005) return `${prefix}同比持平`
  const pct = (Math.abs(yoy) * 100).toFixed(1)
  return `${prefix}同比${yoy > 0 ? '增长' : '下降'}${pct}%`
}

/** 期间（YYYY-MM）→ 展示月份「7月」；缺失/非法回退「当月」 */
function monthWordOf(period?: string): string {
  const m = Number(period?.slice(5, 7))
  return m >= 1 && m <= 12 ? `${m}月` : '当月'
}

/**
 * 由总览行数据模板化生成差距分析句（纯函数，随期间/主体筛选自动重算，可复用于其他接入处）：
 * - 金额行：【营业收入】7月达成X万元，同比…；财年累计达成X万元，预算完成率X%，财年同比…（无预算自动省略完成率子句）
 * - 费用行（expense）：动词改「使用」、「预算使用率」，句尾追加运营费用分析子页指引（人工根因不虚构）
 * - 比率行（劳效比/费效比）：按行 valueType 格式化（与表格口径一致），不含完成率子句
 */
export function buildGapAnalysisItems(rows: GapAnalysisRow[], period?: string): GapAnalysisItem[] {
  const monthWord = monthWordOf(period)
  return rows.map(({ key, label, valueType, g }, i) => {
    const isExpense = key === 'expense'
    const isRatio = valueType === 'ratio'
    const verb = isExpense ? '使用' : '达成'
    // 月度段（达成 + 同比）与财年段（累计 + 完成率 + 财年同比）以「；」分隔，段内子句以「，」连接
    let sentence: string
    if (isRatio) {
      // 比率行按图片句式：无月度同比/完成率子句
      sentence = `${monthWord}${verb}${label}${formatMetricValue(g.monthActual, valueType)}；财年累计${formatMetricValue(g.ytdActual, valueType)}，${yoyPhrase(g.ytdYoy, '财年')}`
    } else {
      const fyParts = [`财年累计${verb}${formatMoneyWan(g.ytdActual)}万元`]
      if (g.annualRate != null) fyParts.push(`预算${isExpense ? '使用' : '完成'}率${g.annualRate.toFixed(1)}%`)
      fyParts.push(yoyPhrase(g.ytdYoy, '财年'))
      if (isExpense) fyParts.push('细节差距根因详见运营费用分析子页')
      sentence = `${monthWord}${verb}${formatMoneyWan(g.monthActual)}万元，${yoyPhrase(g.monthYoy, '')}；${fyParts.join('，')}`
    }
    const end = i === rows.length - 1 ? '。' : '；'
    return { key, label, text: `【${label}】${sentence}${end}` }
  })
}

interface GapAnalysisPanelProps {
  items: GapAnalysisItem[]
  /** 追加类名（如外边距） */
  className?: string
}

/**
 * 差距分析面板（整体核心指标总览表格下侧）：纸质感盒子 + 编号句列表，
 * 文案由 buildGapAnalysisItems 从表格数据自动生成，随筛选联动，无人工维护。
 */
export function GapAnalysisPanel({ items, className }: GapAnalysisPanelProps) {
  if (items.length === 0) return null
  return (
    <div className={cn('rounded-md border border-border/60 bg-muted/30 px-5 py-4', className)}>
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <FileText className="h-4 w-4 text-primary" />
        差距分析
        <span className="ml-1 text-xs font-normal text-muted-foreground">基于上表数据自动生成</span>
      </h3>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-foreground marker:text-muted-foreground">
        {items.map((it) => (
          <li key={it.key}>{it.text}</li>
        ))}
      </ol>
    </div>
  )
}
