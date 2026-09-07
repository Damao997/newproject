import { describe, it, expect } from 'vitest'
import { buildCategoryGapAnalysisItems } from '../category-gap-analysis'
import type { ProductBudgetMetric, ProductBudgetRow } from '@/types'

/** 构造品类指标组（未指定字段取 0/null，与后端空口径一致） */
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

function mkRow(category: string, income: Partial<ProductBudgetMetric>, profit: Partial<ProductBudgetMetric>): ProductBudgetRow {
  return { category, income: mk(income), profit: mk(profit) }
}

describe('buildCategoryGapAnalysisItems 品类差距分析句生成', () => {
  it('完整句：收入段（本月/累计/同比/完成率）+ 毛利段，子句顺序对齐样图', () => {
    const items = buildCategoryGapAnalysisItems([
      mkRow(
        '厨房产品',
        { monthActual: 415, ytdActual: 1571, ytdYoy: -0.38, ytdRate: 21 },
        { monthActual: 52, ytdActual: 268, ytdYoy: -0.19, ytdRate: 11 },
      ),
    ])
    expect(items[0].text).toBe(
      '【厨房产品】本月达成营收415.00万元，累计完成1,571.00万元，同比下降38.0%，财年完成率21.0%，达成毛利52.00万元，累计完成268.00万元，同比下降19.0%，财年完成率11.0%。',
    )
  })

  it('同比 0 省略子句；ytdRate=null 省略完成率；负值毛利正常展示（优选产品场景）', () => {
    const items = buildCategoryGapAnalysisItems([
      mkRow('优选产品', { monthActual: 0, ytdActual: 16, ytdRate: 3 }, { monthActual: -3, ytdActual: -1 }),
    ])
    expect(items[0].text).toBe('【优选产品】本月达成营收0万元，累计完成16.00万元，财年完成率3.0%，达成毛利-3.00万元，累计完成-1.00万元。')
  })

  it('无累计完成仍有财年完成率（管道直饮水场景）；收入累计 0 时跳过累计/同比/完成率子句', () => {
    const items = buildCategoryGapAnalysisItems([
      mkRow('管道直饮水', { monthActual: 56, ytdActual: 0, ytdRate: 2 }, { monthActual: 53, ytdActual: 0, ytdRate: 3 }),
      mkRow('空调产品', { monthActual: 0, ytdActual: 0 }, { monthActual: -2, ytdActual: 0 }),
    ])
    expect(items[0].text).toBe('【管道直饮水】本月达成营收56.00万元，财年完成率2.0%，达成毛利53.00万元，财年完成率3.0%；')
    // 空调：收入全 0 → 仅「本月达成营收0万元」；毛利本月非 0 → 毛利段保留；末条以「。」结尾
    expect(items[1].text).toBe('【空调产品】本月达成营收0万元，达成毛利-2.00万元。')
  })

  it('毛利本月/累计均为 0 时整段省略', () => {
    const items = buildCategoryGapAnalysisItems([
      mkRow('宣传推广业务', { monthActual: 26, ytdActual: 120, ytdYoy: -0.54, ytdRate: 10 }, {}),
    ])
    expect(items[0].text).toBe('【宣传推广业务】本月达成营收26.00万元，累计完成120.00万元，同比下降54.0%，财年完成率10.0%。')
  })
})
