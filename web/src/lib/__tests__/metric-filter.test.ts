import { describe, it, expect } from 'vitest'
import { filterByCategories } from '@/lib/metric-filter'
import type { SubjectNode } from '@/types'

function node(code: string, children: SubjectNode[] = []): SubjectNode {
  return { code, name: code, level: 0, category: 'cat', dataType: 'data', valueType: 'amount', children }
}

describe('filterByCategories', () => {
  const tree = [
    node('OP_01', [node('OP_0101'), node('OP_0102')]),
    node('OP_02', [node('OP_0201')]),
    node('OP_03'),
  ]

  it('codes 为 null 时返回原树', () => {
    expect(filterByCategories(tree, null)).toBe(tree)
  })

  it('codes 为空数组时表示无分类（返回空数组，表格显示空态）', () => {
    expect(filterByCategories(tree, [])).toEqual([])
  })

  it('按 level0 编码过滤并保留整棵子树', () => {
    const filtered = filterByCategories(tree, ['OP_01'])
    expect(filtered.map((n) => n.code)).toEqual(['OP_01'])
    expect(filtered[0].children.map((n) => n.code)).toEqual(['OP_0101', 'OP_0102'])
  })

  it('多分类命中保持原顺序', () => {
    const filtered = filterByCategories(tree, ['OP_03', 'OP_01'])
    expect(filtered.map((n) => n.code)).toEqual(['OP_01', 'OP_03'])
  })
})
