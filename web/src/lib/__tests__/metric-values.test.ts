import { describe, it, expect } from 'vitest'
import {
  computeMetricMap,
  calcYoy,
  calcAchievement,
  calcYtdYoy,
  type MetricValue,
} from '@/lib/metric-values'
import type { SubjectNode } from '@/types'

/**
 * metric-values 边界测试。
 *
 * 重点覆盖三个比率函数的除零与负值分支 —— 财务口径下
 * "分母为 0 返回 0" 与 "负分母不得让涨跌方向反转" 是易错点。
 */

/** 构造 MetricValue，未指定字段取 0 */
function mv(partial: Partial<MetricValue>): MetricValue {
  return { budget: 0, actual: 0, samePeriod: 0, ytd: 0, samePeriodYtd: 0, ...partial }
}

/** 构造科目节点 */
function node(code: string, children: SubjectNode[] = []): SubjectNode {
  return {
    code,
    name: code,
    level: 0,
    category: 'test',
    dataType: children.length > 0 ? 'calc' : 'data',
    children,
  } as SubjectNode
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

  it('同期为负（亏损转盈）→ 数学结果为负，需在展示层解读', () => {
    // (50 - (-100)) / -100 = -1.5：分母为负会使"改善"呈现为负增长
    expect(calcYoy(mv({ actual: 50, samePeriod: -100 }))).toBeCloseTo(-1.5, 10)
  })

  it('本月负、同期负（亏损扩大）', () => {
    // (-150 - (-100)) / -100 = 0.5
    expect(calcYoy(mv({ actual: -150, samePeriod: -100 }))).toBeCloseTo(0.5, 10)
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

  it('同期累计为负', () => {
    expect(calcYtdYoy(mv({ ytd: 300, samePeriodYtd: -300 }))).toBeCloseTo(-2, 10)
  })
})

describe('computeMetricMap', () => {
  it('空树 → 空映射', () => {
    expect(computeMetricMap([], 'EN330059', '2025-06').size).toBe(0)
  })

  it('单叶子：全部字段为有限正值且保留 2 位小数', () => {
    const map = computeMetricMap([node('OP_001')], 'EN330059', '2025-06')
    const v = map.get('OP_001')!
    expect(v).toBeDefined()
    for (const [k, n] of Object.entries(v)) {
      expect(Number.isFinite(n), `${k} 应为有限数`).toBe(true)
      expect(n, `${k} 应为正值`).toBeGreaterThan(0)
      // 2 位小数：×100 后应为整数
      expect(Math.abs(n * 100 - Math.round(n * 100)), `${k} 应保留 2 位小数`).toBeLessThan(1e-6)
    }
  })

  it('确定性：同一 (树,主体,期间) 两次调用结果完全一致', () => {
    const t = [node('OP_001', [node('OP_002'), node('OP_003')])]
    const a = computeMetricMap(t, 'EN330059', '2025-06')
    const b = computeMetricMap(t, 'EN330059', '2025-06')
    expect([...a.entries()]).toEqual([...b.entries()])
  })

  it('切换主体维度 → 结果变化', () => {
    const t = [node('OP_001')]
    const a = computeMetricMap(t, 'EN330059', '2025-06').get('OP_001')!
    const b = computeMetricMap(t, 'EN330060', '2025-06').get('OP_001')!
    expect(a.actual).not.toBe(b.actual)
  })

  it('切换期间 → 结果变化', () => {
    const t = [node('OP_001')]
    const a = computeMetricMap(t, 'EN330059', '2025-06').get('OP_001')!
    const b = computeMetricMap(t, 'EN330059', '2025-07').get('OP_001')!
    expect(a.actual).not.toBe(b.actual)
  })

  it('父节点 = 子节点各字段之和（容许 2 位小数舍入误差）', () => {
    const tree = [node('OP_001', [node('OP_002'), node('OP_003'), node('OP_004')])]
    const map = computeMetricMap(tree, 'EN330059', '2025-06')
    const parent = map.get('OP_001')!
    const kids = ['OP_002', 'OP_003', 'OP_004'].map((c) => map.get(c)!)

    for (const key of ['budget', 'actual', 'samePeriod', 'ytd', 'samePeriodYtd'] as const) {
      const sum = kids.reduce((s, k) => s + k[key], 0)
      expect(parent[key], `${key} 聚合`).toBeCloseTo(sum, 2)
    }
  })

  it('多层嵌套逐级聚合', () => {
    const tree = [node('OP_001', [node('OP_002', [node('OP_003'), node('OP_004')])])]
    const map = computeMetricMap(tree, 'EN330059', '2025-06')
    expect(map.size).toBe(4)
    expect(map.get('OP_001')!.actual).toBeCloseTo(map.get('OP_002')!.actual, 2)
    expect(map.get('OP_002')!.actual).toBeCloseTo(
      map.get('OP_003')!.actual + map.get('OP_004')!.actual,
      2,
    )
  })

  it('valueMin/valueMax 约束叶子本月实际区间', () => {
    const map = computeMetricMap([node('OP_001')], 'EN330059', '2025-06', {
      valueMin: 10,
      valueMax: 20,
    })
    const actual = map.get('OP_001')!.actual
    expect(actual).toBeGreaterThanOrEqual(10)
    expect(actual).toBeLessThanOrEqual(20)
  })

  it('valueMin == valueMax 时不产生 NaN（range 下限保护）', () => {
    const map = computeMetricMap([node('OP_001')], 'EN330059', '2025-06', {
      valueMin: 50,
      valueMax: 50,
    })
    const v = map.get('OP_001')!
    expect(Number.isFinite(v.actual)).toBe(true)
    expect(v.actual).toBeGreaterThanOrEqual(50)
  })

  it('valueMax < valueMin 时仍不产生 NaN', () => {
    const map = computeMetricMap([node('OP_001')], 'EN330059', '2025-06', {
      valueMin: 100,
      valueMax: 10,
    })
    expect(Number.isFinite(map.get('OP_001')!.actual)).toBe(true)
  })

  it('叶子预算约为本月实际的 12 倍量级（年度预算口径）', () => {
    const map = computeMetricMap([node('OP_001')], 'EN330059', '2025-06')
    const v = map.get('OP_001')!
    const ratio = v.budget / v.actual
    expect(ratio).toBeGreaterThan(10)
    expect(ratio).toBeLessThan(14)
  })

  it('达成率落在合理区间（防"预算按月"回归）', () => {
    const map = computeMetricMap([node('OP_001')], 'EN330059', '2025-06')
    const rate = calcAchievement(map.get('OP_001')!)
    expect(rate).toBeGreaterThan(0.2)
    expect(rate).toBeLessThan(1.2)
  })
})
