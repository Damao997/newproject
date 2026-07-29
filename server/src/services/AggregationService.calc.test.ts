import { describe, it, expect } from 'vitest'
import { applyCalcLayer, type CalcFormula, type CrossDimOptions, type ValueNode } from './AggregationService'

/**
 * 计算层（applyCalcLayer）纯逻辑单测：不依赖 DB。
 * 覆盖：跨科目公式逐维度求值、无公式计算类保持求和、缺操作数记 0、依赖有环时不破坏树。
 */

const DIMS = ['BUDGET_AMOUNT', 'ACTUAL_MONTH', 'SAME_PERIOD_ACTUAL']

function node(code: string, values: Record<string, number>, children: ValueNode[] = []): ValueNode {
  return {
    code,
    name: code,
    level: 0,
    category: code,
    dataType: 'calc',
    direction: 'credit',
    isLeaf: children.length === 0,
    values: { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 0, SAME_PERIOD_ACTUAL: 0, ...values },
    children,
  }
}

describe('applyCalcLayer 计算层', () => {
  it('毛利 = 收入 - 成本：逐维度用公式覆盖求和默认值', () => {
    const revenue = node('OP_REV', { ACTUAL_MONTH: 300, BUDGET_AMOUNT: 320, SAME_PERIOD_ACTUAL: 250 })
    const cost = node('OP_COST', { ACTUAL_MONTH: 200, BUDGET_AMOUNT: 210, SAME_PERIOD_ACTUAL: 180 })
    const gross = node('OP_GROSS', { ACTUAL_MONTH: 0, BUDGET_AMOUNT: 0, SAME_PERIOD_ACTUAL: 0 })
    const roots = [revenue, cost, gross]
    const calc: CalcFormula[] = [{ code: 'OP_GROSS', formula: '{OP_REV} - {OP_COST}', dependsOn: ['OP_REV', 'OP_COST'] }]
    applyCalcLayer(roots, calc, DIMS)
    expect(gross.values.ACTUAL_MONTH).toBe(100)
    expect(gross.values.BUDGET_AMOUNT).toBe(110)
    expect(gross.values.SAME_PERIOD_ACTUAL).toBe(70)
    // 被依赖节点不受影响
    expect(revenue.values.ACTUAL_MONTH).toBe(300)
  })

  it('计算类依赖计算类：按拓扑序先算被依赖者', () => {
    const revenue = node('OP_REV', { ACTUAL_MONTH: 300 })
    const cost = node('OP_COST', { ACTUAL_MONTH: 200 })
    const gross = node('OP_GROSS', { ACTUAL_MONTH: 0 })
    const grossRate = node('OP_GROSS_RATE', { ACTUAL_MONTH: 0 })
    const roots = [revenue, cost, gross, grossRate]
    const calc: CalcFormula[] = [
      { code: 'OP_GROSS_RATE', formula: '{OP_GROSS} / {OP_REV}', dependsOn: ['OP_GROSS', 'OP_REV'] },
      { code: 'OP_GROSS', formula: '{OP_REV} - {OP_COST}', dependsOn: ['OP_REV', 'OP_COST'] },
    ]
    applyCalcLayer(roots, calc, ['ACTUAL_MONTH'])
    expect(gross.values.ACTUAL_MONTH).toBe(100)
    expect(grossRate.values.ACTUAL_MONTH).toBe(0.33) // 100/300 round2
  })

  it('缺失操作数记 0（引用不存在的编码）', () => {
    const target = node('OP_X', { ACTUAL_MONTH: 5 })
    const roots = [target]
    const calc: CalcFormula[] = [{ code: 'OP_X', formula: '{OP_MISSING} + 1', dependsOn: ['OP_MISSING'] }]
    applyCalcLayer(roots, calc, ['ACTUAL_MONTH'])
    expect(target.values.ACTUAL_MONTH).toBe(1) // 0 + 1
  })

  it('依赖有环：跳过计算层，保持原求和值不被破坏', () => {
    const a = node('OP_A', { ACTUAL_MONTH: 10 })
    const b = node('OP_B', { ACTUAL_MONTH: 20 })
    const roots = [a, b]
    const calc: CalcFormula[] = [
      { code: 'OP_A', formula: '{OP_B} + 1', dependsOn: ['OP_B'] },
      { code: 'OP_B', formula: '{OP_A} + 1', dependsOn: ['OP_A'] },
    ]
    expect(() => applyCalcLayer(roots, calc, ['ACTUAL_MONTH'])).not.toThrow()
    expect(a.values.ACTUAL_MONTH).toBe(10)
    expect(b.values.ACTUAL_MONTH).toBe(20)
  })

  it('无公式计算类节点保持原值（向后兼容）', () => {
    const target = node('OP_SUM', { ACTUAL_MONTH: 42 })
    applyCalcLayer([target], [], ['ACTUAL_MONTH'])
    expect(target.values.ACTUAL_MONTH).toBe(42)
  })

  it('计算节点在树深处也能被定位并覆盖', () => {
    const revLeaf = node('OP_REV', { ACTUAL_MONTH: 300 })
    const costLeaf = node('OP_COST', { ACTUAL_MONTH: 200 })
    const grossLeaf = node('OP_GROSS', { ACTUAL_MONTH: 0 })
    const parent = node('OP_PARENT', { ACTUAL_MONTH: 0 }, [grossLeaf])
    const roots = [revLeaf, costLeaf, parent]
    const calc: CalcFormula[] = [{ code: 'OP_GROSS', formula: '{OP_REV} - {OP_COST}', dependsOn: ['OP_REV', 'OP_COST'] }]
    applyCalcLayer(roots, calc, ['ACTUAL_MONTH'])
    expect(grossLeaf.values.ACTUAL_MONTH).toBe(100)
  })

  it('跨树外部操作数：ROE = 经营净利润 / 静态权益净资产', () => {
    const equity = node('ST_EQUITY', { CURRENT_AMOUNT: 1000 })
    const roe = node('ST_ROE', { CURRENT_AMOUNT: 0 })
    const roots = [equity, roe]
    const calc: CalcFormula[] = [{ code: 'ST_ROE', formula: '{OP_NET} / {ST_EQUITY}', dependsOn: ['OP_NET', 'ST_EQUITY'] }]
    // OP_NET 不在静态树内，经外部值提供（跨树）
    const external = new Map<string, Record<string, number>>([['CURRENT_AMOUNT', { OP_NET: 200 }]])
    applyCalcLayer(roots, calc, ['CURRENT_AMOUNT'], external)
    expect(roe.values.CURRENT_AMOUNT).toBe(0.2) // 200 / 1000
  })

  it('跨维度公式（周转天数）：本期按字面维度、同期列平移去年口径、年初两列置 0', () => {
    const STATIC_DIMS_ALL = ['CURRENT_AMOUNT', 'YEAR_START', 'SAME_PERIOD_AMOUNT', 'LAST_YEAR_START']
    const inv = node('ST_INV', { CURRENT_AMOUNT: 120, YEAR_START: 80, SAME_PERIOD_AMOUNT: 100, LAST_YEAR_START: 60 })
    const days = node('ST_DAYS', { CURRENT_AMOUNT: 0, YEAR_START: 0, SAME_PERIOD_AMOUNT: 0, LAST_YEAR_START: 0 })
    const roots = [inv, days]
    const calc: CalcFormula[] = [{
      code: 'ST_DAYS',
      formula: '({ST_INV@YEAR_START} + {ST_INV}) / 2 * {DAYS_YTD} / {OP_COST@YTD_ACTUAL}',
      dependsOn: ['ST_INV', 'OP_COST'],
    }]
    const identity: Record<string, string> = {
      CURRENT_AMOUNT: 'CURRENT_AMOUNT', YEAR_START: 'YEAR_START', SAME_PERIOD_AMOUNT: 'SAME_PERIOD_AMOUNT',
      LAST_YEAR_START: 'LAST_YEAR_START', YTD_ACTUAL: 'YTD_ACTUAL', SAME_PERIOD_YTD: 'SAME_PERIOD_YTD',
    }
    const crossDim: CrossDimOptions = {
      dimMap: new Map([
        ['CURRENT_AMOUNT', identity],
        ['SAME_PERIOD_AMOUNT', { CURRENT_AMOUNT: 'SAME_PERIOD_AMOUNT', YEAR_START: 'LAST_YEAR_START', YTD_ACTUAL: 'SAME_PERIOD_YTD' }],
      ]),
      pseudoByDim: new Map([
        ['CURRENT_AMOUNT', { DAYS_YTD: 100 }],
        ['SAME_PERIOD_AMOUNT', { DAYS_YTD: 100 }],
      ]),
      zeroDims: new Set(['YEAR_START', 'LAST_YEAR_START']),
      externalAllDims: { OP_COST: { YTD_ACTUAL: 500, SAME_PERIOD_YTD: 320 } },
    }
    applyCalcLayer(roots, calc, STATIC_DIMS_ALL, undefined, crossDim)
    // 本期列：(80+120)/2 × 100 ÷ 500 = 20
    expect(days.values.CURRENT_AMOUNT).toBe(20)
    // 同期列（去年口径）：{ST_INV}→同期100、@YEAR_START→上年年初60、@YTD_ACTUAL→同期累计320：(60+100)/2 × 100 ÷ 320 = 25
    expect(days.values.SAME_PERIOD_AMOUNT).toBe(25)
    // 时点列置 0
    expect(days.values.YEAR_START).toBe(0)
    expect(days.values.LAST_YEAR_START).toBe(0)
    // 非跨维度节点不受影响
    expect(inv.values.YEAR_START).toBe(80)
  })
})
