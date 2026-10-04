import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendChart } from '@/components/charts/trend-chart'
import { TREND_METRIC_LABELS, TREND_MODE_LABELS, type TrendMetric, type TrendMode } from '@/components/charts/trend-metrics'
import { useDashboardTrend } from '@/hooks/api-queries'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * 首页财年趋势卡（US-05）：近 12 个月收入/毛利折线+柱状+预算线，支持月度/累计口径切换。
 * 数据与「关键指标分析」趋势图同源（GET /dashboard/trend，scope 过滤后全公司合计）。
 */
export function TrendSection() {
  const { data, isLoading, isError, refetch } = useDashboardTrend(12)
  const [metric, setMetric] = useState<TrendMetric>('revenue')
  const [mode, setMode] = useState<TrendMode>('month')

  const hasData = (data?.length ?? 0) > 0 && data!.some((d) =>
    Object.values(d).some((v) => v !== null && v !== 0),
  )

  return (
    <Card className="animate-fade-in rounded-card">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-2">
        <div><CardTitle>财年趋势</CardTitle><p className="mt-1 text-xs text-muted-foreground">近 12 个月 · 万元</p></div>
        <div className="flex items-center gap-2">
          <Segmented options={Object.entries(TREND_METRIC_LABELS).map(([v, l]) => ({ value: v as TrendMetric, label: l }))} value={metric} onChange={setMetric} />
          <Segmented options={Object.entries(TREND_MODE_LABELS).map(([v, l]) => ({ value: v as TrendMode, label: l }))} value={mode} onChange={setMode} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : isError ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2">
            <p className="text-sm text-destructive">趋势数据加载失败</p>
            <button className="text-xs text-muted-foreground underline" onClick={() => void refetch()}>重试</button>
          </div>
        ) : !hasData ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            当前财年暂无趋势数据，可在「数据导入」激活批次后查看。
          </div>
        ) : (
          <TrendChart data={data ?? []} metric={metric} mode={mode} />
        )}
      </CardContent>
    </Card>
  )
}

function Segmented({ options, value, onChange, className }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: never) => void
  className?: string
}) {
  return (
    <div className={cn('app-tabs-list inline-flex max-w-full items-center', className)} role="group" data-tabs-variant="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          data-state={value === o.value ? 'active' : 'inactive'}
          className={cn(
            'app-tab-trigger text-xs',
            'font-medium',
          )}
          onClick={() => onChange(o.value as never)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
