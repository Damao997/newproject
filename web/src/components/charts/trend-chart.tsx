import { useMemo } from 'react'
import type { EChartsOption, SeriesOption } from 'echarts'
import ReactECharts, { echarts } from './echarts-core'
import { formatMoneyWan } from '@/lib/utils'
import { CHART_FONT, getChartInk, getChartSeries, labelSpan, numSpan, titleSpan, tooltipShell } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'
import { seriesOf, TREND_SERIES_LABELS, type TrendMetric, type TrendMode } from './trend-metrics'
import type { TrendData } from '@/types'

interface TrendChartProps {
  data: TrendData[]
  metric: TrendMetric
  /** 金额口径：month=本月合计/月度预算，ytd=累计实际/年度预算 */
  mode?: TrendMode
}

/**
 * 财年趋势图：本月合计/累计实际（柱，品牌主色）+ 上年同期/同期累计（柱，青蓝）+ 预算（实线曲线，柔紫）。
 * X 轴为所选财年 12 个月，未导入数据的月份留空（null 断点）。
 */
export function TrendChart({ data, metric, mode = 'month' }: TrendChartProps) {
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  // option 随 data/metric/mode/sidebarStyle 变化才重建，避免父组件无关状态更新触发图表全量重渲染
  const option: EChartsOption = useMemo(() => {
    const ink = getChartInk()
    const seriesColors = getChartSeries(sidebarStyle)
    const SERIES_COLORS = { actual: seriesColors[0], same: seriesColors[1], budget: seriesColors[4] }
    const periods = data.map(d => d.period)
    const { actual, same, budget } = seriesOf(data, metric, mode)
    const labels = TREND_SERIES_LABELS[mode]
    return {
    animation: false,
    textStyle: {
      fontFamily: CHART_FONT,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
        shadowStyle: {
          color: 'rgba(0, 0, 0, 0.04)',
        },
      },
      ...tooltipShell(ink),
      formatter: (params: any) => {
        if (!Array.isArray(params)) return ''
        let result = titleSpan(params[0].axisValue, ink)
        params.forEach((item: any) => {
          const color = item.seriesName === labels.actual ? SERIES_COLORS.actual
            : item.seriesName === labels.same ? SERIES_COLORS.same
            : SERIES_COLORS.budget
          const value = item.value === null || item.value === undefined ? '–' : formatMoneyWan(item.value)
          result += `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:4px 0">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>
              ${labelSpan(item.seriesName, ink)}
            </div>
            ${numSpan(value)}
          </div>`
        })
        return result
      },
    },
    legend: {
      data: [labels.actual, labels.same, labels.budget],
      bottom: 0,
      itemWidth: 12,
      itemHeight: 8,
      itemGap: 24,
      textStyle: {
        color: ink.sub,
        fontSize: 12,
      },
    },
    grid: {
      top: 32,
      right: 24,
      bottom: 48,
      left: 16,
      // 大数值 Y 轴标签自动占位，避免固定 left 截断
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: periods,
      axisLine: {
        lineStyle: {
          color: ink.grid,
        },
      },
      axisTick: {
        show: false,
      },
      axisLabel: {
        color: ink.axis,
        fontSize: 11,
        formatter: (value: string) => {
          const parts = value.split('-')
          return `${parts[0].slice(2)}/${parts[1]}`
        },
      },
    },
    yAxis: {
      type: 'value',
      name: '万元',
      nameTextStyle: {
        color: ink.axis,
        fontSize: 11,
        padding: [0, 0, 0, -24],
      },
      axisLine: {
        show: false,
      },
      axisTick: {
        show: false,
      },
      splitLine: {
        lineStyle: {
          color: ink.grid,
          type: 'dashed',
        },
      },
      axisLabel: {
        color: ink.axis,
        fontSize: 11,
        formatter: '{value}',
      },
    },
    series: [
      {
        name: labels.actual,
        type: 'bar',
        data: actual,
        itemStyle: {
          color: SERIES_COLORS.actual,
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: '20%',
        barGap: '20%',
      },
      {
        name: labels.same,
        type: 'bar',
        data: same,
        itemStyle: {
          color: SERIES_COLORS.same,
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: '20%',
      },
      {
        name: labels.budget,
        type: 'line',
        data: budget,
        smooth: 0.4,
        connectNulls: false,
        lineStyle: {
          color: SERIES_COLORS.budget,
          width: 2,
          type: 'solid',
          cap: 'round',
        },
        symbol: 'diamond',
        symbolSize: 6,
        itemStyle: {
          color: SERIES_COLORS.budget,
          borderWidth: 2,
          borderColor: ink.surface,
        },
      },
    ] as SeriesOption[],
    }
  }, [data, metric, mode, sidebarStyle])

  return (
    <div className="h-[260px] w-full lg:h-[320px]">
      <ReactECharts
        echarts={echarts}
        option={option}
        notMerge
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'svg' }}
      />
    </div>
  )
}
