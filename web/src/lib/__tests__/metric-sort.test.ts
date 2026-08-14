import { describe, it, expect } from 'vitest'
import { sortTreeByLevel, metricValueOf } from '@/lib/metric-sort'
import type { SubjectNode } from '@/types'
import type { MetricValue } from '@/lib/metric-values'

function node(code: string, children: SubjectNode[] = []): SubjectNode {
  return { code, name: code, level: 0, category: 'cat', dataType: 'data', valueType: 'amount', children }
}

const MV = (partial: Partial<MetricValue> = {}): MetricValue => ({
  budget: 100, actual: 10, samePeriod: 8, ytd: 50, samePeriodYtd: 40, ...partial,
})

describe('metricValueOf', () => {
  it('原始字段直接取值', () => {
    expect(metricValueOf('budget', MV({ budget: 200 }))).toBe(200)
    expect(metricValueOf('actual', MV({ actual: 30 }))).toBe(30)
    expect(metricValueOf('samePeriod', MV({ samePeriod: 12 }))).toBe(12)
    expect(metricValueOf('ytd', MV({ ytd: 60 }))).toBe(60)
    expect(metricValueOf('samePeriodYtd', MV({ samePeriodYtd: 44 }))).toBe(44)
  })
  it('yoy/achievement/ytdYoy 按口径计算', () => {
    expect(metricValueOf('yoy', MV({ actual: 10, samePeriod: 8 }))).toBeCloseTo(0.25)
    expect(metricValueOf('achievement', MV({ ytd: 50, budget: 100 }))).toBe(0.5)
    expect(metricValueOf('ytdYoy', MV({ ytd: 50, samePeriodYtd: 40 }))).toBeCloseTo(0.25)
  })
})

describe('sortTreeByLevel', () => {
  it('升序排序同层兄弟，保持树形结构', () => {
    const a = node('a', [node('a1'), node('a2')])
    const b = node('b', [node('b1')])
    const c = node('c')
    const map = new Map<string, MetricValue>([
      ['a', MV({ actual: 10 })], ['b', MV({ actual: 30 })], ['c', MV({ actual: 20 })],
    ])
    const sorted = sortTreeByLevel([a, b, c], map, 'actual', 'asc')
    expect(sorted.map((n) => n.code)).toEqual(['a', 'c', 'b'])
    // 子节点同样按该键排序
    const map2 = new Map(map)
    map2.set('a1', MV({ actual: 5 }))
    map2.set('a2', MV({ actual: 15 }))
    const sorted2 = sortTreeByLevel([a], map2, 'actual', 'asc')
    expect(sorted2[0].children.map((n) => n.code)).toEqual(['a1', 'a2'])
  })

  it('降序排序', () => {
    const map = new Map<string, MetricValue>([
      ['a', MV({ actual: 10 })], ['b', MV({ actual: 30 })], ['c', MV({ actual: 20 })],
    ])
    const sorted = sortTreeByLevel([node('a'), node('b'), node('c')], map, 'actual', 'desc')
    expect(sorted.map((n) => n.code)).toEqual(['b', 'c', 'a'])
  })

  it('无值的节点排最后（保持相对顺序）', () => {
    const map = new Map<string, MetricValue>([['b', MV({ actual: 30 })]])
    const sorted = sortTreeByLevel([node('a'), node('b'), node('c')], map, 'actual', 'asc')
    expect(sorted.map((n) => n.code)).toEqual(['b', 'a', 'c'])
  })

  it('fromLevel=1 时根层不动（经营指标分类根不排序）', () => {
    const a = node('a', [node('a1'), node('a2')])
    const b = node('b')
    const map = new Map<string, MetricValue>([
      ['a', MV({ actual: 30 })], ['b', MV({ actual: 10 })],
      ['a1', MV({ actual: 5 })], ['a2', MV({ actual: 15 })],
    ])
    const sorted = sortTreeByLevel([a, b], map, 'actual', 'asc', { fromLevel: 1 })
    expect(sorted.map((n) => n.code)).toEqual(['a', 'b'])
    expect(sorted[0].children.map((n) => n.code)).toEqual(['a1', 'a2'])
  })

  it('不修改原树（纯函数）', () => {
    const a = node('a', [node('a1')])
    const b = node('b')
    const map = new Map<string, MetricValue>([['a', MV({ actual: 10 })], ['b', MV({ actual: 30 })]])
    const before = [a, b]
    sortTreeByLevel(before, map, 'actual', 'asc')
    expect(before.map((n) => n.code)).toEqual(['a', 'b'])
    expect(before[0].children).toBe(a.children)
  })
})
