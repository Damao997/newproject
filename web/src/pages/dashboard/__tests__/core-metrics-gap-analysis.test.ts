import { describe, it, expect } from 'vitest'
import { buildGapAnalysisItems } from '../core-metrics-gap-analysis'
import type { GapAnalysisRow } from '../core-metrics-gap-analysis'
import type { KeyMetricsGroup } from '@/types'

/** 构造指标组（未指定字段取 0/null，与后端空口径一致） */
function mkGroup(over: Partial<KeyMetricsGroup>): KeyMetricsGroup {
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

/** 构造分析输入行 */
function mkRow(key: string, label: string, valueType: GapAnalysisRow['valueType'], over: Partial<KeyMetricsGroup>): GapAnalysisRow {
  return { key, label, valueType, g: mkGroup(over) }
}

describe('buildGapAnalysisItems 差距分析句生成', () => {
  it('金额行：7月达成 + 同比 + 财年累计 + 预算完成率 + 财年同比（万元两位小数千分位）', () => {
    const items = buildGapAnalysisItems(
      [mkRow('income', '营业收入', 'amount', { monthActual: 195, monthYoy: -0.23, ytdActual: 7066, annualRate: 27, ytdYoy: 0.09 })],
      '2026-07',
    )
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe(
      '【营业收入】7月达成195.00万元，同比下降23.0%；财年累计达成7,066.00万元，预算完成率27.0%，财年同比增长9.0%。',
    )
  })

  it('费用行：动词用「使用」、预算使用率，句尾追加运营费用分析子页指引', () => {
    const items = buildGapAnalysisItems(
      [mkRow('expense', '运营费用', 'amount', { monthActual: 270, monthYoy: -0.24, ytdActual: 881, annualRate: 21, ytdYoy: 0.02 })],
      '2026-07',
    )
    expect(items[0].text).toBe(
      '【运营费用】7月使用270.00万元，同比下降24.0%；财年累计使用881.00万元，预算使用率21.0%，财年同比增长2.0%，细节差距根因详见运营费用分析子页。',
    )
  })

  it('比率行：按 valueType 百分比格式化（与表格口径一致），不含完成率子句', () => {
    const items = buildGapAnalysisItems(
      [mkRow('laborEff', '劳效比', 'ratio', { monthActual: 0.14, ytdActual: 0.21, ytdYoy: -0.16 })],
      '2026-07',
    )
    expect(items[0].text).toBe('【劳效比】7月达成劳效比14.0%；财年累计21.0%，财年同比下降16.0%。')
  })

  it('无预算行（annualRate=null）：省略预算完成率子句（如经营性现金流）', () => {
    const items = buildGapAnalysisItems(
      [mkRow('operating', '经营性现金流净值', 'amount', { monthActual: 2396, monthYoy: -1.91, ytdActual: 4766, annualRate: null, ytdYoy: 5.02 })],
      '2026-07',
    )
    expect(items[0].text).toBe(
      '【经营性现金流净值】7月达成2,396.00万元，同比下降191.0%；财年累计达成4,766.00万元，财年同比增长502.0%。',
    )
  })

  it('同比≈0 显示「同比持平」（与 DeltaTag 持平阈值一致，金额行含月度同比子句）', () => {
    const items = buildGapAnalysisItems(
      [mkRow('income', '营业收入', 'amount', { monthActual: 100, ytdActual: 200, monthYoy: 0.0004, ytdYoy: -0.0004 })],
      '2026-07',
    )
    expect(items[0].text).toBe('【营业收入】7月达成100.00万元，同比持平；财年累计达成200.00万元，财年同比持平。')
  })

  it('period 缺失/非法回退「当月」；末条以「。」结尾、其余「；」', () => {
    const items = buildGapAnalysisItems([
      mkRow('income', '营业收入', 'amount', { monthActual: 100, ytdActual: 500 }),
      mkRow('profit', '营业毛利', 'amount', { monthActual: 50, ytdActual: 200 }),
    ])
    expect(items[0].text.startsWith('【营业收入】当月达成100.00万元')).toBe(true)
    expect(items[0].text.endsWith('；')).toBe(true)
    expect(items[1].text.startsWith('【营业毛利】当月达成50.00万元')).toBe(true)
    expect(items[1].text.endsWith('。')).toBe(true)
  })
})
