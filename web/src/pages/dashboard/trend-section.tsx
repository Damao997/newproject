import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TrendChart } from '@/components/charts/trend-chart'
import { TREND_METRIC_LABELS, TREND_MODE_LABELS, type TrendMetric, type TrendMode } from '@/components/charts/trend-metrics'
import type { TrendData } from '@/types'

interface TrendSectionProps {
  data: TrendData[]
  metric: TrendMetric
  onMetricChange: (m: TrendMetric) => void
  /** 金额口径：month=本月合计/月度预算，ytd=累计实际/年度预算 */
  mode: TrendMode
  onModeChange: (m: TrendMode) => void
  /** 选定期（跟随看板当前期间），用于说明文字「期间 · 单位 · 主体」口径 */
  period?: string
  /** 当前主体显示名（跟随看板顶部筛选，标题下说明口径） */
  subjectName?: string
}

const METRICS: TrendMetric[] = ['revenue', 'profit', 'netProfit']
const MODES: TrendMode[] = ['month', 'ytd']

/** 财年趋势内容（综合分析卡「趋势分析」页）：可切换指标（收入/毛利/净利润）+ 月度/累计口径；
 * 柱状为实际与同期、曲线为预算；主体口径跟随看板顶部筛选；外层 Card 由 AnalysisTabsCard 统一提供 */
export function TrendSection({ data, metric, onMetricChange, mode, onModeChange, period, subjectName }: TrendSectionProps) {
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          期间 {period ?? '—'} · 单位：万元{subjectName ? ` · 当前主体：${subjectName}` : ''}
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
