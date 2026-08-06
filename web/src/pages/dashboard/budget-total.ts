import type { ProductBudgetMetric } from '@/types'

/**
 * 预算达成分析表格的合计行计算（品类/主体/运营费用三卡共用）：
 * 预算、金额直接求和；月度达成率按 Σ当月预算加权（Σ金额/Σ月预算，月度预算为占比拆分后的当月值）；
 * 累计达成率按 Σ年度预算加权（Σ累计金额/Σ年度预算，看板展示口径）；
 * 累计预算口径达成率按 Σ累计预算加权（Σ累计金额/Σ累计预算，供预警判断）；
 * 同比按合计金额重算（Σ本期 - Σ同期）/ |Σ同期|，避免简单平均偏差；基期为负时按绝对值分母，方向不反转。
 */

/** 金额/预算原始字段（不含派生比率）；monthBudget 为占比拆分后的当月预算，ytdBudget 为预警用占比累计预算（null=无预算） */
const RAW_KEYS = ['budget', 'monthBudget', 'monthActual', 'monthSame', 'ytdActual', 'ytdSame', 'ytdBudget'] as const

const round2 = (n: number): number => Math.round(n * 100) / 100

/** 同比变化率（小数）：按 |同期| 作分母（基期为负时方向不反转），基期为 0/极小分母兜底为 0 */
function yoyRate(cur: number, base: number): number {
  const absBase = Math.abs(base)
  if (!absBase) return 0
  const r = (cur - base) / absBase
  return Number.isFinite(r) ? round2(r) : 0
}

type MetricRow = { income: ProductBudgetMetric; profit: ProductBudgetMetric; netProfit?: ProductBudgetMetric }
type Side = 'income' | 'profit' | 'netProfit'

function totalMetric(rows: MetricRow[], side: Side): ProductBudgetMetric {
  const sum = (key: (typeof RAW_KEYS)[number]): number => rows.reduce((acc, r) => acc + (r[side]?.[key] ?? 0), 0)
  const budget = sum('budget')
  const monthBudget = sum('monthBudget')
  const monthActual = sum('monthActual')
  const monthSame = sum('monthSame')
  const ytdActual = sum('ytdActual')
  const ytdSame = sum('ytdSame')
  const ytdBudget = sum('ytdBudget')
  return {
    budget,
    monthBudget,
    monthActual,
    monthSame,
    monthRate: monthBudget ? round2((monthActual / monthBudget) * 100) : null,
    monthYoy: yoyRate(monthActual, monthSame),
    ytdActual,
    ytdSame,
    ytdBudget,
    ytdRate: budget ? round2((ytdActual / budget) * 100) : null,
    ytdCumRate: ytdBudget ? round2((ytdActual / ytdBudget) * 100) : null,
    ytdYoy: yoyRate(ytdActual, ytdSame),
  }
}

/** 合计行数据源：传入已过滤后的 rows，返回收入/毛利合计指标组（存在净利润组时一并合计；无行时返回全 0/null 组） */
export function totalOf(rows: MetricRow[]): MetricRow {
  const hasNetProfit = rows.length > 0 && rows[0].netProfit !== undefined
  return {
    income: totalMetric(rows, 'income'),
    profit: totalMetric(rows, 'profit'),
    ...(hasNetProfit ? { netProfit: totalMetric(rows, 'netProfit') } : {}),
  }
}

/** 单指标组数组合计（运营费用分析卡用）：预算/金额直接求和，使用率按预算加权，同比按合计金额重算 */
export function totalMetrics(rows: ProductBudgetMetric[]): ProductBudgetMetric {
  const sum = (key: (typeof RAW_KEYS)[number]): number => rows.reduce((acc, r) => acc + (r[key] ?? 0), 0)
  const budget = sum('budget')
  const monthBudget = sum('monthBudget')
  const monthActual = sum('monthActual')
  const monthSame = sum('monthSame')
  const ytdActual = sum('ytdActual')
  const ytdSame = sum('ytdSame')
  const ytdBudget = sum('ytdBudget')
  return {
    budget,
    monthBudget,
    monthActual,
    monthSame,
    monthRate: monthBudget ? round2((monthActual / monthBudget) * 100) : null,
    monthYoy: yoyRate(monthActual, monthSame),
    ytdActual,
    ytdSame,
    ytdBudget,
    ytdRate: budget ? round2((ytdActual / budget) * 100) : null,
    ytdCumRate: ytdBudget ? round2((ytdActual / ytdBudget) * 100) : null,
    ytdYoy: yoyRate(ytdActual, ytdSame),
  }
}
