import { describe, it, expect } from 'vitest'
import { changeRate, rateOf, findInCategory, monthlyBudgetSeries, budgetAnnualTotal, fallbackBudgetSeries, ytdBudgetSeries, ytdBudgetOf, mapAlertRow, alertScopeWhere, productMetric, matchProductCategories, matchExpenseMappings, keyMetricsGroup } from './DashboardService'
import { OPERATING_DIMS } from '../lib/metric-values'
import { splitMonthlyBudget } from './BudgetRatioService'
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
    it('负基期扭亏为盈返回正比率（绝对值分母，方向不反转）', () => {
      expect(changeRate(50, -100)).toBe(1.5)
    })
    it('负基期亏损扩大返回负比率', () => {
      expect(changeRate(-150, -100)).toBe(-0.5)
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
    it('无月度粒度且配置完整占比时返回全 null（占比拆分交由 fallbackBudgetSeries）', () => {
      const rows = [{ accountCode: 'A', period: 'FY2026', value: 1200 }]
      const fy = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']
      const ratios = [3, 8, 11, 4, 7, 12, 7, 10, 13, 5, 8, 12]
      expect(monthlyBudgetSeries(rows, ['A'], fy, ratios)).toEqual(fy.map(() => null))
    })
    it('无月度粒度、配置占比但 months 不足 12 时保持均摊（占比仅对完整财年序列生效）', () => {
      const rows = [{ accountCode: 'A', period: 'FY2026', value: 1200 }]
      expect(monthlyBudgetSeries(rows, ['A'], months, [3, 8, 11])).toEqual([100, 100, 100])
    })
    it('有月度粒度行时行值优先，占比不参与', () => {
      const rows = [
        { accountCode: 'A', period: '2026-01', value: 100 },
        { accountCode: 'A', period: '2026-03', value: 120 },
      ]
      expect(monthlyBudgetSeries(rows, ['A'], months, [3, 8, 11])).toEqual([100, null, 120])
    })
    it('组合链路（模拟 buildDashboardData）：annual 行 + 完整占比 → fallback 按占比拆分且 Σ=年度总额', () => {
      const rows = [{ accountCode: 'A', period: 'FY2026', value: 12000 }]
      const fy = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']
      const ratios = [3, 8, 11, 4, 7, 12, 7, 10, 13, 5, 8, 12]
      const series = monthlyBudgetSeries(rows, ['A'], fy, ratios)
      expect(series).toEqual(fy.map(() => null))
      const out = fallbackBudgetSeries(series, 12000, fy, ratios)
      expect(out[0]).toBe(360) // 4月 3%
      expect(out[5]).toBe(1440) // 9月 12%
      expect(out[8]).toBe(1560) // 12月 13%
      expect(out.reduce((s, v) => s + (v ?? 0), 0)).toBe(12000)
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

  describe('fallbackBudgetSeries 预算序列兜底（月度口径）', () => {
    const months = ['2026-04', '2026-05', '2026-06']
    it('序列非全 null 时保持原样（月度粒度预算优先）', () => {
      const series = [100, null, 120]
      expect(fallbackBudgetSeries(series, 500, months)).toEqual([100, null, 120])
    })
    it('全 null 时按年度/12 均摊', () => {
      const series = [null, null, null]
      expect(fallbackBudgetSeries(series, 1200, months)).toEqual([100, 100, 100])
    })
    it('months 不足 12 时占比不生效（仍按年度/12 均摊）', () => {
      const series = [null, null, null]
      expect(fallbackBudgetSeries(series, 1200, months, [3, 8, 11])).toEqual([100, 100, 100])
    })
    it('传入占比但序列非全 null 时保持原样（月度粒度预算优先，占比不生效）', () => {
      const series = [100, null, 120]
      expect(fallbackBudgetSeries(series, 10000, months, [3, 8, 11])).toEqual([100, null, 120])
    })
    it('传入占比但年度总额为 0 时保持全 null（无预算不伪造）', () => {
      expect(fallbackBudgetSeries([null, null, null], 0, months, [3, 8, 11])).toEqual([null, null, null])
    })
    it('完整 12 个月财年序列按占比拆分且 Σ=年度总额（末月余差）', () => {
      const fy = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']
      const out = fallbackBudgetSeries(fy.map(() => null), 10000, fy, [3, 8, 11, 4, 7, 12, 7, 10, 13, 5, 8, 12])
      expect(out.reduce((s, v) => s + (v ?? 0), 0)).toBe(10000)
      expect(out[0]).toBe(300)
    })
    it('年度总额为 0 时保持全 null（无预算不伪造）', () => {
      expect(fallbackBudgetSeries([null, null, null], 0, months)).toEqual([null, null, null])
    })
  })

  describe('ytdBudgetSeries 累计预算序列（月度序列逐月累加）', () => {
    const months = ['2026-04', '2026-05', '2026-06']
    it('无月度序列时回退年度总额水平线（旧口径）', () => {
      expect(ytdBudgetSeries(1200, months)).toEqual([1200, 1200, 1200])
    })
    it('占比拆分序列逐月累加：4/5/6 月各 10% 时 6 月累计 = 总额 × 30%', () => {
      const fy = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']
      const ratios = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0]
      const monthly = splitMonthlyBudget(1200, ratios, fy)
      expect(monthly[0]).toBe(120) // 4 月 10%
      const ytd = ytdBudgetSeries(1200, fy, monthly)
      expect(ytd[0]).toBe(120)
      expect(ytd[1]).toBe(240)
      expect(ytd[2]).toBe(360) // 1200 × (10%+10%+10%)
    })
    it('均摊月度序列累加：n 个月累计 = 总额 × n/12', () => {
      const monthly = [100, 100, 100]
      expect(ytdBudgetSeries(1200, months, monthly)).toEqual([100, 200, 300])
    })
    it('部分月份无预算行（null）时维持此前累计值不中断', () => {
      expect(ytdBudgetSeries(1200, months, [120, null, 120])).toEqual([120, 120, 240])
    })
    it('年度总额为 0 时返回全 null（无预算不伪造）', () => {
      expect(ytdBudgetSeries(0, months)).toEqual([null, null, null])
      expect(ytdBudgetSeries(0, months, [100, 100, 100])).toEqual([null, null, null])
    })
  })

  describe('ytdBudgetOf 累计预算（占比前缀和 / 均摊累计）', () => {
    it('配置占比时按年度总额 × 从年初到当期占比前缀和', () => {
      const ratios = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0]
      expect(ytdBudgetOf(1200, ratios, 0)).toBe(120)
      expect(ytdBudgetOf(1200, ratios, 2)).toBe(360) // 1200 × 30%
      expect(ytdBudgetOf(1200, ratios, 11)).toBe(1200) // 全年 100%
    })
    it('ratios 缺失时按均摊累计（年度总额 × (monthIndex+1)/12）', () => {
      expect(ytdBudgetOf(1200, null, 2)).toBe(300)
      expect(ytdBudgetOf(1200, null, 0)).toBe(100)
    })
    it('ratios 越界（monthIndex 超出项数）时回退均摊累计', () => {
      expect(ytdBudgetOf(1200, [3, 8], 2)).toBe(300) // 越界走均摊 1200×3/12
      expect(ytdBudgetOf(1200, [3, 8], 1)).toBe(132) // 未越界仍按前缀和 1200×(3%+8%)
    })
    it('monthIndex < 0 返回 undefined（调用方保持旧口径）；年度总额为 0 返回 0（归一为 null）', () => {
      expect(ytdBudgetOf(1200, [3, 8, 11], -1)).toBeUndefined()
      expect(ytdBudgetOf(0, [3, 8, 11], 2)).toBe(0)
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
    it('传入月度预算（monthBudget）时月度达成率按占比拆分值计算', () => {
      const m = productMetric(node({ values: dims }), 300)
      expect(m.monthRate).toBe(33.33) // 100 / 300 × 100
      expect(m.ytdRate).toBe(41.67) // 累计口径不受影响
    })
    it('传入累计预算（ytdBudget）时 ytdCumRate 按累计预算计算，ytdRate 保持年度总额口径', () => {
      const m = productMetric(node({ values: dims }), undefined, 360)
      expect(m.ytdBudget).toBe(360)
      expect(m.ytdRate).toBe(41.67) // 500 / 1200 × 100，看板展示口径不受 ytdBudget 影响
      expect(m.ytdCumRate).toBe(138.89) // 500 / 360 × 100，预警口径按占比前缀和
      expect(m.monthRate).toBe(100) // 月度口径不受影响
    })
    it('传入累计预算为 0/null 时 ytdCumRate 为 null，输出 ytdBudget 为 null（无预算不伪造）', () => {
      expect(productMetric(node({ values: dims }), undefined, 0).ytdCumRate).toBeNull()
      expect(productMetric(node({ values: dims }), undefined, 0).ytdBudget).toBeNull()
      expect(productMetric(node({ values: dims }), undefined, 0).ytdRate).toBe(41.67) // 展示口径仍按年度预算
      expect(productMetric(node({ values: dims }), undefined, null).ytdBudget).toBeNull()
    })
    it('输出 ytdBudget/ytdCumRate：未传时回退年度总额（保持旧口径）', () => {
      expect(productMetric(node({ values: dims })).ytdBudget).toBe(1200)
      expect(productMetric(node({ values: dims }), undefined, 360).ytdBudget).toBe(360)
      expect(productMetric(node({ values: dims })).ytdCumRate).toBe(41.67) // 回退展示口径 500/1200
    })
    it('传入月度预算为 0/null 时月度达成率为 null（无预算不伪造）', () => {
      expect(productMetric(node({ values: dims }), 0).monthRate).toBeNull()
      expect(productMetric(node({ values: dims }), null).monthRate).toBeNull()
    })
    it('输出 monthBudget：传数值时按占比拆分值，未传回退年度/12', () => {
      expect(productMetric(node({ values: dims }), 300).monthBudget).toBe(300)
      expect(productMetric(node({ values: dims })).monthBudget).toBe(100) // 1200/12
    })
    it('monthBudget 传 0/null 时为 null（无预算），节点缺失时回退 /12 为 0', () => {
      expect(productMetric(node({ values: dims }), 0).monthBudget).toBeNull()
      expect(productMetric(node({ values: dims }), null).monthBudget).toBeNull()
      expect(productMetric(undefined).monthBudget).toBe(0)
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

  describe('matchExpenseMappings 运营费用映射匹配', () => {
    const fee = (code: string, name: string, monthActual: number, budget: number, samePeriod: number, ytd: number, ytdSame: number): ValueNode =>
      node({
        code, name, level: 4, category: '费用',
        values: {
          [OPERATING_DIMS.ACTUAL_MONTH]: monthActual,
          [OPERATING_DIMS.BUDGET_AMOUNT]: budget,
          [OPERATING_DIMS.SAME_PERIOD_ACTUAL]: samePeriod,
          [OPERATING_DIMS.YTD_ACTUAL]: ytd,
          [OPERATING_DIMS.SAME_PERIOD_YTD]: ytdSame,
        },
      })

    it('多科目映射各维度求和（金额/预算/使用率/同比）', () => {
      const mappings = [{ code: 'labor', name: '人力成本', subjectCodes: ['HR_A', 'HR_B'] }]
      const tree = [
        fee('HR_A', '人力成本-工资', 80, 1200, 70, 900, 800),
        fee('HR_B', '人力成本-社保', 20, 600, 10, 200, 100),
      ]
      const [row] = matchExpenseMappings(mappings, tree)
      expect(row.name).toBe('人力成本')
      expect(row.monthActual).toBe(100) // 80 + 20
      expect(row.budget).toBe(1800) // 1200 + 600
      expect(row.monthRate).toBe(66.67) // 100 / (1800/12) × 100
      expect(row.monthYoy).toBe(0.25) // (100-80)/80
      expect(row.ytdActual).toBe(1100)
      expect(row.ytdRate).toBe(61.11) // 1100/1800 × 100
      expect(row.ytdYoy).toBe(0.22) // (1100-900)/900
    })

    it('映射引用的缺失编码静默跳过，其余科目正常聚合', () => {
      const mappings = [{ code: 'mix', name: '混合', subjectCodes: ['A', 'GONE', 'B'] }]
      const tree = [
        fee('A', '科目A', 10, 120, 8, 100, 90),
        fee('B', '科目B', 20, 240, 12, 200, 150),
      ]
      const [row] = matchExpenseMappings(mappings, tree)
      expect(row.monthActual).toBe(30)
      expect(row.budget).toBe(360)
    })

    it('金额与预算全为 0 的映射行不展示，无映射返回空数组', () => {
      const mappings = [
        { code: 'zero', name: '零值映射', subjectCodes: ['Z'] },
        { code: 'active', name: '有效映射', subjectCodes: ['A'] },
      ]
      const tree = [
        fee('Z', '零值科目', 0, 0, 0, 0, 0),
        fee('A', '有效科目', 10, 120, 8, 100, 90),
      ]
      const rows = matchExpenseMappings(mappings, tree)
      expect(rows.map((r) => r.code)).toEqual(['active'])
      expect(matchExpenseMappings([], tree)).toEqual([])
    })

    it('映射按配置顺序输出（不做排序）', () => {
      const mappings = [
        { code: 'b', name: '后配置', subjectCodes: ['B'] },
        { code: 'a', name: '先配置', subjectCodes: ['A'] },
      ]
      const tree = [
        fee('A', '科目A', 10, 120, 8, 100, 90),
        fee('B', '科目B', 20, 240, 12, 200, 150),
      ]
      expect(matchExpenseMappings(mappings, tree).map((r) => r.code)).toEqual(['b', 'a'])
    })

    it('传 ratios+monthIndex 时 monthRate/monthBudget 按占比拆分，累计预警口径按占比前缀和', () => {
      const mappings = [{ code: 'labor', name: '人力成本', subjectCodes: ['HR_A', 'HR_B'] }]
      const tree = [
        fee('HR_A', '人力成本-工资', 80, 1200, 70, 900, 800),
        fee('HR_B', '人力成本-社保', 20, 600, 10, 200, 100),
      ]
      const ratios = [3, 8, 11, 4, 7, 12, 7, 10, 13, 5, 8, 12]
      const [row] = matchExpenseMappings(mappings, tree, ratios, 0) // 4月 3%
      expect(row.monthBudget).toBe(54) // 1800 × 3%
      expect(row.monthRate).toBe(185.19) // 100 / 54 × 100
      expect(row.ytdBudget).toBe(54) // 1800 × 3%（截至 4 月的占比累计）
      expect(row.ytdRate).toBe(61.11) // 1100/1800，展示口径按年度预算
      expect(row.ytdCumRate).toBe(2037.04) // 1100 / 54 × 100，预警口径按占比前缀和
    })
    it('不传 ratios 时保持 /12 口径（monthBudget = budget/12）', () => {
      const mappings = [{ code: 'labor', name: '人力成本', subjectCodes: ['HR_A', 'HR_B'] }]
      const tree = [
        fee('HR_A', '人力成本-工资', 80, 1200, 70, 900, 800),
        fee('HR_B', '人力成本-社保', 20, 600, 10, 200, 100),
      ]
      const [row] = matchExpenseMappings(mappings, tree)
      expect(row.monthBudget).toBe(150) // 1800/12
      expect(row.monthRate).toBe(66.67) // 100 / (1800/12) × 100
    })
  })

  describe('keyMetricsGroup 关键指标口径组（壹品慧关键指标表 14 列）', () => {
    const base = {
      annualBudget: 1200,
      monthBudget: 100,
      actual: 110,
      prevActual: 100,
      same: 100,
      ytd: 500,
      ytdSame: 400,
    }
    it('月度：同比变动=本期-去年同期、环比变动=本期-上月、完成率=本期/月度预算；百分比按基数计算', () => {
      const g = keyMetricsGroup(base)
      expect(g.monthChange).toBe(10) // 110 - 100
      expect(g.monthYoy).toBe(0.1) // 10/100
      expect(g.monthMomChange).toBe(10) // 110 - 100
      expect(g.monthMom).toBe(0.1)
      expect(g.monthRate).toBe(110) // 110/100 × 100
      expect(g.monthActual).toBe(110)
      expect(g.monthSame).toBe(100)
      expect(g.monthBudget).toBe(100)
    })
    it('年度：累计同比变动=累计-同期累计、完成率=累计/年度预算', () => {
      const g = keyMetricsGroup(base)
      expect(g.ytdChange).toBe(100) // 500 - 400
      expect(g.ytdYoy).toBe(0.25) // 100/400
      expect(g.annualRate).toBe(41.67) // 500/1200 × 100
      expect(g.annualBudget).toBe(1200)
    })
    it('无预算（现金流板块）：monthBudget/monthRate/annualBudget/annualRate 为 null，金额列不受影响', () => {
      const g = keyMetricsGroup({ ...base, annualBudget: null, monthBudget: null })
      expect(g.monthBudget).toBeNull()
      expect(g.monthRate).toBeNull()
      expect(g.annualBudget).toBeNull()
      expect(g.annualRate).toBeNull()
      expect(g.monthActual).toBe(110)
      expect(g.ytdYoy).toBe(0.25)
    })
    it('基数 0：同比/环比/累计同比返回 0（与 changeRate 口径一致，避免除零）', () => {
      const g = keyMetricsGroup({ ...base, same: 0, prevActual: 0, ytdSame: 0 })
      expect(g.monthYoy).toBe(0)
      expect(g.monthMom).toBe(0)
      expect(g.ytdYoy).toBe(0)
    })
    it('年度预算 0：完成率为 null（前端显示「—」）', () => {
      const g = keyMetricsGroup({ ...base, annualBudget: 0 })
      expect(g.annualRate).toBeNull()
    })
  })
})
