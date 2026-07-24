import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'

interface KpiSparklineProps {
  data: number[]
  color?: string
  height?: number
}

export function KpiSparkline({ data, color = '#F97316', height = 48 }: KpiSparklineProps) {
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
          color,
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
              { offset: 0, color: color + '30' },
              { offset: 0.5, color: color + '15' },
              { offset: 1, color: color + '00' },
            ],
          },
        },
      },
    ],
    animation: false,
  }

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      opts={{ renderer: 'svg' }}
    />
  )
}
