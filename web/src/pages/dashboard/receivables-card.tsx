import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDashboardReceivables } from '@/hooks/api-queries'
import { formatMoneyWan } from '@/lib/utils'
import { CATEGORY_COLORS } from '@/lib/chart-colors'
import { CHART_FONT, CHART_INK, labelSpan, numSpan, titleSpan, tooltipShell } from '@/lib/chart-theme'
import { BarChart3 } from 'lucide-react'

/**
 * 应收账款主体分布卡（横向柱状图）：指定期间各主体应收期末余额降序排布，
 * 支持单体/汇总口径切换（独立于 KPI 区）；期间跟随看板当前期间。
 * 数据经后端 scope 过滤，仅展示授权范围内主体。
 */
export function ReceivablesCard({ period }: { period?: string }) {
  const [mode, setMode] = useState<'single' | 'summary'>('single')
  const { data, isLoading } = useDashboardReceivables({ period, mode })
  const rows = useMemo(() => data?.rows ?? [], [data])

  const option = useMemo<EChartsOption>(() => {
    const byName = new Map(rows.map((r) => [r.name, r]))
    const total = rows.reduce((s, r) => s + r.balance, 0)
    return {
      animation: false,
      textStyle: {
        fontFamily: CHART_FONT,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0, 0, 0, 0.04)' } },
        ...tooltipShell,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params
          const row = byName.get(item?.name)
          if (!row) return ''
          const pct = total ? ((row.balance / total) * 100).toFixed(1) : '0.0'
          const line = (label: string, value: string) =>
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:2px 0">
              ${labelSpan(label)}
              ${numSpan(value)}
            </div>`
          return titleSpan(row.name)
            + line('应收余额', formatMoneyWan(row.balance))
            + line('占比', `${pct}%`)
        },
      },
      grid: { top: 8, right: 48, bottom: 8, left: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: CHART_INK.grid, type: 'dashed' } },
        axisLabel: { color: CHART_INK.axis, fontSize: 11 },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: rows.map((r) => r.name),
        axisLine: { lineStyle: { color: CHART_INK.grid } },
        axisTick: { show: false },
        axisLabel: { color: CHART_INK.sub, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barWidth: 12,
          data: rows.map((r, i) => ({
            value: r.balance,
            itemStyle: { color: CATEGORY_COLORS[i % CATEGORY_COLORS.length], borderRadius: [0, 4, 4, 0] },
          })),
          label: {
            show: true,
            position: 'right',
            fontSize: 10,
            color: CHART_INK.axis,
            fontFamily: CHART_FONT,
            formatter: (p: { value?: number | unknown }) => formatMoneyWan(Number(p.value ?? 0)),
          },
        },
      ],
    }
  }, [rows])

  return (
    <Card className="animate-fade-in border border-border shadow-sm" style={{ animationDelay: '200ms' }}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-5">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-chart-2/10">
              <BarChart3 className="h-4 w-4 text-chart-2" />
            </div>
            应收账款分布
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {period ? `期间 ${period} · ` : ''}应收期末余额（万元），按主体降序
          </p>
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'single' | 'summary')}>
          <TabsList className="bg-muted p-1">
            <TabsTrigger value="single" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">单体</TabsTrigger>
            <TabsTrigger value="summary" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">汇总</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        {isLoading ? (
          <div className="skeleton h-[260px] w-full rounded-lg lg:h-[320px]" />
        ) : !period ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground lg:h-[320px]">
            正在加载期间数据...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground lg:h-[320px]">
            当前期间暂无应收账款数据
          </div>
        ) : (
          <div className="h-[260px] w-full lg:h-[320px]">
            <ReactECharts
              echarts={echarts}
              option={option}
              notMerge
              style={{ height: '100%', width: '100%' }}
              opts={{ renderer: 'svg' }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
