import { useMemo } from 'react'
import type { EChartsOption, SeriesOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useInventoryTrend } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { formatMoneyWan } from '@/lib/utils'
import { CHART_FONT, CHART_INK, labelSpan, numSpan, titleSpan, tooltipShell } from '@/lib/chart-theme'
import { LineChart, RefreshCw } from 'lucide-react'
import { CATEGORY_COLORS } from './category-colors'
import { EmptyHint } from './empty-hint'

/**
 * 存货趋势卡：财年内各月公司堆叠柱 + 存货总额折线，图例为公司维度。
 * 数据来自 GET /inventory/trend（fact_static 快照月 DB 侧聚合，汇总主体已展开为成员单体公司）；
 * 财年跟随顶部导航全局财年选择，公司多选由页面筛选区传入。
 */

const TOTAL_COLOR = CHART_INK.text

export function InventoryTrendCard({ companyCodes, fiscalYear }: { companyCodes: string[]; fiscalYear: string | null }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useInventoryTrend({ fiscalYear, companyCodes })
  // 图例/系列名称跟随全局「显示简称」开关（与明细表一致）
  const { getDisplayName } = useCompanyDisplayName()

  const hasData = !!data && data.months.length > 0

  const option = useMemo<EChartsOption>(() => {
    const months = data?.months ?? []
    const byCompany = data?.byCompany ?? []
    const total = data?.total ?? []
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
          if (!Array.isArray(params) || params.length === 0) return ''
          let result = titleSpan(params[0].axisValue)
          for (const item of params) {
            if (item.value === null || item.value === undefined || item.value === 0) continue
            result += `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:4px 0">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color}"></span>
                ${labelSpan(item.seriesName)}
              </div>
              ${numSpan(formatMoneyWan(item.value))}
            </div>`
          }
          return result
        },
      },
      legend: {
        data: [...byCompany.map((c) => getDisplayName(c.code, c.name)), '存货总额'],
        bottom: 0,
        type: 'scroll',
        itemWidth: 12,
        itemHeight: 8,
        itemGap: 16,
        textStyle: { color: CHART_INK.sub, fontSize: 12 },
      },
      grid: { top: 24, right: 24, bottom: 48, left: 72 },
      xAxis: {
        type: 'category',
        data: months,
        axisLine: { lineStyle: { color: CHART_INK.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: CHART_INK.axis,
          fontSize: 11,
          formatter: (value: string) => {
            const parts = value.split('-')
            return `${parts[0].slice(2)}/${parts[1]}`
          },
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: CHART_INK.grid, type: 'dashed' } },
        axisLabel: { color: CHART_INK.axis, fontSize: 11 },
      },
      series: [
        ...byCompany.map((c, i) => ({
          name: getDisplayName(c.code, c.name),
          type: 'bar' as const,
          stack: 'company',
          barMaxWidth: 28,
          data: c.values,
          itemStyle: { color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] },
        })),
        {
          name: '存货总额',
          type: 'line' as const,
          data: total,
          smooth: 0.4,
          lineStyle: { color: TOTAL_COLOR, width: 2.5, cap: 'round' as const },
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: TOTAL_COLOR, borderWidth: 2, borderColor: CHART_INK.surface },
          z: 10,
        },
      ] as SeriesOption[],
    }
  }, [data, getDisplayName])

  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <LineChart className="h-4 w-4" />
            库存趋势
          </CardTitle>
          <span className="ml-auto text-xs text-muted-foreground">
            {fiscalYear ? `${fiscalYear} 财年各月快照 · 单位：万元` : '请先在顶部选择财年'}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="skeleton h-[260px] w-full rounded-lg lg:h-[320px]" />
        ) : isError ? (
          <div className="flex h-[260px] flex-col items-center justify-center gap-3 lg:h-[320px]">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : '数据加载失败'}</p>
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        ) : !hasData ? (
          <EmptyHint
            icon={LineChart}
            title="暂无趋势数据"
            hint={fiscalYear ? '当前财年暂无存货快照数据' : '请先在顶部导航选择财年'}
            className="h-[260px] lg:h-[320px]"
          />
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
