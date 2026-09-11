import { describe, it, expect } from 'vitest'
import { buildTree, type SubjectRow } from './AggregationService'

/**
 * buildTree 聚合纯逻辑单测：不依赖 DB。
 * 覆盖：父=子求和的默认聚合语义、展示类（display）节点不参与计算（自身恒 0，子节点照常聚合）、
 * 数据类父级直填优先（存在自身直填事实行时按行值展示，无直填行回退子求和）。
 */

const DIMS: Record<string, number> = { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 0 }

function subject(code: string, dataType: 'data' | 'calc' | 'display', parentCode: string | null, isLeaf: boolean): SubjectRow {
  return {
    code, name: code, level: parentCode ? 2 : 0, parentCode, category: 'ROOT',
    direction: 'credit', valueType: 'amount', isLeaf, dataType, orderNo: 0,
  }
}

describe('buildTree 聚合', () => {
  it('普通父节点 = 子节点求和（默认聚合语义回归）', () => {
    const subjects = [
      subject('PL02', 'calc', null, false),
      subject('PL0201', 'data', 'PL02', true),
      subject('PL0202', 'data', 'PL02', true),
    ]
    const leafValues = new Map([
      ['PL0201', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 100 }],
      ['PL0202', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 30 }],
    ])
    const tree = buildTree(subjects, leafValues, DIMS)
    expect(tree[0].values.ACTUAL_MONTH).toBe(130)
    expect(tree[0].children[0].values.ACTUAL_MONTH).toBe(100)
    expect(tree[0].children[1].values.ACTUAL_MONTH).toBe(30)
  })

  it('展示类父节点不参与求和：自身各维度恒 0，子节点照常聚合', () => {
    // 经营成果（PL06，展示类）下有数据类子节点：壹品慧税前利润/所得税费用/壹品慧净利润
    const subjects = [
      subject('PL06', 'display', null, false),
      subject('PL0601', 'data', 'PL06', true),
      subject('PL0602', 'data', 'PL06', true),
      subject('PL0603', 'data', 'PL06', true),
    ]
    const leafValues = new Map([
      ['PL0601', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 200 }],
      ['PL0602', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 50 }],
      ['PL0603', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 150 }],
    ])
    const tree = buildTree(subjects, leafValues, DIMS)
    const root = tree[0]
    // 展示类自身不显示子节点之和（不参与计算）
    expect(root.values.ACTUAL_MONTH).toBe(0)
    expect(root.values.BUDGET_AMOUNT).toBe(0)
    // 数据类子节点不受影响
    expect(root.children.map((c) => c.values.ACTUAL_MONTH)).toEqual([200, 50, 150])
  })

  it('展示类叶子不取事实值（只读展示，不参与计算）', () => {
    const subjects = [
      subject('PL_DISPLAY_LEAF', 'display', null, true),
    ]
    const leafValues = new Map([
      ['PL_DISPLAY_LEAF', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 999 }],
    ])
    const tree = buildTree(subjects, leafValues, DIMS)
    expect(tree[0].values.ACTUAL_MONTH).toBe(0)
  })

  it('嵌套展示类节点不向祖父级传递数值', () => {
    const subjects = [
      subject('PL_PARENT', 'calc', null, false),
      subject('PL_DISPLAY', 'display', 'PL_PARENT', false),
      subject('PL_DISPLAY_01', 'data', 'PL_DISPLAY', true),
    ]
    const leafValues = new Map([
      ['PL_DISPLAY_01', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 88 }],
    ])
    const tree = buildTree(subjects, leafValues, DIMS)
    // 展示类子节点正常有值，但展示类节点自身与祖父级均不受其影响
    expect(tree[0].children[0].children[0].values.ACTUAL_MONTH).toBe(88)
    expect(tree[0].children[0].values.ACTUAL_MONTH).toBe(0)
    expect(tree[0].values.ACTUAL_MONTH).toBe(0)
  })

  it('数据类父级存在直填事实行时以直填值为准（不取子级求和）', () => {
    // 场景：总资产/总负债/权益净资产行直填，明细未填全，父级不得被塌缩为子级部分和
    const subjects = [
      subject('BS01', 'data', null, false),
      subject('BS0101', 'data', 'BS01', true),
      subject('BS0102', 'data', 'BS01', true),
    ]
    const leafValues = new Map([
      ['BS01', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 603283.61 }],
      ['BS0101', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 52272.72 }],
      ['BS0102', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 64355.18 }],
    ])
    const directCodes = new Set(['BS01', 'BS0101', 'BS0102'])
    const tree = buildTree(subjects, leafValues, DIMS, directCodes)
    expect(tree[0].values.ACTUAL_MONTH).toBe(603283.61)
  })

  it('数据类父级无直填事实行时回退子级求和（缺省/不含于直填集合）', () => {
    const subjects = [
      subject('BS01', 'data', null, false),
      subject('BS0101', 'data', 'BS01', true),
      subject('BS0102', 'data', 'BS01', true),
    ]
    const leafValues = new Map([
      ['BS0101', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 100 }],
      ['BS0102', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 30 }],
    ])
    // 场景一：未传直填集合（缺省，经营/现金流树现状）
    expect(buildTree(subjects, leafValues, DIMS)[0].values.ACTUAL_MONTH).toBe(130)
    // 场景二：直填集合不含 BS01（父级行未导入）
    expect(buildTree(subjects, leafValues, DIMS, new Set(['BS0101', 'BS0102']))[0].values.ACTUAL_MONTH).toBe(130)
  })

  it('计算类父级即使有事实行也保持子级求和口径（计算类由公式层/求和重算）', () => {
    const subjects = [
      subject('BS0103', 'calc', 'BS01', false),
      subject('BS010301', 'data', 'BS0103', true),
      subject('BS010302', 'data', 'BS0103', true),
    ]
    const leafValues = new Map([
      ['BS0103', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 999 }],
      ['BS010301', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 10 }],
      ['BS010302', { BUDGET_AMOUNT: 0, ACTUAL_MONTH: 5 }],
    ])
    const directCodes = new Set(['BS0103', 'BS010301', 'BS010302'])
    const tree = buildTree(subjects, leafValues, DIMS, directCodes)
    expect(tree[0].values.ACTUAL_MONTH).toBe(15)
  })
})
