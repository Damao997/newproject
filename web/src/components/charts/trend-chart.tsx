import ReactECharts from 'echarts-for-react'
import type { EChartsOption, SeriesOption } from 'echarts'
import { formatMoneyWan } from '@/lib/utils'
import type { TrendData } from '@/types'

interface TrendChartProps {
  data: TrendData[]
  showBudget?: boolean
}

export function TrendChart({ data, showBudget = true }: TrendChartProps) {
  const periods = data.map(d => d.period)
  
  const option: EChartsOption = {
    textStyle: {
      fontFamily: "'Microsoft YaHei', '微软雅黑', sans-serif",
    },
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
          const color = item.seriesName === '收入' ? '#F97316' 
            : item.seriesName === '成本' ? '#3B82F6' 
            : item.seriesName === '毛利' ? '#10B981'
            : '#8B5CF6'
          result += `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:4px 0">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>
              <span style="color:#64748B;font-size:12px">${item.seriesName}</span>
            </div>
            <span style="font-weight:500;font-family:'Microsoft YaHei','微软雅黑',sans-serif;font-variant-numeric:tabular-nums;font-size:13px">${formatMoneyWan(item.value)}</span>
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
          color: '#E2E8F0',
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
          color: '#F97316',
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
          color: '#3B82F6',
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
          color: '#10B981',
          width: 2.5,
          cap: 'round',
        },
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: {
          color: '#10B981',
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
                color: '#8B5CF6',
                width: 2,
                type: 'dashed',
                cap: 'round',
              },
              symbol: 'diamond',
              symbolSize: 6,
              itemStyle: {
                color: '#8B5CF6',
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
