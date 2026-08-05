import type { ProductBudgetMetric } from '@/types'

/**
 * 预算达成分析表格的合计行计算（品类/主体两卡共用）：
 * 预算、金额直接求和；达成率按预算加权（Σ金额/Σ预算，月度口径用 Σ月均预算）；
 * 同比按合计金额重算（Σ本期 - Σ同期）/ |Σ同期|，避免简单平均偏差；基期为负时按绝对值分母，方向不反转。
 */

/** 金额/预算原始字段（不含派生比率） */
const RAW_KEYS = ['budget', 'monthActual', 'monthSame', 'ytdActual', 'ytdSame'] as const

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
  const monthActual = sum('monthActual')
  const monthSame = sum('monthSame')
  const ytdActual = sum('ytdActual')
  const ytdSame = sum('ytdSame')
  return {
    budget,
    monthActual,
    monthSame,
    monthRate: budget ? round2((monthActual / (budget / 12)) * 100) : null,
    monthYoy: yoyRate(monthActual, monthSame),
    ytdActual,
    ytdSame,
    ytdRate: budget ? round2((ytdActual / budget) * 100) : null,
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
