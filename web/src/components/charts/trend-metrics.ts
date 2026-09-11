import type { TrendData } from '@/types'

/** 趋势图可选指标 */
export type TrendMetric = 'revenue' | 'profit' | 'netProfit'

/** 趋势图金额口径：月度（本月合计/月度预算）或累计（YTD/年度预算） */
export type TrendMode = 'month' | 'ytd'

export const TREND_METRIC_LABELS: Record<TrendMetric, string> = {
  revenue: '收入',
  profit: '毛利',
  netProfit: '净利润',
}

export const TREND_MODE_LABELS: Record<TrendMode, string> = {
  month: '月度',
  ytd: '累计',
}

/** 趋势图三系列展示名（月度/累计口径不同） */
export const TREND_SERIES_LABELS: Record<TrendMode, { actual: string; same: string; budget: string }> = {
  month: { actual: '本月合计', same: '上年同期', budget: '月度预算' },
  ytd: { actual: '累计实际', same: '同期累计', budget: '年度预算' },
}

/** 从财年趋势行中取选中指标的三个序列（本月合计/累计实际、上年同期、预算），null=该月留空 */
export function seriesOf(data: TrendData[], metric: TrendMetric, mode: TrendMode = 'month'): { actual: (number | null)[]; same: (number | null)[]; budget: (number | null)[] } {
  const ytd = mode === 'ytd' ? 'Ytd' : ''
  const key = (suffix: 'Actual' | 'Same' | 'Budget') => `${metric}${ytd}${suffix}` as keyof TrendData
  return {
    actual: data.map((d) => d[key('Actual')] as number | null),
    same: data.map((d) => d[key('Same')] as number | null),
    budget: data.map((d) => d[key('Budget')] as number | null),
  }
}
