import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TrendChart } from '@/components/charts/trend-chart'
import { TREND_METRIC_LABELS, type TrendMetric } from '@/components/charts/trend-metrics'
import type { TrendData } from '@/types'

interface TrendSectionProps {
  data: TrendData[]
  metric: TrendMetric
  onMetricChange: (m: TrendMetric) => void
  /** 财年标签（如 FY2026），用于副标题说明 X 轴范围 */
  fiscalYearLabel?: string | null
  /** 当前主体显示名（跟随看板顶部筛选，标题下说明口径） */
  subjectName?: string
}

const METRICS: TrendMetric[] = ['revenue', 'profit', 'netProfit']

/** 财年趋势卡：可切换指标（收入/毛利/净利润），本月合计+上年同期柱状、月度预算曲线；主体口径跟随看板顶部筛选 */
export function TrendSection({ data, metric, onMetricChange, fiscalYearLabel, subjectName }: TrendSectionProps) {
  return (
    <Card className="animate-fade-in border border-border shadow-sm" style={{ animationDelay: '120ms' }}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-5">
        <div>
          <CardTitle className="text-lg font-semibold text-foreground">
            {TREND_METRIC_LABELS[metric]}趋势分析
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {fiscalYearLabel ? `${fiscalYearLabel} 财年` : '本财年'}逐月：本月合计、上年同期对比与月度预算（万元）
            {subjectName ? ` · 主体：${subjectName}` : ''}
          </p>
        </div>
        <Tabs value={metric} onValueChange={(v) => onMetricChange(v as TrendMetric)}>
          <TabsList className="bg-muted p-1">
            {METRICS.map((m) => (
              <TabsTrigger
                key={m}
                value={m}
                className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                {TREND_METRIC_LABELS[m]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        <TrendChart data={data} metric={metric} />
      </CardContent>
    </Card>
  )
}
