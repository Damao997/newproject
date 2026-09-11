import { describe, it, expect } from 'vitest'
import { splitMonthlyBudget, validateBudgetRatios, DEFAULT_RATIOS } from './BudgetRatioService'

/** 财年 4月起 12 个月的期（与看板 months 序列一致） */
const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']

describe('splitMonthlyBudget 年度预算按月度占比拆分', () => {
  it('预设占比拆分：前 11 个月 = 总额×占比/100，末月按余差补齐保证 Σ=总额', () => {
    const total = 10000
    const out = splitMonthlyBudget(total, DEFAULT_RATIOS, MONTHS)
    expect(out.length).toBe(12)
    // 4月 3% = 300；5月 8% = 800；9月 12% = 1200
    expect(out[0]).toBe(300)
    expect(out[1]).toBe(800)
    expect(out[4]).toBe(700)
    expect(out[5]).toBe(1200)
    expect(out[11]).toBe(1200) // 3月 12%：恰好整除时与占比一致
    expect(out.reduce((s, v) => s + (v ?? 0), 0)).toBe(total)
  })
  it('存在四舍五入误差时末月余差吸收，Σ 恒等于年度总额', () => {
    // 10000 × 13% = 1300 整除；构造非整除：总额 33333
    const total = 33333
    const out = splitMonthlyBudget(total, DEFAULT_RATIOS, MONTHS)
    expect(out[8]).toBe(Number((33333 * 0.13).toFixed(2))) // 12月 13%
    expect(out.reduce((s, v) => s + (v ?? 0), 0)).toBe(total)
    // 末月 = 总额 - Σ前11月
    const sumPrev = out.slice(0, 11).reduce((s, v) => s + (v ?? 0), 0)
    expect(out[11]).toBe(Number((total - sumPrev).toFixed(2)))
  })
  it('未配置占比（null）时回退年度/12 均摊', () => {
    expect(splitMonthlyBudget(1200, null, MONTHS)).toEqual(MONTHS.map(() => 100))
  })
  it('年度总额为 0 时返回全 null（无预算不伪造）', () => {
    expect(splitMonthlyBudget(0, DEFAULT_RATIOS, MONTHS)).toEqual(MONTHS.map(() => null))
  })
  it('months 不足 12 时占比不生效（按年度/12 均摊，占比仅对完整财年序列）', () => {
    const short = ['2026-04', '2026-05', '2026-06']
    expect(splitMonthlyBudget(1200, DEFAULT_RATIOS, short)).toEqual([100, 100, 100])
  })
})

describe('validateBudgetRatios 月度占比校验', () => {
  it('合法 12 项且总和为 100 时通过', () => {
    expect(validateBudgetRatios(DEFAULT_RATIOS)).toBeNull()
  })
  it('非数组或长度不为 12 拒绝', () => {
    expect(validateBudgetRatios(null)).toBeTruthy()
    expect(validateBudgetRatios([3, 8])).toBeTruthy()
    expect(validateBudgetRatios([...DEFAULT_RATIOS, 1])).toBeTruthy()
  })
  it('含负数 / 非数值 / 超出 100 拒绝', () => {
    expect(validateBudgetRatios([...DEFAULT_RATIOS.slice(0, 11), -1])).toBeTruthy()
    expect(validateBudgetRatios([...DEFAULT_RATIOS.slice(0, 11), 'x'])).toBeTruthy()
    expect(validateBudgetRatios([...DEFAULT_RATIOS.slice(0, 11), 101])).toBeTruthy()
  })
  it('总和不为 100 拒绝（含容差 ±0.01）', () => {
    expect(validateBudgetRatios([...DEFAULT_RATIOS.slice(0, 11), 13])).toBeTruthy() // 和 101
    expect(validateBudgetRatios([...DEFAULT_RATIOS.slice(0, 11), 11.99])).toBeNull() // 和 99.99，容差内
    expect(validateBudgetRatios([...DEFAULT_RATIOS.slice(0, 11), 11.98])).toBeTruthy() // 和 99.98，超容差
  })
})
