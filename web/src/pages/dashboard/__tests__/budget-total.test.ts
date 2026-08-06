import { describe, it, expect } from 'vitest'
import { totalOf, totalMetrics } from '../budget-total'
import type { ProductBudgetMetric } from '@/types'

const round2 = (n: number): number => Math.round(n * 100) / 100

/** 构造单指标组（未指定字段取 0/null） */
function mk(over: Partial<ProductBudgetMetric>): ProductBudgetMetric {
  return {
    budget: 0,
    monthBudget: null,
    monthActual: 0,
    monthSame: 0,
    monthRate: null,
    monthYoy: 0,
    ytdActual: 0,
    ytdSame: 0,
    ytdBudget: null,
    ytdRate: null,
    ytdCumRate: null,
    ytdYoy: 0,
    ...over,
  }
}

describe('totalOf 合计行（品类/主体卡，月度预算按占比拆分口径）', () => {
  it('monthBudget 直接求和，monthRate 按 Σ当月预算加权', () => {
    const rows = [
      {
        income: mk({ budget: 1200, monthBudget: 36, monthActual: 30, monthSame: 20, monthRate: 100, monthYoy: 0.5, ytdActual: 100, ytdSame: 80, ytdBudget: 600, ytdRate: 16.67, ytdYoy: 0.25 }),
        profit: mk({}),
      },
      {
        income: mk({ budget: 1800, monthBudget: 54, monthActual: 70, monthSame: 60, monthRate: 129.63, monthYoy: 0.17, ytdActual: 200, ytdSame: 150, ytdBudget: 900, ytdRate: 22.22, ytdYoy: 0.33 }),
        profit: mk({}),
      },
    ]
    const total = totalOf(rows).income
    expect(total.budget).toBe(3000)
    expect(total.monthBudget).toBe(90) // 36 + 54
    expect(total.monthRate).toBe(round2((100 / 90) * 100)) // Σ实际 / Σ当月预算 = 111.11
    expect(total.monthYoy).toBe(0.25) // (100-80)/80
    expect(total.ytdBudget).toBe(1500) // 600 + 900
    expect(total.ytdRate).toBe(10) // 300/3000，展示口径按 Σ年度预算
    expect(total.ytdCumRate).toBe(20) // 300/1500，预警口径按 Σ累计预算
  })

  it('无预算（monthBudget 全 null）时 monthRate 为 null，monthBudget 合计为 0', () => {
    const rows = [{ income: mk({ budget: 0, monthBudget: null, monthActual: 10 }), profit: mk({}) }]
    const total = totalOf(rows).income
    expect(total.monthBudget).toBe(0)
    expect(total.monthRate).toBeNull()
  })
})

describe('totalMetrics 合计行（运营费用卡）', () => {
  it('monthBudget 求和且使用率按 Σ当月预算加权', () => {
    const rows = [
      mk({ budget: 1200, monthBudget: 36, monthActual: 30, monthSame: 20, monthRate: 83.33, monthYoy: 0.5, ytdActual: 100, ytdSame: 80, ytdBudget: 600, ytdRate: 16.67, ytdYoy: 0.25 }),
      mk({ budget: 1800, monthBudget: 54, monthActual: 70, monthSame: 60, monthRate: 129.63, monthYoy: 0.17, ytdActual: 200, ytdSame: 150, ytdBudget: 900, ytdRate: 22.22, ytdYoy: 0.33 }),
    ]
    const total = totalMetrics(rows)
    expect(total.monthBudget).toBe(90)
    expect(total.monthRate).toBe(round2((100 / 90) * 100))
    expect(total.budget).toBe(3000)
    expect(total.ytdBudget).toBe(1500)
    expect(total.ytdRate).toBe(10) // 300/3000，展示口径按 Σ年度预算
    expect(total.ytdCumRate).toBe(20) // 300/1500，预警口径按 Σ累计预算
  })

  it('全部无预算时使用率为 null', () => {
    const total = totalMetrics([mk({ monthBudget: null }), mk({ monthBudget: null })])
    expect(total.monthBudget).toBe(0)
    expect(total.monthRate).toBeNull()
  })
})
