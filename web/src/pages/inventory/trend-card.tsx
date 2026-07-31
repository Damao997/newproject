import { useMemo } from 'react'
import type { EChartsOption, SeriesOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useInventoryTrend } from '@/hooks/api-queries'
import { formatMoneyWan } from '@/lib/utils'
import { LineChart, RefreshCw } from 'lucide-react'
import { CATEGORY_COLORS } from './category-colors'

/**
 * 存货趋势卡：财年内各月品类堆叠柱 + 存货总额折线。
 * 数据来自 GET /inventory/trend（fact_static 快照月 DB 侧聚合）；
 * 财年跟随顶部导航全局财年选择，公司多选由页面筛选区传入。
 */

const TOTAL_COLOR = '#0F172A'

export function InventoryTrendCard({ companyCodes, fiscalYear }: { companyCodes: string[]; fiscalYear: string | null }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useInventoryTrend({ fiscalYear, companyCodes })

  const hasData = !!data && data.months.length > 0

  const option = useMemo<EChartsOption>(() => {
    const months = data?.months ?? []
    const byCategory = data?.byCategory ?? []
    const total = data?.total ?? []
    return {
      textStyle: {
        fontFamily: "'Microsoft YaHei', '微软雅黑', sans-serif",
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0, 0, 0, 0.04)' } },
        backgroundColor: '#fff',
        borderColor: '#E2E8F0',
        borderWidth: 1,
        padding: [12, 16],
        textStyle: { color: '#1E293B', fontSize: 13 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return ''
          let result = `<div style="font-weight:600;margin-bottom:8px;color:#0F172A;font-size:14px">${params[0].axisValue}</div>`
          for (const item of params) {
            if (item.value === null || item.value === undefined || item.value === 0) continue
            result += `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:4px 0">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color}"></span>
                <span style="color:#64748B;font-size:12px">${item.seriesName}</span>
              </div>
              <span style="font-weight:500;font-family:'Microsoft YaHei','微软雅黑',sans-serif;font-variant-numeric:tabular-nums;font-size:13px">${formatMoneyWan(item.value)}</span>
            </div>`
          }
          return result
        },
      },
      legend: {
        data: [...byCategory.map((c) => c.name), '存货总额'],
        bottom: 0,
        type: 'scroll',
        itemWidth: 12,
        itemHeight: 8,
        itemGap: 16,
        textStyle: { color: '#64748B', fontSize: 12 },
      },
      grid: { top: 24, right: 24, bottom: 48, left: 72 },
      xAxis: {
        type: 'category',
        data: months,
        axisLine: { lineStyle: { color: '#E2E8F0' } },
        axisTick: { show: false },
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
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } },
        axisLabel: { color: '#94A3B8', fontSize: 11 },
      },
      series: [
        ...byCategory.map((c, i) => ({
          name: c.name,
          type: 'bar' as const,
          stack: 'category',
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
          itemStyle: { color: TOTAL_COLOR, borderWidth: 2, borderColor: '#fff' },
          z: 10,
        },
      ] as SeriesOption[],
    }
  }, [data])

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
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">加载中...</div>
        ) : isError ? (
          <div className="flex h-[320px] flex-col items-center justify-center gap-3">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : '数据加载失败'}</p>
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        ) : !hasData ? (
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
