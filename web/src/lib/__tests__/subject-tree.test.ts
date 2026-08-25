import { describe, it, expect } from 'vitest'
import {
  decorateTree,
  flattenTree,
  filterTree,
  filterTreeKeepSubtree,
  operatingAnalysisTree,
  operatingAnalysisFlat,
  staticAnalysisTree,
  staticAnalysisFlat,
  cashflowAnalysisTree,
  cashflowAnalysisFlat,
  type RawSubjectNode,
} from '@/lib/subject-tree'

const sampleRaw: RawSubjectNode[] = [
  {
    name: '壹品慧收入',
    dataType: 'calc',
    children: [
      {
        name: '增值业务收入',
        dataType: 'calc',
        children: [{ name: '燃气具-灶具收入', dataType: 'data' }],
      },
    ],
  },
  { name: '经营指标', dataType: 'display' },
]

describe('decorateTree', () => {
  it('级联赋码：level0 段位 + 子级父码拼接，编码唯一', () => {
    const tree = decorateTree(sampleRaw)
    const codes = flattenTree(tree).map((r) => r.node.code)
    expect(codes).toEqual(['PL02', 'PL0201', 'PL020101', 'PL08'])
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.every((c) => /^PL\d{2}(?:\d{2})*$/.test(c))).toBe(true)
  })

  it('level 等于深度，category 传播为 level0 根名', () => {
    const tree = decorateTree(sampleRaw)
    const leaf = tree[0].children[0].children[0]
    expect(leaf.name).toBe('燃气具-灶具收入')
    expect(leaf.level).toBe(2)
    expect(leaf.category).toBe('壹品慧收入')
    expect(tree[1].level).toBe(0)
    expect(tree[1].category).toBe('经营指标')
  })
})

describe('flattenTree', () => {
  it('为前序遍历并带深度', () => {
    const rows = flattenTree(decorateTree(sampleRaw))
    expect(rows.map((r) => r.node.name)).toEqual(['壹品慧收入', '增值业务收入', '燃气具-灶具收入', '经营指标'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 0])
  })
})

describe('filterTree', () => {
  const tree = decorateTree(sampleRaw)

  it('命中节点并保留祖先链', () => {
    const result = filterTree(tree, '灶具')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('壹品慧收入')
    expect(result[0].children[0].children[0].name).toBe('燃气具-灶具收入')
  })

  it('可按编码过滤', () => {
    const result = filterTree(tree, 'PL08')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('经营指标')
  })

  it('空关键字返回原树', () => {
    expect(filterTree(tree, '  ')).toBe(tree)
  })
})

describe('filterTreeKeepSubtree', () => {
  const tree = decorateTree(sampleRaw)

  it('命中父节点保留整棵子树（含全部后代）', () => {
    const result = filterTreeKeepSubtree(tree, '增值业务收入')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('壹品慧收入')
    // 命中节点后代原样保留（整棵子树）
    expect(result[0].children[0].children.map((c) => c.name)).toEqual(['燃气具-灶具收入'])
  })

  it('命中叶子仅保留祖先链（与 filterTree 一致路径）', () => {
    const result = filterTreeKeepSubtree(tree, '灶具')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('壹品慧收入')
    expect(result[0].children[0].children.map((c) => c.name)).toEqual(['燃气具-灶具收入'])
  })

  it('可按编码过滤且大小写不敏感', () => {
    const result = filterTreeKeepSubtree(tree, 'pl08')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('经营指标')
  })

  it('空关键字返回原树（不复制）', () => {
    expect(filterTreeKeepSubtree(tree, '  ')).toBe(tree)
  })
})

