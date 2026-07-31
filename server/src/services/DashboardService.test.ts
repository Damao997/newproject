import { describe, it, expect } from 'vitest'
import { changeRate, rateOf, findInCategory, monthlyBudgetSeries, mapAlertRow, alertScopeWhere } from './DashboardService'
import type { ValueNode } from './AggregationService'
import { Prisma } from '@prisma/client'

function node(partial: Partial<ValueNode>): ValueNode {
  return {
    code: 'X',
    name: 'X',
    level: 0,
    category: '',
    dataType: 'data',
    direction: 'debit',
    valueType: 'amount',
    isLeaf: true,
    values: {},
    children: [],
    ...partial,
  }
}

describe('DashboardService 纯函数', () => {
  describe('changeRate 同比变化率', () => {
    it('基数为 0 时返回 0（避免除零）', () => {
      expect(changeRate(100, 0)).toBe(0)
    })
    it('正向增长返回正比率', () => {
      expect(changeRate(110, 100)).toBe(0.1)
    })
    it('下降返回负比率', () => {
      expect(changeRate(90, 100)).toBe(-0.1)
    })
  })

  describe('rateOf 预算达成率', () => {
    it('预算为 0 时返回 null（前端显示 "–"）', () => {
      expect(rateOf(100, 0)).toBeNull()
      expect(rateOf(100, 0, 12)).toBeNull()
    })
    it('累计达成率 = 累计 / 年预算 × 100', () => {
      expect(rateOf(500, 1000)).toBe(50)
    })
    it('月度达成率按月均预算折算（divisor=12）', () => {
      expect(rateOf(100, 1200, 12)).toBe(100)
    })
  })

  describe('findInCategory 类别子树内按名称查找', () => {
    const tree: ValueNode[] = [
      node({ code: 'R', name: '收入', category: '收入', isLeaf: false }),
      node({
        code: 'OPI',
        name: '经营指标',
        category: '经营指标',
        isLeaf: false,
        children: [node({ code: 'NP', name: '壹品慧净利润', category: '经营指标' }), node({ code: 'TAX', name: '所得税费用', category: '经营指标' })],
      }),
      node({
        code: 'FIN',
        name: '财务指标',
        category: '财务指标',
        isLeaf: false,
        children: [node({ code: 'NPR', name: '壹品慧净利润率', category: '财务指标' })],
      }),
    ]
    it('命中类别下名称含关键字的科目', () => {
      expect(findInCategory(tree, '经营指标', '净利润')?.code).toBe('NP')
    })
    it('限定类别，不误命中其他类别的相似科目（净利润率）', () => {
      expect(findInCategory(tree, '经营指标', '净利润')?.name).toBe('壹品慧净利润')
    })
    it('类别不存在或关键字未命中返回 undefined', () => {
      expect(findInCategory(tree, '不存在', '净利润')).toBeUndefined()
      expect(findInCategory(tree, '收入', '净利润')).toBeUndefined()
    })
  })

  describe('monthlyBudgetSeries 月度预算序列', () => {
    const months = ['2026-01', '2026-02', '2026-03']
    it('有月度粒度时按月取值，缺失月为 null', () => {
      const rows = [
        { accountCode: 'A', period: '2026-01', value: 100 },
        { accountCode: 'A', period: '2026-03', value: 120 },
        { accountCode: 'B', period: '2026-01', value: 50 },
      ]
      expect(monthlyBudgetSeries(rows, ['A', 'B'], months)).toEqual([150, null, 120])
    })
    it('无月度粒度（period 非 YYYY-MM）时年度合计均摊 /12', () => {
      const rows = [{ accountCode: 'A', period: 'FY2026', value: 1200 }]
      expect(monthlyBudgetSeries(rows, ['A'], months)).toEqual([100, 100, 100])
    })
    it('叶子码不匹配或无预算行时返回全 null', () => {
      expect(monthlyBudgetSeries([{ accountCode: 'Z', period: '2026-01', value: 9 }], ['A'], months)).toEqual([null, null, null])
      expect(monthlyBudgetSeries([], ['A'], months)).toEqual([null, null, null])
    })
  })

  describe('mapAlertRow 预警行派生', () => {
    const base = {
      id: 'a1',
      metricCode: 'M001',
      periodCode: '2026-06',
      type: 'budget_exceeded',
      threshold: new Prisma.Decimal(1000),
      actualValue: new Prisma.Decimal(1200.456),
      level: 'error',
      triggeredAt: new Date('2026-06-30T00:00:00Z'),
    }
    it('level=error 归一为 error 严重级', () => {
      expect(mapAlertRow(base).severity).toBe('error')
    })
    it('未知 level 缺省为 warning', () => {
      expect(mapAlertRow({ ...base, level: 'unknown' }).severity).toBe('warning')
      expect(mapAlertRow({ ...base, level: null }).severity).toBe('warning')
    })
    it('type 映射中文标题，未知 type 用缺省标题', () => {
      expect(mapAlertRow(base).title).toBe('预算超支预警')
      expect(mapAlertRow({ ...base, type: 'xxx' }).title).toBe('数据预警')
    })
    it('message 拼接指标/期间/实际值/阈值', () => {
      const msg = mapAlertRow(base).message
      expect(msg).toContain('指标 M001')
      expect(msg).toContain('期间 2026-06')
      expect(msg).toContain('实际值 1200.46')
      expect(msg).toContain('阈值 1000')
    })
    it('字段全空时给出兜底文案', () => {
      const msg = mapAlertRow({ ...base, metricCode: null, periodCode: null, threshold: null, actualValue: null }).message
      expect(msg).toBe('触发预警规则，请关注相关指标')
    })
  })

  describe('alertScopeWhere 预警数据范围过滤', () => {
    it('仅未确认，且归属公司在授权范围或为全局（null）', () => {
      const where = alertScopeWhere(['C001', 'C002'])
      expect(where.acknowledged).toBe(false)
      expect(where.OR).toEqual([
        { businessUnitCode: null },
        { businessUnitCode: { in: ['C001', 'C002'] } },
      ])
    })
  })
})
