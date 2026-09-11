/** 指标值同比/达成率/累计同比计算工具（数据来源为后端真实接口，单位：万） */

/** 单个科目在给定主体维度 + 期间下的期间维度指标值（金额单位：万） */
export interface MetricValue {
  /** 预算金额 */
  budget: number
  /** 本月实际 */
  actual: number
  /** 同期实际 */
  samePeriod: number
  /** 本年累计 */
  ytd: number
  /** 同期累计 */
  samePeriodYtd: number
}

/**
 * 比率安全除法：分母为 0 或结果非有限时返回 0。
 *
 * 除零已由调用方的 falsy 判断覆盖，但极小分母（非规格化浮点）仍会
 * 溢出为 Infinity，进而被 formatPercent 渲染成 "Infinity%"。
 * 此处统一兜底，保证展示层永远拿到有限数。
 * 调用方需传绝对值分母（|基期|），使基期为负时涨跌方向不反转。
 */
function safeRatio(numerator: number, denominator: number): number {
  if (!denominator) return 0
  const r = numerator / denominator
  return Number.isFinite(r) ? r : 0
}

/** 同比 = 本月实际 相对 |同期实际|（基期为负按绝对值分母，扭亏为盈显示正增长） */
export function calcYoy(mv: MetricValue): number {
  return safeRatio(mv.actual - mv.samePeriod, Math.abs(mv.samePeriod))
}

/** 达成率 = 本年累计 / 全年预算（预算为年度值，须用 YTD 累计作分子） */
export function calcAchievement(mv: MetricValue): number {
  return safeRatio(mv.ytd, mv.budget)
}

/** 累计同比 = 本年累计 相对 |同期累计|（基期为负按绝对值分母，方向不反转） */
export function calcYtdYoy(mv: MetricValue): number {
  return safeRatio(mv.ytd - mv.samePeriodYtd, Math.abs(mv.samePeriodYtd))
}
