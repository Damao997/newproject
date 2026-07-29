import type { SubjectNode } from '@/types'

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

export interface MetricValueOptions {
  /** 叶子本月实际下限（万） */
  valueMin?: number
  /** 叶子本月实际上限（万） */
  valueMax?: number
}

/** 稳定字符串哈希 → [0, 1)，保证同一 (科目, 主体, 期间, salt) 恒定 */
function seeded(code: string, dim: string, period: string, salt: string): number {
  const str = `${code}|${dim}|${period}|${salt}`
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // 转为 [0,1)
  return ((h >>> 0) % 100000) / 100000
}

/**
 * 计算整棵科目树在给定主体维度 + 期间下的期间维度指标值映射。
 *
 * 叶子节点用确定性伪随机生成预算/本月实际/同期实际/本年累计/同期累计；
 * 父节点各字段按子节点求和（计算类聚合语义）。纯 mock：同一筛选条件下结果恒定，
 * 切换筛选会整体变化。
 */
export function computeMetricMap(
  tree: SubjectNode[],
  dim: string,
  period: string,
  options: MetricValueOptions = {},
): Map<string, MetricValue> {
  const { valueMin = 5, valueMax = 200 } = options
  const range = Math.max(valueMax - valueMin, 1)
  const map = new Map<string, MetricValue>()

  const visit = (node: SubjectNode): MetricValue => {
    let result: MetricValue

    if (node.children.length > 0) {
      // 父节点：聚合子节点
      const agg: MetricValue = { budget: 0, actual: 0, samePeriod: 0, ytd: 0, samePeriodYtd: 0 }
      for (const child of node.children) {
        const cv = visit(child)
        agg.budget += cv.budget
        agg.actual += cv.actual
        agg.samePeriod += cv.samePeriod
        agg.ytd += cv.ytd
        agg.samePeriodYtd += cv.samePeriodYtd
      }
      result = {
        budget: Number(agg.budget.toFixed(2)),
        actual: Number(agg.actual.toFixed(2)),
        samePeriod: Number(agg.samePeriod.toFixed(2)),
        ytd: Number(agg.ytd.toFixed(2)),
        samePeriodYtd: Number(agg.samePeriodYtd.toFixed(2)),
      }
    } else {
      const actual = valueMin + seeded(node.code, dim, period, 'actual') * range
      // 预算为全年值（约月度量级 ×12），与真实口径一致，保证 mock 达成率数值合理
      const budget = actual * 12 * (0.9 + seeded(node.code, dim, period, 'budget') * 0.25)
      const samePeriod = actual * (0.8 + seeded(node.code, dim, period, 'same') * 0.35)
      const ytd = actual * (5 + seeded(node.code, dim, period, 'ytd') * 2)
      const samePeriodYtd = ytd * (0.8 + seeded(node.code, dim, period, 'sytd') * 0.35)
      result = {
        budget: Number(budget.toFixed(2)),
        actual: Number(actual.toFixed(2)),
        samePeriod: Number(samePeriod.toFixed(2)),
        ytd: Number(ytd.toFixed(2)),
        samePeriodYtd: Number(samePeriodYtd.toFixed(2)),
      }
    }

    map.set(node.code, result)
    return result
  }

  tree.forEach(visit)
  return map
}

/** 同比 = 本月实际 相对 同期实际 */
export function calcYoy(mv: MetricValue): number {
  return mv.samePeriod ? (mv.actual - mv.samePeriod) / mv.samePeriod : 0
}

/** 达成率 = 本年累计 / 全年预算（预算为年度值，须用 YTD 累计作分子） */
export function calcAchievement(mv: MetricValue): number {
  return mv.budget ? mv.ytd / mv.budget : 0
}

/** 累计同比 = 本年累计 相对 同期累计 */
export function calcYtdYoy(mv: MetricValue): number {
  return mv.samePeriodYtd ? (mv.ytd - mv.samePeriodYtd) / mv.samePeriodYtd : 0
}
