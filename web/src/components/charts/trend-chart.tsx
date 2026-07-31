import { useMemo } from 'react'
import type { EChartsOption, SeriesOption } from 'echarts'
import ReactECharts, { echarts } from './echarts-core'
import { formatMoneyWan } from '@/lib/utils'
import { seriesOf, type TrendMetric } from './trend-metrics'
import type { TrendData } from '@/types'

interface TrendChartProps {
  data: TrendData[]
  metric: TrendMetric
}

const SERIES_COLORS = { actual: '#F97316', same: '#94A3B8', budget: '#8B5CF6' }

/**
 * 财年趋势图：本月合计（柱，品牌橙）+ 上年同期（柱，灰蓝）+ 月度预算（虚线曲线，紫）。
 * X 轴为所选财年 12 个月，未导入数据的月份留空（null 断点）。
 */
export function TrendChart({ data, metric }: TrendChartProps) {
  // option 随 data/metric 变化才重建，避免父组件无关状态更新触发图表全量重渲染
  const option: EChartsOption = useMemo(() => {
    const periods = data.map(d => d.period)
    const { actual, same, budget } = seriesOf(data, metric)
    return {
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
          const color = item.seriesName === '本月合计' ? SERIES_COLORS.actual
            : item.seriesName === '上年同期' ? SERIES_COLORS.same
            : SERIES_COLORS.budget
          const value = item.value === null || item.value === undefined ? '–' : formatMoneyWan(item.value)
          result += `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:4px 0">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>
              <span style="color:#64748B;font-size:12px">${item.seriesName}</span>
            </div>
            <span style="font-weight:500;font-family:'Microsoft YaHei','微软雅黑',sans-serif;font-variant-numeric:tabular-nums;font-size:13px">${value}</span>
          </div>`
        })
        return result
      },
    },
    legend: {
      data: ['本月合计', '上年同期', '月度预算'],
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
      name: '万元',
      nameTextStyle: {
        color: '#94A3B8',
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
        name: '本月合计',
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
        name: '上年同期',
        type: 'bar',
        data: same,
        itemStyle: {
          color: SERIES_COLORS.same,
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: '20%',
      },
      {
        name: '月度预算',
        type: 'line',
        data: budget,
        smooth: 0.4,
        connectNulls: false,
        lineStyle: {
          color: SERIES_COLORS.budget,
          width: 2,
          type: 'dashed',
          cap: 'round',
        },
        symbol: 'diamond',
        symbolSize: 6,
        itemStyle: {
          color: SERIES_COLORS.budget,
          borderWidth: 2,
          borderColor: '#fff',
        },
      },
    ] as SeriesOption[],
    }
  }, [data, metric])

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
