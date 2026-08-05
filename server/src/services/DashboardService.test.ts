import { describe, it, expect } from 'vitest'
import { changeRate, rateOf, findInCategory, monthlyBudgetSeries, budgetAnnualTotal, fallbackBudgetSeries, mapAlertRow, alertScopeWhere, productMetric, matchProductCategories } from './DashboardService'
import { OPERATING_DIMS } from '../lib/metric-values'
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

  describe('budgetAnnualTotal 指标年度预算总额（含计算类指标树预算回退）', () => {
    it('有叶子匹配行时按年度求和（含月度粒度归集）', () => {
      const rows = [
        { accountCode: 'A', value: 100 },
        { accountCode: 'A', value: 50 },
        { accountCode: 'B', value: 30 },
      ]
      expect(budgetAnnualTotal(undefined, rows, ['A', 'B'])).toBe(180)
    })
    it('无匹配行（计算类指标如毛利）时回退树节点 BUDGET_AMOUNT（公式层重算值）', () => {
      const profit = node({ code: 'OP_PROFIT', values: { [OPERATING_DIMS.BUDGET_AMOUNT]: 12142.58 } })
      expect(budgetAnnualTotal(profit, [], ['OP_PROFIT_A', 'OP_PROFIT_B'])).toBe(12142.58)
    })
    it('无匹配行且无树预算（节点缺失）时返回 0', () => {
      expect(budgetAnnualTotal(undefined, [{ accountCode: 'Z', value: 9 }], ['A'])).toBe(0)
    })
  })

  describe('fallbackBudgetSeries 预算序列兜底', () => {
    const months = ['2026-04', '2026-05', '2026-06']
    it('序列非全 null 时保持原样（月度粒度预算优先）', () => {
      const series = [100, null, 120]
      expect(fallbackBudgetSeries(series, 500, months, 'month')).toEqual([100, null, 120])
    })
    it('全 null 时月度口径按年度/12 均摊', () => {
      const series = [null, null, null]
      expect(fallbackBudgetSeries(series, 1200, months, 'month')).toEqual([100, 100, 100])
    })
    it('全 null 时累计口径为年度总额（预算无累计粒度，水平线）', () => {
      const series = [null, null, null]
      expect(fallbackBudgetSeries(series, 1200, months, 'ytd')).toEqual([1200, 1200, 1200])
    })
    it('年度总额为 0 时保持全 null（无预算不伪造）', () => {
      expect(fallbackBudgetSeries([null, null, null], 0, months, 'month')).toEqual([null, null, null])
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

  describe('productMetric 品类口径取值', () => {
    const dims = {
      [OPERATING_DIMS.BUDGET_AMOUNT]: 1200,
      [OPERATING_DIMS.ACTUAL_MONTH]: 100,
      [OPERATING_DIMS.SAME_PERIOD_ACTUAL]: 80,
      [OPERATING_DIMS.YTD_ACTUAL]: 500,
      [OPERATING_DIMS.SAME_PERIOD_YTD]: 400,
    }
    it('本月/累计达成率（月均=年度/12）与单月/累计同比', () => {
      const m = productMetric(node({ values: dims }))
      expect(m.budget).toBe(1200)
      expect(m.monthActual).toBe(100)
      expect(m.monthSame).toBe(80)
      expect(m.monthRate).toBe(100) // 100 / (1200/12) × 100
      expect(m.monthYoy).toBe(0.25) // (100-80)/80
      expect(m.ytdActual).toBe(500)
      expect(m.ytdSame).toBe(400)
      expect(m.ytdRate).toBe(41.67) // 500/1200 × 100 保留两位
      expect(m.ytdYoy).toBe(0.25) // (500-400)/400
    })
    it('无预算（budget=0）时达成率为 null，同比不受影响', () => {
      const m = productMetric(node({ values: { ...dims, [OPERATING_DIMS.BUDGET_AMOUNT]: 0 } }))
      expect(m.monthRate).toBeNull()
      expect(m.ytdRate).toBeNull()
      expect(m.monthYoy).toBe(0.25)
    })
    it('节点缺失返回全 0 / null（前端显示 "–"）', () => {
      const m = productMetric(undefined)
      expect(m.budget).toBe(0)
      expect(m.monthActual).toBe(0)
      expect(m.monthSame).toBe(0)
      expect(m.monthRate).toBeNull()
      expect(m.monthYoy).toBe(0)
      expect(m.ytdActual).toBe(0)
      expect(m.ytdSame).toBe(0)
      expect(m.ytdRate).toBeNull()
      expect(m.ytdYoy).toBe(0)
    })
  })

  describe('matchProductCategories 品类×科目树匹配', () => {
    const income = (name: string, level: number, actual: number, budgetAmt: number): ValueNode =>
      node({
        code: name, name, level, category: '收入',
        values: {
          [OPERATING_DIMS.ACTUAL_MONTH]: actual,
          [OPERATING_DIMS.BUDGET_AMOUNT]: budgetAmt,
          [OPERATING_DIMS.SAME_PERIOD_ACTUAL]: actual * 0.8,
          [OPERATING_DIMS.YTD_ACTUAL]: actual * 12,
          [OPERATING_DIMS.SAME_PERIOD_YTD]: actual * 10,
        },
      })
    const profit = (name: string, actual: number): ValueNode =>
      node({
        code: name, name, level: 3, category: '毛利',
        values: {
          [OPERATING_DIMS.ACTUAL_MONTH]: actual,
          [OPERATING_DIMS.BUDGET_AMOUNT]: 0,
          [OPERATING_DIMS.SAME_PERIOD_ACTUAL]: 0,
          [OPERATING_DIMS.YTD_ACTUAL]: 0,
          [OPERATING_DIMS.SAME_PERIOD_YTD]: 0,
        },
      })

    it('关键词命中节点并自动配对毛利镜像，已覆盖后代的叶子不列入未覆盖', () => {
      const cats = [{ code: 'kitchen', name: '厨房产品销售', subjectKeyword: '厨房产品销售' }]
      const incomeRoots = [
        node({
          code: 'K', name: '厨房产品销售收入（不含净水及服务）', level: 3, category: '收入', isLeaf: false,
          values: {
            [OPERATING_DIMS.ACTUAL_MONTH]: 100,
            [OPERATING_DIMS.BUDGET_AMOUNT]: 1200,
            [OPERATING_DIMS.SAME_PERIOD_ACTUAL]: 80,
            [OPERATING_DIMS.YTD_ACTUAL]: 1200,
            [OPERATING_DIMS.SAME_PERIOD_YTD]: 1000,
          },
          children: [income('燃气具-灶具收入', 4, 60, 720)],
        }),
        income('其他业务收入', 2, 50, 600),
      ]
      const profitByName = new Map([['厨房产品销售毛利（不含净水及服务）', profit('厨房产品销售毛利（不含净水及服务）', 40)]])
      const { rows, covered, uncovered } = matchProductCategories(cats, incomeRoots, profitByName)
      expect(rows).toHaveLength(1)
      expect(rows[0].category).toBe('厨房产品销售')
      expect(rows[0].income.monthActual).toBe(100)
      expect(rows[0].income.budget).toBe(1200)
      expect(rows[0].income.monthRate).toBe(100) // 100 / (1200/12) × 100
      expect(rows[0].profit.monthActual).toBe(40)
      expect(covered[0].subjects).toEqual(['厨房产品销售收入（不含净水及服务）'])
      // 被匹配节点的后代叶子（燃气具-灶具收入）视为已覆盖，不列入；未匹配的"其他业务收入"提示
      expect(uncovered).toEqual(['其他业务收入'])
    })

    it('关键词命中多个节点时各维度求和（含毛利镜像求和）', () => {
      const cats = [{ code: 'water', name: '直饮水业务', subjectKeyword: '直饮水' }]
      const incomeRoots = [
        income('直饮水安装收入', 3, 30, 360),
        income('直饮水售水收入', 3, 70, 840),
      ]
      const profitByName = new Map([
        ['直饮水安装毛利', profit('直饮水安装毛利', 10)],
        ['直饮水售水毛利', profit('直饮水售水毛利', 20)],
      ])
      const { rows } = matchProductCategories(cats, incomeRoots, profitByName)
      expect(rows).toHaveLength(1)
      expect(rows[0].income.monthActual).toBe(100)
      expect(rows[0].income.budget).toBe(1200)
      expect(rows[0].income.monthRate).toBe(100)
      expect(rows[0].profit.monthActual).toBe(30)
    })

    it('毛利镜像缺失时毛利组全 0/null', () => {
      const cats = [{ code: 'new', name: '新产品及其它', subjectKeyword: '新产品' }]
      const incomeRoots = [income('新产品及其它收入', 3, 10, 120)]
      const { rows } = matchProductCategories(cats, incomeRoots, new Map())
      expect(rows).toHaveLength(1)
      expect(rows[0].profit.monthActual).toBe(0)
      expect(rows[0].profit.monthRate).toBeNull()
    })

    it('无匹配科目或无数据的品类被过滤，covered 仍保留全部配置', () => {
      const cats = [
        { code: 'a', name: '有数据品类', subjectKeyword: '有数据' },
        { code: 'b', name: '无匹配品类', subjectKeyword: '不存在' },
        { code: 'c', name: '零值品类', subjectKeyword: '零值' },
      ]
      const incomeRoots = [
        income('有数据品类收入', 3, 10, 120),
        income('零值品类收入', 3, 0, 0),
      ]
      const { rows, covered } = matchProductCategories(cats, incomeRoots, new Map())
      expect(rows.map((r) => r.category)).toEqual(['有数据品类'])
      expect(covered).toHaveLength(3)
      expect(covered[1].subjects).toEqual([])
      expect(covered[2].subjects).toEqual(['零值品类收入'])
    })
  })
})