describe('operatingAnalysis 全量数据', () => {
  it('科目总数大于 100', () => {
    expect(operatingAnalysisFlat.length).toBeGreaterThan(100)
  })

  it('包含 8 个 level0 类别且编码唯一', () => {
    expect(operatingAnalysisTree).toHaveLength(8)
    expect(operatingAnalysisTree.map((n) => n.name)).toEqual([
      '壹品慧回款', '壹品慧收入', '壹品慧成本', '壹品慧毛利', '壹品慧费用', '经营成果', '壹品慧毛利率', '经营指标',
    ])
    const codes = operatingAnalysisFlat.map((r) => r.node.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('抽样校验层级/类别/数据类型（燃气具-灶具收入）', () => {
    const target = operatingAnalysisFlat.find((r) => r.node.name === '燃气具-灶具收入')
    expect(target).toBeDefined()
    expect(target!.node.level).toBe(3)
    expect(target!.node.category).toBe('壹品慧收入')
    expect(target!.node.dataType).toBe('data')
  })
})

describe('decorateTree 静态/现金流前缀', () => {
  it('BS 前缀按静态段位表级联赋码', () => {
    const bsRaw: RawSubjectNode[] = [
      {
        name: '总资产',
        dataType: 'calc',
        children: [{ name: '银行存款', dataType: 'data' }],
      },
    ]
    const tree = decorateTree(bsRaw, 'BS')
    const codes = flattenTree(tree).map((r) => r.node.code)
    expect(codes).toEqual(['BS01', 'BS0101'])
    expect(codes.every((c) => /^BS\d{2}(?:\d{2})*$/.test(c))).toBe(true)
  })

  it('CF 前缀按现金流段位表级联赋码', () => {
    const cfRaw: RawSubjectNode[] = [
      {
        name: '经营活动产生的现金流量',
        dataType: 'calc',
        children: [{ name: '经营活动产生的现金流入', dataType: 'calc' }],
      },
    ]
    const tree = decorateTree(cfRaw, 'CF')
    const codes = flattenTree(tree).map((r) => r.node.code)
    expect(codes).toEqual(['CF01', 'CF0101'])
  })
})

describe('staticAnalysis 全量数据', () => {
  it('节点数大于 30 且编码形如 BS_ 级联格式并唯一', () => {
    expect(staticAnalysisFlat.length).toBeGreaterThan(30)
    const codes = staticAnalysisFlat.map((r) => r.node.code)
    expect(codes.every((c) => /^BS\d{2}(?:\d{2})*$/.test(c))).toBe(true)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('应收账款为总资产下数据类叶子', () => {
    const ta = staticAnalysisTree.find((n) => n.name === '总资产')
    const ar = ta?.children.find((n) => n.name === '应收账款')
    expect(ar).toBeDefined()
    expect(ar!.dataType).toBe('data')
    expect(ar!.children).toHaveLength(0)
  })

  it('存货有 13 个子级', () => {
    const ta = staticAnalysisTree.find((n) => n.name === '总资产')
    const inv = ta?.children.find((n) => n.name === '存货')
    expect(inv).toBeDefined()
    expect(inv!.children).toHaveLength(13)
  })

  it('子级层级/类别传播正确（壁挂炉）', () => {
    const child = staticAnalysisFlat.find((r) => r.node.name === '壁挂炉')
    expect(child).toBeDefined()
    expect(child!.node.level).toBe(2)
    expect(child!.node.category).toBe('总资产')
    expect(child!.node.dataType).toBe('data')
  })

  it('总资产为 level0 计算类（子求和）', () => {
    const ta = staticAnalysisTree.find((n) => n.name === '总资产')
    expect(ta).toBeDefined()
    expect(ta!.level).toBe(0)
    expect(ta!.dataType).toBe('calc')
  })

  it('静态指标段含 5 个比率类（BS04）', () => {
    const si = staticAnalysisTree.find((n) => n.name === '静态指标')
    expect(si).toBeDefined()
    expect(si!.dataType).toBe('display')
    expect(si!.children.map((c) => c.name)).toEqual([
      '总资产报酬率（ROA,%）', '资产负债率(%)', '净资产回报率（ROE,%）',
      '存货周转天数', '应收账款周转天数',
    ])
  })
})

describe('cashflowAnalysis 全量数据', () => {
  it('三大活动净额与流入流出结构正确', () => {
    expect(cashflowAnalysisTree).toHaveLength(3)
    expect(cashflowAnalysisTree.map((n) => n.name)).toEqual([
      '经营活动产生的现金流量', '投资活动产生的现金流量', '筹资活动产生的现金流量',
    ])
    const op = cashflowAnalysisTree[0]
    expect(op.children.map((c) => c.name)).toEqual(['经营活动产生的现金流入', '经营活动产生的现金流出'])
    expect(op.children[0].children).toHaveLength(3)
    expect(op.children[1].children).toHaveLength(4)
    const codes = cashflowAnalysisFlat.map((r) => r.node.code)
    expect(codes.every((c) => /^CF\d{2}(?:\d{2})*$/.test(c))).toBe(true)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
