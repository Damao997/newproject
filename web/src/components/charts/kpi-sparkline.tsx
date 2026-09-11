import type { EChartsOption } from 'echarts'
import { getChartSeries } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'
import ReactECharts, { echarts } from './echarts-core'

interface KpiSparklineProps {
  data: number[]
  /** 折线颜色；缺省跟随当前侧边栏风格主色 */
  color?: string
  height?: number
}

export function KpiSparkline({ data, color, height = 48 }: KpiSparklineProps) {
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const lineColor = color ?? getChartSeries(sidebarStyle)[0]
  const option: EChartsOption = {
    grid: {
      top: 4,
      right: 4,
      bottom: 4,
      left: 4,
    },
    xAxis: {
      type: 'category',
      show: false,
      data: data.map((_, i) => i),
    },
    yAxis: {
      type: 'value',
      show: false,
    },
    series: [
      {
        type: 'line',
        data,
        smooth: 0.4,
        showSymbol: false,
        lineStyle: {
          width: 2,
          color: lineColor,
          cap: 'round',
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: lineColor + '30' },
              { offset: 0.5, color: lineColor + '15' },
              { offset: 1, color: lineColor + '00' },
            ],
          },
        },
      },
    ],
    animation: false,
  }

  return (
    <ReactECharts
      echarts={echarts}
      option={option}
      style={{ height, width: '100%' }}
      opts={{ renderer: 'svg' }}
    />
  )
}
