import ReactECharts from 'echarts-for-react'
import type { EChartsOption, SeriesOption } from 'echarts'
import type { TrendData } from '@/types'

interface TrendChartProps {
  data: TrendData[]
  showBudget?: boolean
}

export function TrendChart({ data, showBudget = true }: TrendChartProps) {
  const periods = data.map(d => d.period)
  
  const option: EChartsOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
        shadowStyle: {
          color: 'rgba(0, 0, 0, 0.04)',
        },
      },
      backgroundColor: '#fff',
      borderColor: '#E2E8F0',
      borderWidth: 1,
      padding: [12, 16],
      textStyle: {
        color: '#1E293B',
        fontSize: 13,
      },
      formatter: (params: any) => {
        if (!Array.isArray(params)) return ''
        let result = `<div style="font-weight:600;margin-bottom:8px;color:#0F172A;font-size:14px">${params[0].axisValue}</div>`
        params.forEach((item: any) => {
          const color = item.seriesName === '收入' ? '#2563EB' 
            : item.seriesName === '成本' ? '#EF4444' 
            : item.seriesName === '毛利' ? '#16A34A'
            : '#F59E0B'
          result += `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:4px 0">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>
              <span style="color:#64748B;font-size:12px">${item.seriesName}</span>
            </div>
            <span style="font-weight:500;font-family:'JetBrains Mono',monospace;font-size:13px">${item.value.toFixed(2)} 万</span>
          </div>`
        })
        return result
      },
    },
    legend: {
      data: ['收入', '成本', '毛利', '预算'],
      bottom: 0,
      itemWidth: 12,
      itemHeight: 8,
      itemGap: 24,
      textStyle: {
        color: '#64748B',
        fontSize: 12,
      },
    },
    grid: {
      top: 24,
      right: 24,
      bottom: 48,
      left: 56,
    },
    xAxis: {
      type: 'category',
      data: periods,
      axisLine: {
        lineStyle: {
          color: '#E2E8F0',
        },
      },
      axisTick: {
        show: false,
      },
      axisLabel: {
        color: '#94A3B8',
        fontSize: 11,
        formatter: (value: string) => {
          const parts = value.split('-')
          return `${parts[0].slice(2)}/${parts[1]}`
        },
      },
    },
    yAxis: {
      type: 'value',
      axisLine: {
        show: false,
      },
      axisTick: {
        show: false,
      },
      splitLine: {
        lineStyle: {
          color: '#F1F5F9',
          type: 'dashed',
        },
      },
      axisLabel: {
        color: '#94A3B8',
        fontSize: 11,
        formatter: '{value}',
      },
    },
    series: [
      {
        name: '收入',
        type: 'bar',
        data: data.map(d => d.revenue),
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: '#3B82F6' },
              { offset: 1, color: '#2563EB' },
            ],
          },
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: '16%',
        barGap: '20%',
      },
      {
        name: '成本',
        type: 'bar',
        data: data.map(d => d.cost),
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: '#F87171' },
              { offset: 1, color: '#EF4444' },
            ],
          },
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: '16%',
      },
      {
        name: '毛利',
        type: 'line',
        data: data.map(d => d.profit),
        smooth: 0.4,
        lineStyle: {
          color: '#16A34A',
          width: 2.5,
          cap: 'round',
        },
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: {
          color: '#16A34A',
          borderWidth: 2,
          borderColor: '#fff',
        },
      },
      ...(showBudget
        ? [
            {
              name: '预算',
              type: 'line',
              data: data.map(d => d.budget),
              smooth: 0.4,
              lineStyle: {
                color: '#F59E0B',
                width: 2,
                type: 'dashed',
                cap: 'round',
              },
              symbol: 'diamond',
              symbolSize: 6,
              itemStyle: {
                color: '#F59E0B',
                borderWidth: 2,
                borderColor: '#fff',
              },
            },
          ]
        : []),
    ] as SeriesOption[],
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: 320, width: '100%' }}
      opts={{ renderer: 'svg' }}
    />
  )
}
