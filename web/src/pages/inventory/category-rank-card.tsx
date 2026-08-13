import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoneyWan } from '@/lib/utils'
import { CHART_FONT, getChartInk, getChartSeries, labelSpan, numSpan, titleSpan, tooltipShell } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'
import { BarChart3 } from 'lucide-react'
import type { InventoryCategoryRow } from '@/hooks/api-queries'
import { EmptyHint } from './empty-hint'

/**
 * 存货品类排名横向条形图：按本期金额降序展示全部品类，
 * tooltip 附占比 / 同比 / 较年初变动率；点击条形触发品类钻取。
 */

export function CategoryRankCard({ categories, loading, onCategoryClick }: {
  categories: InventoryCategoryRow[]
  loading?: boolean
  onCategoryClick?: (code: string) => void
}) {
  // 分类色板跟随当前侧边栏风格：按序轮转，首位为风格主色；主页面恒白，图表框架色恒定
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  // 后端已按金额降序附 rank；横向条形图 yAxis 需倒序以使第一名在顶部
  const ranked = useMemo(() => [...categories].sort((a, b) => a.rank - b.rank), [categories])
  // ECharts click 回调仅能拿到 name，这里维护 名称→编码 映射用于钻取
  const nameToCode = useMemo(() => new Map(ranked.map((c) => [c.name, c.code])), [ranked])

  const option = useMemo<EChartsOption>(() => {
    const ink = getChartInk()
    const seriesColors = getChartSeries(sidebarStyle)
    const byRow = new Map(ranked.map((c) => [c.name, c]))
    return {
      animation: false,
      textStyle: {
        fontFamily: CHART_FONT,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0, 0, 0, 0.04)' } },
        ...tooltipShell(ink),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params
          const row = byRow.get(item?.name)
          if (!row) return ''
          const yearStartChange = row.yearStart ? ((row.current - row.yearStart) / row.yearStart) * 100 : 0
          const line = (label: string, value: string) =>
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:2px 0">
              ${labelSpan(label, ink)}
              ${numSpan(value)}
            </div>`
          return titleSpan(`No.${row.rank} ${row.name}`, ink)
            + line('本期金额', formatMoneyWan(row.current))
            + line('占比', row.share === 0 ? '-' : `${row.share.toFixed(1)}%`)
            + line('同比', row.yoy === 0 ? '-' : `${row.yoy >= 0 ? '+' : ''}${row.yoy.toFixed(1)}%`)
            + line('较年初', yearStartChange === 0 ? '-' : `${yearStartChange >= 0 ? '+' : ''}${yearStartChange.toFixed(1)}%`)
            + `<div style="margin-top:6px;color:${ink.axis};font-size:11px">点击钻取该品类明细</div>`
        },
      },
      grid: { top: 8, right: 96, bottom: 8, left: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: ink.grid, type: 'dashed' } },
        axisLabel: { color: ink.axis, fontSize: 11 },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: ranked.map((c) => c.name),
        axisLine: { lineStyle: { color: ink.grid } },
        axisTick: { show: false },
        axisLabel: { color: ink.sub, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barWidth: 12,
          data: ranked.map((c, i) => ({
            value: c.current,
            itemStyle: { color: seriesColors[i % seriesColors.length], borderRadius: [0, 4, 4, 0] },
          })),
          label: {
            show: true,
            position: 'right',
            fontSize: 10,
            color: ink.axis,
            fontFamily: CHART_FONT,
            // 金额 + 占比双信息，dataIndex 对应 ranked 顺序
            formatter: (p: { value?: number | unknown; dataIndex: number }) =>
              `${formatMoneyWan(Number(p.value ?? 0))} · ${ranked[p.dataIndex]?.share.toFixed(1) ?? '0.0'}%`,
          },
        },
      ],
    }
  }, [ranked, sidebarStyle])

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
          <div className="skeleton h-[260px] w-full rounded-lg lg:h-[320px]" />
        ) : ranked.length === 0 ? (
          <EmptyHint
            icon={BarChart3}
            title="暂无品类数据"
            hint="当前公司/期间无存货品类数据，请调整筛选条件"
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
              onEvents={{
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                click: (params: any) => {
                  const code = nameToCode.get(params?.name ?? '')
                  if (code) onCategoryClick?.(code)
                },
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
