/**
 * 确定性指标值生成器（移植自前端 web/src/lib/metric-values.ts）。
 * 目的：后端 seed 生成的叶子事实值与前端 mock 在相同 (code, dim, period) 下完全一致，
 * 便于前端后续从 mock 平滑切换到真实接口。
 *
 * dim 在后端取 companyCode（公司主体维度）。金额单位：万元。
 */

/** 经营期间维度编码（与 seed 的 period_dimension 对齐） */
export const OPERATING_DIMS = {
  BUDGET_AMOUNT: 'BUDGET_AMOUNT', // 预算金额
  ACTUAL_MONTH: 'ACTUAL_MONTH', // 本月实际
  SAME_PERIOD_ACTUAL: 'SAME_PERIOD_ACTUAL', // 同期实际
  YTD_ACTUAL: 'YTD_ACTUAL', // 本年累计
  SAME_PERIOD_YTD: 'SAME_PERIOD_YTD', // 同期累计
} as const

/** 静态期间维度编码 */
export const STATIC_DIMS = {
  CURRENT_AMOUNT: 'CURRENT_AMOUNT', // 本期金额
  YEAR_START: 'YEAR_START', // 年初金额
  SAME_PERIOD_AMOUNT: 'SAME_PERIOD_AMOUNT', // 同期金额
  LAST_YEAR_START: 'LAST_YEAR_START', // 上年年初金额
} as const

/** 稳定字符串哈希 → [0,1)，保证同一 (code, dim, period, salt) 恒定（FNV-1a） */
export function seeded(code: string, dim: string, period: string, salt: string): number {
  const str = `${code}|${dim}|${period}|${salt}`
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

function round2(n: number): number {
  return Number(n.toFixed(2))
}

/**
 * 生成经营叶子科目在 (companyCode, period) 下的 5 个期间维度值。
 * 与前端 computeMetricMap 叶子算法一致。
 */
export function generateOperatingLeaf(
  code: string,
  companyCode: string,
  period: string,
  valueMin = 5,
  valueMax = 200,
): Record<string, number> {
  const range = Math.max(valueMax - valueMin, 1)
  const actual = valueMin + seeded(code, companyCode, period, 'actual') * range
  const budget = actual * (0.9 + seeded(code, companyCode, period, 'budget') * 0.25)
  const samePeriod = actual * (0.8 + seeded(code, companyCode, period, 'same') * 0.35)
  const ytd = actual * (5 + seeded(code, companyCode, period, 'ytd') * 2)
  const samePeriodYtd = ytd * (0.8 + seeded(code, companyCode, period, 'sytd') * 0.35)
  return {
    [OPERATING_DIMS.BUDGET_AMOUNT]: round2(budget),
    [OPERATING_DIMS.ACTUAL_MONTH]: round2(actual),
    [OPERATING_DIMS.SAME_PERIOD_ACTUAL]: round2(samePeriod),
    [OPERATING_DIMS.YTD_ACTUAL]: round2(ytd),
    [OPERATING_DIMS.SAME_PERIOD_YTD]: round2(samePeriodYtd),
  }
}

/**
 * 生成静态叶子科目在 (companyCode, snapshotKey) 下的 4 个期间维度值。
 */
export function generateStaticLeaf(
  code: string,
  companyCode: string,
  snapshotKey: string,
  valueMin = 50,
  valueMax = 5000,
): Record<string, number> {
  const range = Math.max(valueMax - valueMin, 1)
  const current = valueMin + seeded(code, companyCode, snapshotKey, 'cur') * range
  const yearStart = current * (0.85 + seeded(code, companyCode, snapshotKey, 'ys') * 0.3)
  const samePeriod = current * (0.8 + seeded(code, companyCode, snapshotKey, 'sp') * 0.35)
  const lastYearStart = yearStart * (0.8 + seeded(code, companyCode, snapshotKey, 'lys') * 0.3)
  return {
    [STATIC_DIMS.CURRENT_AMOUNT]: round2(current),
    [STATIC_DIMS.YEAR_START]: round2(yearStart),
    [STATIC_DIMS.SAME_PERIOD_AMOUNT]: round2(samePeriod),
    [STATIC_DIMS.LAST_YEAR_START]: round2(lastYearStart),
  }
}

/** 同比 = (本月实际 - 同期实际) / |同期实际|（基期为负时按绝对值分母，保证涨跌方向不反转） */
export function calcYoy(actual: number, samePeriod: number): number {
  const base = Math.abs(samePeriod)
  if (!base) return 0
  const r = ((actual - samePeriod) / base) * 100
  return Number.isFinite(r) ? round2(r) : 0
}

/** 达成率 = 本年累计 / 全年预算（预算为年度值，须用 YTD 累计作分子） */
export function calcAchievement(ytd: number, budget: number): number {
  return budget ? round2((ytd / budget) * 100) : 0
}
