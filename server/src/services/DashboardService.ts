import { prisma } from '../lib/prisma'
import { AggregationService, resolveCompanyCodes } from './AggregationService'
import { latestOperatingPeriod } from './IndicatorsService'
import { OPERATING_DIMS } from '../lib/metric-values'
import type { AuthUserContext } from '../types/express'
import type { ValueNode } from './AggregationService'

/**
 * 首页看板服务：KPI / 趋势 / 事业部分布 / 预警。金额单位：万元。
 * 全部经 scope 过滤；多公司自动汇总求和。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & { dataScopeCodes?: string[] | null }

interface Kpi { title: string; value: number; unit: string; change: number; trend: number[]; icon: string }
interface Trend { period: string; revenue: number; cost: number; profit: number; budget: number }

/** 备用：按名称查找根节点（主逻辑已改用 category 匹配） */
export function rootByName(tree: ValueNode[], name: string): ValueNode | undefined {
  return tree.find((n) => n.name === name)
}

function actual(node?: ValueNode): number {
  return node?.values[OPERATING_DIMS.ACTUAL_MONTH] ?? 0
}
function budget(node?: ValueNode): number {
  return node?.values[OPERATING_DIMS.BUDGET_AMOUNT] ?? 0
}
function samePeriod(node?: ValueNode): number {
  return node?.values[OPERATING_DIMS.SAME_PERIOD_ACTUAL] ?? 0
}
function round2(n: number): number {
  return Number(n.toFixed(2))
}
function changeRate(cur: number, base: number): number {
  return base ? round2((cur - base) / base) : 0
}

/** active 经营批次内的可用期间（升序；多批次按期间共存，汇总全部 active 批次） */
async function availablePeriods(): Promise<string[]> {
  const batches = await prisma.importBatch.findMany({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
  if (batches.length === 0) return []
  const rows = await prisma.factOperating.findMany({
    where: { batchId: { in: batches.map((b) => b.id) } },
    distinct: ['period'],
    orderBy: { period: 'asc' },
    select: { period: true },
  })
  return rows.map((r) => r.period)
}

async function monthlyTrend(companyCodes: string[], periods: string[]): Promise<Trend[]> {
  const out: Trend[] = []
  for (const period of periods) {
    const tree = await AggregationService.buildOperatingTree(companyCodes, period)
    const revenue = actual(tree.find((n) => n.category === '收入'))
    const cost = actual(tree.find((n) => n.category === '成本'))
    const profit = actual(tree.find((n) => n.category === '毛利'))
    const budgetVal = budget(tree.find((n) => n.category === '收入'))
    out.push({ period, revenue: round2(revenue), cost: round2(cost), profit: round2(profit), budget: round2(budgetVal) })
  }
  return out
}

export const DashboardService = {
  async getOverview(scope: Scope, params: { period?: string } = {}): Promise<{ kpiData: Kpi[]; trendData: Trend[]; alerts: unknown[]; lastUpdatedAt: string; period: string; availablePeriods: string[] }> {
    const companyCodes = await resolveCompanyCodes(scope)
    const periods = await availablePeriods()
    // 选定期仅接受可用期间内的值，缺省取最新期；趋势不受选定期影响
    const period = (params.period && periods.includes(params.period) ? params.period : periods[periods.length - 1]) ?? (await latestOperatingPeriod())
    const trendData = await monthlyTrend(companyCodes, periods)

    const tree = await AggregationService.buildOperatingTree(companyCodes, period)
    const revenue = tree.find((n) => n.category === '收入')
    const cost = tree.find((n) => n.category === '成本')
    const profit = tree.find((n) => n.category === '毛利')
    const expense = tree.find((n) => n.category === '费用')

    const trendOf = (name: string): number[] => trendData.map((t) =>
      name === '收入' ? t.revenue : name === '成本' ? t.cost : name === '毛利' ? t.profit : 0,
    )

    const achievement = budget(revenue) ? round2((actual(revenue) / budget(revenue)) * 100) : 0
    const kpiData: Kpi[] = [
      { title: '总收入', value: round2(actual(revenue)), unit: '万', change: changeRate(actual(revenue), samePeriod(revenue)), trend: trendOf('收入'), icon: 'TrendingUp' },
      { title: '总成本', value: round2(actual(cost)), unit: '万', change: changeRate(actual(cost), samePeriod(cost)), trend: trendOf('成本'), icon: 'DollarSign' },
      { title: '毛利', value: round2(actual(profit)), unit: '万', change: changeRate(actual(profit), samePeriod(profit)), trend: trendOf('毛利'), icon: 'TrendingUp' },
      { title: '费用', value: round2(actual(expense)), unit: '万', change: changeRate(actual(expense), samePeriod(expense)), trend: [], icon: 'Receipt' },
      { title: '预算执行率', value: achievement, unit: '%', change: 0, trend: [], icon: 'Target' },
    ]

    const alerts = await this.getAlerts(scope)
    const lastBatch = await prisma.importBatch.findFirst({ where: { lifecycleStatus: 'active' }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } })

    return { kpiData, trendData, alerts, lastUpdatedAt: (lastBatch?.updatedAt ?? new Date()).toISOString(), period, availablePeriods: periods }
  },

  async getDrill(scope: Scope, params: { companyCode?: string; period?: string }): Promise<{ kpiData: Kpi[]; trendData: Trend[] }> {
    const companyCodes = await resolveCompanyCodes(scope, params.companyCode)
    const periods = await availablePeriods()
    const period = params.period || periods[periods.length - 1] || (await latestOperatingPeriod())
    const trendData = await monthlyTrend(companyCodes, periods)
    const tree = await AggregationService.buildOperatingTree(companyCodes, period)
    const revenue = tree.find((n) => n.category === '收入')
    const cost = tree.find((n) => n.category === '成本')
    const profit = tree.find((n) => n.category === '毛利')
    const kpiData: Kpi[] = [
      { title: '总收入', value: round2(actual(revenue)), unit: '万', change: changeRate(actual(revenue), samePeriod(revenue)), trend: trendData.map((t) => t.revenue), icon: 'TrendingUp' },
      { title: '总成本', value: round2(actual(cost)), unit: '万', change: changeRate(actual(cost), samePeriod(cost)), trend: trendData.map((t) => t.cost), icon: 'DollarSign' },
      { title: '毛利', value: round2(actual(profit)), unit: '万', change: changeRate(actual(profit), samePeriod(profit)), trend: trendData.map((t) => t.profit), icon: 'TrendingUp' },
    ]
    return { kpiData, trendData }
  },

  async getTrend(scope: Scope, params: { months?: number }): Promise<Trend[]> {
    const companyCodes = await resolveCompanyCodes(scope)
    let periods = await availablePeriods()
    if (params.months && params.months > 0) periods = periods.slice(-params.months)
    return monthlyTrend(companyCodes, periods)
  },

  async getAlerts(scope: Scope): Promise<unknown[]> {
    const companyCodes = await resolveCompanyCodes(scope)
    if (companyCodes.length === 0) return []
    const rows = await prisma.alert.findMany({
      where: { acknowledged: false },
      orderBy: { triggeredAt: 'desc' },
      take: 20,
    })
    return rows
  },
}
