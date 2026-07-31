import type { TrendData } from '@/types'

/** 趋势图可选指标 */
export type TrendMetric = 'revenue' | 'profit' | 'netProfit'

export const TREND_METRIC_LABELS: Record<TrendMetric, string> = {
  revenue: '收入',
  profit: '毛利',
  netProfit: '净利润',
}

/** 从财年趋势行中取选中指标的三个序列（本月合计 / 上年同期 / 月度预算），null=该月留空 */
export function seriesOf(data: TrendData[], metric: TrendMetric): { actual: (number | null)[]; same: (number | null)[]; budget: (number | null)[] } {
  const key = (suffix: 'Actual' | 'Same' | 'Budget') => `${metric}${suffix}` as keyof TrendData
  return {
    actual: data.map((d) => d[key('Actual')] as number | null),
    same: data.map((d) => d[key('Same')] as number | null),
    budget: data.map((d) => d[key('Budget')] as number | null),
  }
}
