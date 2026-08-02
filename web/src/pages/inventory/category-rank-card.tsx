import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoneyWan } from '@/lib/utils'
import { CHART_FONT, CHART_INK, labelSpan, numSpan, titleSpan, tooltipShell } from '@/lib/chart-theme'
import { BarChart3 } from 'lucide-react'
import type { InventoryCategoryRow } from '@/hooks/api-queries'
import { CATEGORY_COLORS } from './category-colors'

/**
 * 存货品类排名横向条形图：按本期金额降序展示全部品类，
 * tooltip 附占比 / 同比 / 较年初变动率。
 */

export function CategoryRankCard({ categories, loading }: { categories: InventoryCategoryRow[]; loading?: boolean }) {
  // 后端已按金额降序附 rank；横向条形图 yAxis 需倒序使第一名在顶部
  const ranked = useMemo(() => [...categories].sort((a, b) => a.rank - b.rank), [categories])

  const option = useMemo<EChartsOption>(() => {
    const byRow = new Map(ranked.map((c) => [c.name, c]))
    return {
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
          const row = byRow.get(item?.name)
          if (!row) return ''
          const yearStartChange = row.yearStart ? ((row.current - row.yearStart) / row.yearStart) * 100 : 0
          const line = (label: string, value: string) =>
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:2px 0">
              ${labelSpan(label)}
              ${numSpan(value)}
            </div>`
          return titleSpan(`No.${row.rank} ${row.name}`)
            + line('本期金额', formatMoneyWan(row.current))
            + line('占比', `${row.share.toFixed(1)}%`)
            + line('同比', `${row.yoy >= 0 ? '+' : ''}${row.yoy.toFixed(1)}%`)
            + line('较年初', `${yearStartChange >= 0 ? '+' : ''}${yearStartChange.toFixed(1)}%`)
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
        data: ranked.map((c) => c.name),
        axisLine: { lineStyle: { color: CHART_INK.grid } },
        axisTick: { show: false },
        axisLabel: { color: CHART_INK.sub, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barWidth: 12,
          data: ranked.map((c, i) => ({
            value: c.current,
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
  }, [ranked])

  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4" />
          品类金额排名
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">加载中...</div>
        ) : ranked.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">暂无数据</div>
        ) : (
          <ReactECharts
            echarts={echarts}
            option={option}
            notMerge
            style={{ height: 320, width: '100%' }}
            opts={{ renderer: 'svg' }}
          />
        )}
      </CardContent>
    </Card>
  )
}
