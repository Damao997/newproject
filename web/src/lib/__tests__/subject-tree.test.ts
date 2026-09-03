import { describe, it, expect } from 'vitest'
import {
  buildSubjectTree,
  flattenTree,
  filterTree,
  filterTreeKeepSubtree,
  nextChildSubjectCode,
  nextRootSubjectCode,
  type FlatSubjectItem,
} from '@/lib/subject-tree'

/** 与后端扁平列表同构的内联 fixture（替代已删除的 mock 科目树） */
const sampleFlat: FlatSubjectItem[] = [
  { code: 'PL02', name: '壹品慧收入', level: 0, parentCode: null, category: '壹品慧收入', dataType: 'calc' },
  { code: 'PL0201', name: '增值业务收入', level: 1, parentCode: 'PL02', category: '壹品慧收入', dataType: 'calc' },
  { code: 'PL020101', name: '燃气具-灶具收入', level: 2, parentCode: 'PL0201', category: '壹品慧收入', dataType: 'data' },
  { code: 'PL08', name: '经营指标', level: 0, parentCode: null, category: '经营指标', dataType: 'display' },
]

const sampleTree = buildSubjectTree(sampleFlat)

describe('buildSubjectTree', () => {
  it('按 parentCode 构树，根为 parentCode 为空者', () => {
    expect(sampleTree).toHaveLength(2)
    expect(sampleTree.map((n) => n.name)).toEqual(['壹品慧收入', '经营指标'])
    expect(sampleTree[0].children[0].children[0].name).toBe('燃气具-灶具收入')
  })
})

describe('flattenTree', () => {
  it('为前序遍历并带深度', () => {
    const rows = flattenTree(sampleTree)
    expect(rows.map((r) => r.node.name)).toEqual(['壹品慧收入', '增值业务收入', '燃气具-灶具收入', '经营指标'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 0])
  })
})

describe('filterTree', () => {
  it('命中节点并保留祖先链', () => {
    const result = filterTree(sampleTree, '灶具')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('壹品慧收入')
    expect(result[0].children[0].children[0].name).toBe('燃气具-灶具收入')
  })

  it('可按编码过滤', () => {
    const result = filterTree(sampleTree, 'PL08')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('经营指标')
  })

  it('空关键字返回原树', () => {
    expect(filterTree(sampleTree, '  ')).toBe(sampleTree)
  })
})

describe('filterTreeKeepSubtree', () => {
  it('命中父节点保留整棵子树（含全部后代）', () => {
    const result = filterTreeKeepSubtree(sampleTree, '增值业务收入')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('壹品慧收入')
    // 命中节点后代原样保留（整棵子树）
    expect(result[0].children[0].children.map((c) => c.name)).toEqual(['燃气具-灶具收入'])
  })

  it('命中叶子仅保留祖先链（与 filterTree 一致路径）', () => {
    const result = filterTreeKeepSubtree(sampleTree, '灶具')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('壹品慧收入')
    expect(result[0].children[0].children.map((c) => c.name)).toEqual(['燃气具-灶具收入'])
  })

  it('可按编码过滤且大小写不敏感', () => {
    const result = filterTreeKeepSubtree(sampleTree, 'pl08')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('经营指标')
  })

  it('空关键字返回原树（不复制）', () => {
    expect(filterTreeKeepSubtree(sampleTree, '  ')).toBe(sampleTree)
  })
})

describe('编码预览', () => {
  it('nextChildSubjectCode：父码 + 同级最大序号 + 1', () => {
    expect(nextChildSubjectCode('PL0201', sampleFlat)).toBe('PL020102')
  })

  it('nextChildSubjectCode：序号超 99 返回 null', () => {
    const full: FlatSubjectItem[] = [
      { code: 'PL0201', name: 'x', level: 1, parentCode: 'PL02', category: 'c', dataType: 'data' },
      { code: 'PL0299', name: 'y', level: 1, parentCode: 'PL02', category: 'c', dataType: 'data' },
    ]
    expect(nextChildSubjectCode('PL02', full)).toBeNull()
  })

  it('nextRootSubjectCode：名称命中段位表用登记段位', () => {
    expect(nextRootSubjectCode('PL', '壹品慧回款', sampleFlat)).toEqual({ code: 'PL01', registered: true })
  })

  it('nextRootSubjectCode：未命中自动分配下一未用段位', () => {
    // sampleFlat 已含 PL02/PL08，下一未用段位为 09
    expect(nextRootSubjectCode('PL', '新增经营段', sampleFlat)).toEqual({ code: 'PL09', registered: false })
  })
})
