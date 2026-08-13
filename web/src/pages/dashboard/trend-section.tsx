import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TrendChart } from '@/components/charts/trend-chart'
import { TREND_METRIC_LABELS, TREND_MODE_LABELS, TREND_SERIES_LABELS, type TrendMetric, type TrendMode } from '@/components/charts/trend-metrics'
import type { TrendData } from '@/types'

interface TrendSectionProps {
  data: TrendData[]
  metric: TrendMetric
  onMetricChange: (m: TrendMetric) => void
  /** 金额口径：month=本月合计/月度预算，ytd=累计实际/年度预算 */
  mode: TrendMode
  onModeChange: (m: TrendMode) => void
  /** 财年标签（如 FY2026），用于副标题说明 X 轴范围 */
  fiscalYearLabel?: string | null
  /** 当前主体显示名（跟随看板顶部筛选，标题下说明口径） */
  subjectName?: string
}

const METRICS: TrendMetric[] = ['revenue', 'profit', 'netProfit']
const MODES: TrendMode[] = ['month', 'ytd']

/** 财年趋势内容（综合分析卡「趋势分析」页）：可切换指标（收入/毛利/净利润）+ 月度/累计口径；
 * 柱状为实际与同期、曲线为预算；主体口径跟随看板顶部筛选；外层 Card 由 AnalysisTabsCard 统一提供 */
export function TrendSection({ data, metric, onMetricChange, mode, onModeChange, fiscalYearLabel, subjectName }: TrendSectionProps) {
  const seriesLabel = TREND_SERIES_LABELS[mode]
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {fiscalYearLabel ? `${fiscalYearLabel} 财年` : '本财年'}逐月：{seriesLabel.actual}、{seriesLabel.same}对比与{seriesLabel.budget}（万元）
          {subjectName ? ` · 主体：${subjectName}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={mode} onValueChange={(v) => onModeChange(v as TrendMode)}>
            <TabsList variant="line" className="justify-start">
              {MODES.map((m) => (
                <TabsTrigger key={m} value={m}>
                  {TREND_MODE_LABELS[m]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Tabs value={metric} onValueChange={(v) => onMetricChange(v as TrendMetric)}>
            <TabsList variant="line" className="justify-start">
              {METRICS.map((m) => (
                <TabsTrigger key={m} value={m}>
                  {TREND_METRIC_LABELS[m]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>
      <TrendChart data={data} metric={metric} mode={mode} />
    </>
  )
}
