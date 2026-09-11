import { describe, expect, it } from 'vitest'
import { buildDetailSummary } from '../shared'

describe('buildDetailSummary', () => {
  it('无任何生效条件时返回空数组', () => {
    expect(buildDetailSummary([], [], '', false)).toEqual([])
  })

  it('单条件：科目数量', () => {
    expect(buildDetailSummary(['OP_001'], [], '', false)).toEqual(['1 个科目'])
  })

  it('多条件按固定顺序拼接', () => {
    expect(buildDetailSummary(['OP_001', 'OP_002'], ['related'], ' 某公司 ', true)).toEqual([
      '2 个科目',
      '已选对象类型',
      '有关键词',
      '仅显示小计',
    ])
  })

  it('关键词纯空白视为未生效', () => {
    expect(buildDetailSummary([], [], '   ', false)).toEqual([])
  })
})
