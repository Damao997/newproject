import { describe, it, expect } from 'vitest'
import { evaluateExpression, substituteOperands, evaluateFormula, topoSortMetrics } from './formula'

describe('公式引擎 evaluateExpression', () => {
  it('四则运算与优先级', () => {
    expect(evaluateExpression('1 + 2 * 3')).toBe(7)
    expect(evaluateExpression('(1 + 2) * 3')).toBe(9)
    expect(evaluateExpression('10 / 4')).toBe(2.5)
    expect(evaluateExpression('-3 + 5')).toBe(2)
  })

  it('除零安全返回 0（不抛异常）', () => {
    expect(evaluateExpression('5 / 0')).toBe(0)
  })

  it('非法字符抛错（禁止 eval 注入）', () => {
    expect(() => evaluateExpression('1 + a')).toThrow()
    expect(() => evaluateExpression('process.exit(1)')).toThrow()
    expect(() => evaluateExpression('1;2')).toThrow()
  })

  it('括号不匹配抛错', () => {
    expect(() => evaluateExpression('(1 + 2')).toThrow()
  })
})

describe('公式引擎 substituteOperands / evaluateFormula', () => {
  it('替换 {CODE} 为数值', () => {
    expect(substituteOperands('{OP_001} - {OP_030}', { OP_001: 100, OP_030: 40 })).toBe('100 - 40')
  })
  it('缺失操作数按 0 处理', () => {
    expect(substituteOperands('{X} + 1', {})).toBe('0 + 1')
  })
  it('端到端求值', () => {
    expect(evaluateFormula('({A} - {B}) / {A}', { A: 200, B: 50 })).toBe(0.75)
  })
  it('维度后缀：优先取复合键，不回退裸键', () => {
    expect(substituteOperands('{ST_007@YEAR_START} + {ST_007}', { 'ST_007@YEAR_START': 80, ST_007: 120 })).toBe('80 + 120')
    // 带后缀但复合键缺失 → 0（不取裸键，避免跨维度取错列值）
    expect(substituteOperands('{ST_007@YEAR_START}', { ST_007: 120 })).toBe('0')
  })
  it('伪操作数 DAYS_YTD 按裸键替换；跨期间公式端到端求值', () => {
    const values = { 'ST_007@YEAR_START': 80, ST_007: 120, DAYS_YTD: 181, 'OP_031@YTD_ACTUAL': 500 }
    // (80+120)/2 * 181 / 500 = 36.2
    expect(evaluateFormula('({ST_007@YEAR_START} + {ST_007}) / 2 * {DAYS_YTD} / {OP_031@YTD_ACTUAL}', values)).toBeCloseTo(36.2)
  })
})

describe('公式引擎 topoSortMetrics', () => {
  it('按依赖顺序排序（被依赖者在前）', () => {
    const order = topoSortMetrics([
      { code: 'C', dependsOn: ['B'] },
      { code: 'B', dependsOn: ['A'] },
      { code: 'A', dependsOn: [] },
    ])
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'))
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'))
  })

  it('检测到环时抛 METRIC_CIRCULAR_REF', () => {
    expect(() =>
      topoSortMetrics([
        { code: 'A', dependsOn: ['B'] },
        { code: 'B', dependsOn: ['A'] },
      ]),
    ).toThrow(/METRIC_CIRCULAR_REF/)
  })

  it('忽略集合外部的依赖边', () => {
    const order = topoSortMetrics([{ code: 'A', dependsOn: ['EXTERNAL'] }])
    expect(order).toEqual(['A'])
  })
})
