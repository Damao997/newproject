import { describe, it, expect } from 'vitest'
import { METRIC_KEYS, columnsFor, isValidMetricForDim, parseMetricKey, projectRow } from './metric-catalog'
import type { KeyMetricsGroup } from '../DashboardService'

/** 构造 14 列口径组（默认值可覆盖） */
function group(over: Partial<KeyMetricsGroup> = {}): KeyMetricsGroup {
  return {
    monthBudget: 100, monthActual: 120, monthSame: 100, monthChange: 20, monthYoy: 20,
    monthMomChange: 10, monthMom: 9.09, monthRate: 120,
    annualBudget: 1200, ytdBudget: 600, ytdActual: 480, ytdSame: 400, ytdChange: 80,
    ytdYoy: 20, annualRate: 40,
    ...over,
  }
}

describe('metric-catalog 指标字典', () => {
  it('METRIC_KEYS 覆盖 15 个直通指标 + 4 个派生指标', () => {
    expect(METRIC_KEYS).toHaveLength(19)
    for (const k of ['monthActual', 'monthBudget', 'monthSame', 'monthChange', 'monthYoy',
      'monthMomChange', 'monthMom', 'monthRate', 'annualBudget', 'ytdBudget', 'ytdActual',
      'ytdSame', 'ytdChange', 'ytdYoy', 'annualRate',
      'deviation', 'alertRate', 'share', 'marginRate']) {
      expect(METRIC_KEYS).toContain(k)
    }
  })

  describe('parseMetricKey 前缀解析', () => {
    it('单组维度：裸 key 解析为唯一组名', () => {
      expect(parseMetricKey('ytdActual', ['value'])).toEqual({ groupName: 'value', metricKey: 'ytdActual' })
    })
    it('多组维度：`组名.key` 解析出组与指标', () => {
      expect(parseMetricKey('income.ytdActual', ['income', 'profit'])).toEqual({ groupName: 'income', metricKey: 'ytdActual' })
    })
    it('多组维度下裸 key / 未知组 / 未知指标 → null', () => {
      expect(parseMetricKey('ytdActual', ['income', 'profit'])).toBeNull()
      expect(parseMetricKey('other.ytdActual', ['income', 'profit'])).toBeNull()
      expect(parseMetricKey('income.nope', ['income', 'profit'])).toBeNull()
    })
  })

  describe('isValidMetricForDim 维度可用性', () => {
    it('marginRate 仅「收入 + 毛利」双组维度可用', () => {
      expect(isValidMetricForDim('marginRate', ['income', 'profit'])).toBe(true)
      expect(isValidMetricForDim('marginRate', ['value'])).toBe(false)
      expect(isValidMetricForDim('marginRate', ['income', 'profit', 'netProfit'])).toBe(true)
    })
    it('直通指标在单组维度下可用', () => {
      expect(isValidMetricForDim('ytdActual', ['value'])).toBe(true)
    })
    it('单组维度不接受带前缀 key', () => {
      expect(isValidMetricForDim('income.ytdActual', ['value'])).toBe(false)
    })
  })

  describe('projectRow 投影', () => {
    it('单组：直通指标取同名字段', () => {
      const v = projectRow({ value: group() }, ['ytdActual', 'ytdBudget', 'monthActual'], ['value'])
      expect(v).toEqual({ ytdActual: 480, ytdBudget: 600, monthActual: 120 })
    })

    it('多组：按前缀分别取对应组', () => {
      const v = projectRow(
        { income: group({ ytdActual: 1000 }), profit: group({ ytdActual: 250 }) },
        ['income.ytdActual', 'profit.ytdActual'],
        ['income', 'profit'],
      )
      expect(v).toEqual({ 'income.ytdActual': 1000, 'profit.ytdActual': 250 })
    })

    it('缺失的组 → null（不抛错）', () => {
      const v = projectRow({ income: group() }, ['profit.ytdActual'], ['income', 'profit'])
      expect(v).toEqual({ 'profit.ytdActual': null })
    })

    it('直通 null（无预算）原样透传', () => {
      const v = projectRow({ value: group({ ytdBudget: null, monthBudget: null }) }, ['ytdBudget', 'monthBudget'], ['value'])
      expect(v).toEqual({ ytdBudget: null, monthBudget: null })
    })
  })

  describe('派生指标口径（对齐 core-metrics-content.tsx）', () => {
    it('deviation = 累计实际 − 累计预算；无/零预算 → null', () => {
      expect(projectRow({ value: group() }, ['deviation'], ['value']).deviation).toBe(-120)
      expect(projectRow({ value: group({ ytdBudget: null }) }, ['deviation'], ['value']).deviation).toBeNull()
      expect(projectRow({ value: group({ ytdBudget: 0 }) }, ['deviation'], ['value']).deviation).toBeNull()
    })

    it('alertRate = 累计实际 ÷ 累计预算 × 100；无/零预算 → null', () => {
      expect(projectRow({ value: group({ ytdActual: 480, ytdBudget: 600 }) }, ['alertRate'], ['value']).alertRate).toBe(80)
      expect(projectRow({ value: group({ ytdBudget: null }) }, ['alertRate'], ['value']).alertRate).toBeNull()
      expect(projectRow({ value: group({ ytdBudget: 0 }) }, ['alertRate'], ['value']).alertRate).toBeNull()
    })

    it('alertRate 三档边界（<60 红 / 60–75 黄 / ≥75 绿）的取值本身连续', () => {
      const at = (a: number, b: number) => projectRow({ value: group({ ytdActual: a, ytdBudget: b }) }, ['alertRate'], ['value']).alertRate
      expect(at(59, 100)).toBe(59)
      expect(at(60, 100)).toBe(60)
      expect(at(75, 100)).toBe(75)
    })

    it('share = 本行累计 ÷ 合计累计 × 100；合计缺失或为 0 → null', () => {
      const row = group({ ytdActual: 250 })
      const totals = { value: group({ ytdActual: 1000 }) }
      expect(projectRow({ value: row }, ['share'], ['value'], totals).share).toBe(25)
      expect(projectRow({ value: row }, ['share'], ['value']).share).toBeNull()
      expect(projectRow({ value: row }, ['share'], ['value'], { value: group({ ytdActual: 0 }) }).share).toBeNull()
    })

    it('share 按组名对齐分母（多组维度下 income 用 income 合计）', () => {
      const v = projectRow(
        { income: group({ ytdActual: 300 }), profit: group({ ytdActual: 60 }) },
        ['income.share', 'profit.share'],
        ['income', 'profit'],
        { income: group({ ytdActual: 1200 }), profit: group({ ytdActual: 300 }) },
      )
      expect(v).toEqual({ 'income.share': 25, 'profit.share': 20 })
    })

    it('marginRate = 毛利累计 ÷ 收入累计 × 100；收入为 0 → null', () => {
      const v = projectRow(
        { income: group({ ytdActual: 1000 }), profit: group({ ytdActual: 250 }) },
        ['marginRate'],
        ['income', 'profit'],
      )
      expect(v.marginRate).toBe(25)
      const zero = projectRow(
        { income: group({ ytdActual: 0 }), profit: group({ ytdActual: 250 }) },
        ['marginRate'],
        ['income', 'profit'],
      )
      expect(zero.marginRate).toBeNull()
    })
  })

  describe('columnsFor 列定义', () => {
    it('多组维度加组名前缀，并携带 valueType 与 tip', () => {
      const cols = columnsFor(['income.ytdActual'], ['income', 'profit'])
      expect(cols[0]).toMatchObject({ key: 'income.ytdActual', header: '收入·财年累计达成', valueType: 'amount', group: '收入' })
      expect(cols[0].tip).toBeTruthy()
    })
    it('单组维度不加前缀，group 留空', () => {
      const cols = columnsFor(['alertRate'], ['value'])
      expect(cols[0]).toMatchObject({ key: 'alertRate', header: '预警达成率', valueType: 'ratio' })
      expect(cols[0].group).toBeUndefined()
    })
  })
})
