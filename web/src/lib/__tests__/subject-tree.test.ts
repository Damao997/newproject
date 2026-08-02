import { describe, it, expect } from 'vitest'
import {
  decorateTree,
  flattenTree,
  filterTree,
  operatingAnalysisTree,
  operatingAnalysisFlat,
  staticAnalysisTree,
  staticAnalysisFlat,
  type RawSubjectNode,
} from '@/lib/subject-tree'

const sampleRaw: RawSubjectNode[] = [
  {
    name: '收入',
    dataType: 'calc',
    children: [
      {
        name: '壹品慧收入',
        dataType: 'calc',
        children: [{ name: '灶具收入', dataType: 'data' }],
      },
    ],
  },
  { name: '经营指标', dataType: 'display' },
]

describe('decorateTree', () => {
  it('级联赋码：level0 段位 + 子级父码拼接，编码唯一', () => {
    const tree = decorateTree(sampleRaw)
    const codes = flattenTree(tree).map((r) => r.node.code)
    expect(codes).toEqual(['OP_02', 'OP_0201', 'OP_020101', 'OP_06'])
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.every((c) => /^OP_\d{2}(?:\d{2})*$/.test(c))).toBe(true)
  })

  it('level 等于深度，category 传播为 level0 根名', () => {
    const tree = decorateTree(sampleRaw)
    const leaf = tree[0].children[0].children[0]
    expect(leaf.name).toBe('灶具收入')
    expect(leaf.level).toBe(2)
    expect(leaf.category).toBe('收入')
    expect(tree[1].level).toBe(0)
    expect(tree[1].category).toBe('经营指标')
  })
})

describe('flattenTree', () => {
  it('为前序遍历并带深度', () => {
    const rows = flattenTree(decorateTree(sampleRaw))
    expect(rows.map((r) => r.node.name)).toEqual(['收入', '壹品慧收入', '灶具收入', '经营指标'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 0])
  })
})

describe('filterTree', () => {
  const tree = decorateTree(sampleRaw)

  it('命中节点并保留祖先链', () => {
    const result = filterTree(tree, '灶具')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('收入')
    expect(result[0].children[0].children[0].name).toBe('灶具收入')
  })

  it('可按编码过滤', () => {
    const result = filterTree(tree, 'OP_06')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('经营指标')
  })

  it('空关键字返回原树', () => {
    expect(filterTree(tree, '  ')).toBe(tree)
  })
})

describe('operatingAnalysis 全量数据', () => {
  it('科目总数大于 100', () => {
    expect(operatingAnalysisFlat.length).toBeGreaterThan(100)
  })

  it('包含 8 个 level0 类别且编码唯一', () => {
    expect(operatingAnalysisTree).toHaveLength(8)
    expect(operatingAnalysisTree.map((n) => n.name)).toEqual([
      '回款', '收入', '成本', '毛利', '费用', '经营指标', '财务指标', '现金流指标',
    ])
    const codes = operatingAnalysisFlat.map((r) => r.node.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('抽样校验层级/类别/数据类型（燃气具-灶具收入）', () => {
    const target = operatingAnalysisFlat.find((r) => r.node.name === '燃气具-灶具收入')
    expect(target).toBeDefined()
    expect(target!.node.level).toBe(4)
    expect(target!.node.category).toBe('收入')
    expect(target!.node.dataType).toBe('data')
  })
})

describe('decorateTree 静态前缀', () => {
  it('ST 前缀按静态段位表级联赋码', () => {
    const stRaw: RawSubjectNode[] = [
      {
        name: '应收账款',
        dataType: 'calc',
        children: [{ name: '集团内客户（含城燃体系）', dataType: 'data' }],
      },
    ]
    const tree = decorateTree(stRaw, 'ST')
    const codes = flattenTree(tree).map((r) => r.node.code)
    expect(codes).toEqual(['ST_12', 'ST_1201'])
    expect(codes.every((c) => /^ST_\d{2}(?:\d{2})*$/.test(c))).toBe(true)
  })
})

describe('staticAnalysis 全量数据', () => {
  it('节点数大于 30 且编码形如 ST_ 级联格式并唯一', () => {
    expect(staticAnalysisFlat.length).toBeGreaterThan(30)
    const codes = staticAnalysisFlat.map((r) => r.node.code)
    expect(codes.every((c) => /^ST_\d{2}(?:\d{2})*$/.test(c))).toBe(true)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('应收账款有 3 个子级且为计算类', () => {
    const ar = staticAnalysisTree.find((n) => n.name === '应收账款')
    expect(ar).toBeDefined()
    expect(ar!.dataType).toBe('calc')
    expect(ar!.children).toHaveLength(3)
  })

  it('存货有 13 个子级', () => {
    const inv = staticAnalysisTree.find((n) => n.name === '存货')
    expect(inv).toBeDefined()
    expect(inv!.children).toHaveLength(13)
  })

  it('子级层级/类别传播正确（集团内客户）', () => {
    const child = staticAnalysisFlat.find((r) => r.node.name === '集团内客户（含城燃体系）')
    expect(child).toBeDefined()
    expect(child!.node.level).toBe(1)
    expect(child!.node.category).toBe('应收账款')
    expect(child!.node.dataType).toBe('data')
  })

  it('总资产为 level0 数据类', () => {
    const ta = staticAnalysisFlat.find((r) => r.node.name === '总资产')
    expect(ta).toBeDefined()
    expect(ta!.node.level).toBe(0)
    expect(ta!.node.dataType).toBe('data')
  })

  it('静态树仅含 data/calc（无 display）', () => {
    expect(staticAnalysisFlat.every((r) => r.node.dataType !== 'display')).toBe(true)
  })
})
