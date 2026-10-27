import { describe, it, expect } from 'vitest'
import { allColCodes, colDimOptions, colDimTriggerLabel, nextColCodes } from '@/lib/analysis-col-members'
import { ANALYSIS_ROW_DIMS } from '@/types'

/**
 * 列维度纯逻辑测试（矩阵模式，v2）。约束与后端 analysisQuerySchema 对齐：
 * - colCodes 空数组 = 全部成员（缺省语义），不是「一个都不选」
 * - 首次交互从全选态补齐显式全集，避免空数组歧义
 * - 列维度候选剔除行维度（后端拒绝行列同维）
 */

const ALL = ['C001', 'C002', 'C003']

describe('nextColCodes', () => {
  it('全选态（空数组）首次取消：先补齐全集再剔除该项', () => {
    expect(nextColCodes([], ALL, 'C002', false)).toEqual(['C001', 'C003'])
  })

  it('全选态首次勾选：补齐全集并集（结果仍是全集）', () => {
    expect(nextColCodes([], ALL, 'C002', true)).toEqual(['C001', 'C002', 'C003'])
  })

  it('显式子集上新增：并集去重', () => {
    expect(nextColCodes(['C001'], ALL, 'C003', true)).toEqual(['C001', 'C003'])
  })

  it('显式子集上取消已选项', () => {
    expect(nextColCodes(['C001', 'C002'], ALL, 'C001', false)).toEqual(['C002'])
  })

  it('不修改入参数组', () => {
    const current = ['C001']
    nextColCodes(current, ALL, 'C002', true)
    expect(current).toEqual(['C001'])
  })
})

describe('allColCodes', () => {
  it('on = 显式全集', () => {
    expect(allColCodes(ALL, true)).toEqual(ALL)
  })

  it('off = 空数组（回退全部成员缺省态）', () => {
    expect(allColCodes(ALL, false)).toEqual([])
  })
})

describe('colDimTriggerLabel', () => {
  it('空数组 = 全部成员', () => {
    expect(colDimTriggerLabel('主体', [], 6)).toBe('主体 · 全部 6 成员')
  })

  it('显式子集 = 已选 N/总数', () => {
    expect(colDimTriggerLabel('品类', ['A', 'B'], 10)).toBe('品类 · 已选 2/10')
  })
})

describe('colDimOptions', () => {
  it('剔除行维度，其余保留', () => {
    const options = colDimOptions(ANALYSIS_ROW_DIMS, 'category')
    expect(options.map((o) => o.value)).toEqual(['product', 'expense', 'subject', 'company'])
  })

  it('每个候选都与行维度不同（后端 schema 拒绝行列同维）', () => {
    for (const rowDim of ANALYSIS_ROW_DIMS) {
      for (const opt of colDimOptions(ANALYSIS_ROW_DIMS, rowDim.value)) {
        expect(opt.value).not.toBe(rowDim.value)
      }
    }
  })
})
