import { describe, it, expect } from 'vitest'
import {
  calcYoy,
  calcAchievement,
  calcYtdYoy,
  type MetricValue,
} from '@/lib/metric-values'

/**
 * metric-values 边界测试。
 *
 * 重点覆盖三个比率函数的除零与负值分支 —— 财务口径下
 * "分母为 0 返回 0" 与 "负分母按绝对值计算、涨跌方向不反转" 是易错点。
 */

/** 构造 MetricValue，未指定字段取 0 */
function mv(partial: Partial<MetricValue>): MetricValue {
  return { budget: 0, actual: 0, samePeriod: 0, ytd: 0, samePeriodYtd: 0, ...partial }
}

describe('calcYoy 同比', () => {
  it('正常增长', () => {
    expect(calcYoy(mv({ actual: 120, samePeriod: 100 }))).toBeCloseTo(0.2, 10)
  })

  it('正常下降', () => {
    expect(calcYoy(mv({ actual: 80, samePeriod: 100 }))).toBeCloseTo(-0.2, 10)
  })

  it('同期为 0 → 返回 0（不得产出 Infinity）', () => {
    const r = calcYoy(mv({ actual: 100, samePeriod: 0 }))
    expect(r).toBe(0)
    expect(Number.isFinite(r)).toBe(true)
  })

  it('两者均为 0 → 返回 0（不得产出 NaN）', () => {
    const r = calcYoy(mv({ actual: 0, samePeriod: 0 }))
    expect(r).toBe(0)
    expect(Number.isNaN(r)).toBe(false)
  })

  it('本月为 0、同期为正 → -100%', () => {
    expect(calcYoy(mv({ actual: 0, samePeriod: 100 }))).toBe(-1)
  })

  it('同期为负（亏损转盈）→ 按绝对值分母显示正增长', () => {
    // (50 - (-100)) / |-100| = 1.5：扭亏为盈显示为 +150% 改善，而非误导性负增长
    expect(calcYoy(mv({ actual: 50, samePeriod: -100 }))).toBeCloseTo(1.5, 10)
  })

  it('本月负、同期负（亏损扩大）→ 负增长', () => {
    // (-150 - (-100)) / |-100| = -0.5：亏损扩大显示为负增长
    expect(calcYoy(mv({ actual: -150, samePeriod: -100 }))).toBeCloseTo(-0.5, 10)
  })

  it('同期为负、本月为 0 → 100% 改善', () => {
    // (0 - (-100)) / |-100| = 1：由亏转平按 +100% 解读
    expect(calcYoy(mv({ actual: 0, samePeriod: -100 }))).toBeCloseTo(1, 10)
  })

  it('极小同期不产生 Infinity', () => {
    const r = calcYoy(mv({ actual: 1, samePeriod: Number.MIN_VALUE }))
    expect(Number.isFinite(r)).toBe(true)
  })
})

describe('calcAchievement 达成率', () => {
  it('YTD 除以年度预算', () => {
    expect(calcAchievement(mv({ ytd: 900, budget: 1200 }))).toBeCloseTo(0.75, 10)
  })

  it('预算为 0 → 返回 0', () => {
    expect(calcAchievement(mv({ ytd: 500, budget: 0 }))).toBe(0)
  })

  it('YTD 为 0 → 返回 0', () => {
    expect(calcAchievement(mv({ ytd: 0, budget: 1200 }))).toBe(0)
  })

  it('超额完成可大于 1', () => {
    expect(calcAchievement(mv({ ytd: 1500, budget: 1200 }))).toBeCloseTo(1.25, 10)
  })

  it('负预算（成本类冲减）不抛错', () => {
    const r = calcAchievement(mv({ ytd: 100, budget: -200 }))
    expect(Number.isFinite(r)).toBe(true)
    expect(r).toBeCloseTo(-0.5, 10)
  })

  it('使用 ytd 而非 actual 作分子（防回归：预算为全年口径）', () => {
    // 若误用 actual(=100) 会得 0.0833，正确应用 ytd(=600) 得 0.5
    expect(calcAchievement(mv({ actual: 100, ytd: 600, budget: 1200 }))).toBeCloseTo(0.5, 10)
  })
})

describe('calcYtdYoy 累计同比', () => {
  it('正常增长', () => {
    expect(calcYtdYoy(mv({ ytd: 660, samePeriodYtd: 600 }))).toBeCloseTo(0.1, 10)
  })

  it('同期累计为 0 → 返回 0', () => {
    expect(calcYtdYoy(mv({ ytd: 600, samePeriodYtd: 0 }))).toBe(0)
  })

  it('两者均为 0 → 返回 0', () => {
    expect(calcYtdYoy(mv({ ytd: 0, samePeriodYtd: 0 }))).toBe(0)
  })

  it('本年累计为 0、同期为正 → -100%', () => {
    expect(calcYtdYoy(mv({ ytd: 0, samePeriodYtd: 600 }))).toBe(-1)
  })

  it('同期累计为负（扭亏）→ 按绝对值分母显示正增长', () => {
    // (300 - (-300)) / |-300| = 2：亏损转盈利按 +200% 解读
    expect(calcYtdYoy(mv({ ytd: 300, samePeriodYtd: -300 }))).toBeCloseTo(2, 10)
  })
})
