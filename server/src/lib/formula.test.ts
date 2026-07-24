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
