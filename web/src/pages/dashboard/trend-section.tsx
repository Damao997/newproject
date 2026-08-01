import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TrendChart } from '@/components/charts/trend-chart'
import { TREND_METRIC_LABELS, type TrendMetric } from '@/components/charts/trend-metrics'
import type { Company, TrendData } from '@/types'

interface TrendSectionProps {
  data: TrendData[]
  metric: TrendMetric
  onMetricChange: (m: TrendMetric) => void
  /** 财年标签（如 FY2026），用于副标题说明 X 轴范围 */
  fiscalYearLabel?: string | null
  /** 主体切换（与看板顶部筛选器联动）：公司/汇总主体候选列表 */
  companies?: Company[]
  /** 当前主体筛选值（all / company:CODE / summary:CODE） */
  dimFilter?: string
  /** 主体切换回调（同步顶部筛选器） */
  onDimFilterChange?: (v: string) => void
}

const METRICS: TrendMetric[] = ['revenue', 'profit', 'netProfit']

/** 财年趋势卡：可切换指标（收入/毛利/净利润），本月合计+上年同期柱状、月度预算曲线 */
export function TrendSection({ data, metric, onMetricChange, fiscalYearLabel, companies, dimFilter, onDimFilterChange }: TrendSectionProps) {
  const entityCompanies = (companies ?? []).filter((c) => c.type === 'entity')
  const summaryEntities = (companies ?? []).filter((c) => c.type === 'summary')
  return (
    <Card className="animate-fade-in border border-border shadow-sm" style={{ animationDelay: '120ms' }}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-5">
        <div>
          <CardTitle className="text-lg font-semibold text-foreground">
            {TREND_METRIC_LABELS[metric]}趋势分析
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {fiscalYearLabel ? `${fiscalYearLabel} 财年` : '本财年'}逐月：本月合计、上年同期对比与月度预算（万元）
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onDimFilterChange && (
            <Select value={dimFilter ?? 'all'} onValueChange={onDimFilterChange}>
              <SelectTrigger className="h-9 w-[150px] sm:w-[180px]" title="选择主体维度（汇总主体自动展开为成员合并口径）">
                <SelectValue placeholder="选择主体" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部主体</SelectItem>
                <SelectGroup>
                  <SelectLabel>公司</SelectLabel>
                  {entityCompanies.map((c) => (
                    <SelectItem key={c.code} value={`company:${c.code}`}>{c.name}</SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>汇总主体</SelectLabel>
                  {summaryEntities.map((c) => (
                    <SelectItem key={c.code} value={`summary:${c.code}`}>{c.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
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
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        <TrendChart data={data} metric={metric} />
      </CardContent>
    </Card>
  )
}
