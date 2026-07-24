import { describe, it, expect } from 'vitest'
import { applyCalcLayer, type CalcFormula, type ValueNode } from './AggregationService'

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
})
