import { describe, it, expect } from 'vitest'
import { buildProductGapAnalysisItems } from '../product-gap-analysis'
import type { KeyMetricsGroup, ProductMetricsRow } from '@/types'

/** 构造指标组（未指定字段取 0/null，与后端空口径一致） */
function mk(over: Partial<KeyMetricsGroup>): KeyMetricsGroup {
  return {
    monthBudget: null,
    monthActual: 0,
    monthSame: 0,
    monthChange: 0,
    monthYoy: 0,
    monthMomChange: 0,
    monthMom: 0,
    monthRate: null,
    annualBudget: null,
    ytdBudget: null,
    ytdActual: 0,
    ytdSame: 0,
    ytdChange: 0,
    ytdYoy: 0,
    annualRate: null,
    ...over,
  }
}

function mkRow(name: string, income: Partial<KeyMetricsGroup>, profit: Partial<KeyMetricsGroup>): ProductMetricsRow {
  return { code: name, name, income: mk(income), profit: mk(profit) }
}

describe('buildProductGapAnalysisItems 品类核心指标差距分析句生成', () => {
  it('完整句：收入段（本月/累计/同比/完成率）+ 毛利段，子句顺序对齐样图', () => {
    const items = buildProductGapAnalysisItems([
      mkRow(
        '厨房产品',
        { monthActual: 415, ytdActual: 1571, ytdYoy: -0.38, annualRate: 21 },
        { monthActual: 52, ytdActual: 268, ytdYoy: -0.19, annualRate: 11 },
      ),
    ])
    expect(items[0].text).toBe(
      '【厨房产品】本月达成营收415.00万元，累计完成1,571.00万元，同比下降38.0%，财年完成率21.0%，达成毛利52.00万元，累计完成268.00万元，同比下降19.0%，财年完成率11.0%。',
    )
  })

  it('「其中：」前缀行剥前缀；key 保留原始名称', () => {
    const items = buildProductGapAnalysisItems([
      mkRow('其中：管道直饮水', { monthActual: 56, ytdActual: 100, annualRate: 2 }, { monthActual: 53, ytdActual: 90, annualRate: 3 }),
    ])
    expect(items[0].label).toBe('管道直饮水')
    expect(items[0].key).toBe('其中：管道直饮水')
    expect(items[0].text.startsWith('【管道直饮水】本月达成营收56.00万元')).toBe(true)
  })

  it('同比 0 省略子句；annualRate=null 省略完成率；负值正常展示（多行末条「。」其余「；」）', () => {
    const items = buildProductGapAnalysisItems([
      mkRow('优选产品', { monthActual: 0, ytdActual: 16, annualRate: 3 }, { monthActual: -3, ytdActual: -1 }),
      mkRow('空调产品', { monthActual: 0, ytdActual: 0 }, { monthActual: -2, ytdActual: 0 }),
    ])
    expect(items[0].text).toBe('【优选产品】本月达成营收0万元，累计完成16.00万元，财年完成率3.0%，达成毛利-3.00万元，累计完成-1.00万元；')
    expect(items[1].text).toBe('【空调产品】本月达成营收0万元，达成毛利-2.00万元。')
  })

  it('毛利本月/累计均为 0 时整段省略；合计行不在输入中则不生成', () => {
    const items = buildProductGapAnalysisItems([
      mkRow('宣传推广业务', { monthActual: 26, ytdActual: 120, ytdYoy: -0.54, annualRate: 10 }, {}),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe('【宣传推广业务】本月达成营收26.00万元，累计完成120.00万元，同比下降54.0%，财年完成率10.0%。')
  })
})
