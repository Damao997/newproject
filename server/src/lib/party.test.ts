import { describe, it, expect } from 'vitest'
import { derivePartyType, PARTY_TYPE_LABEL } from './party'

/**
 * 关联方分类单测：internal（名称命中公司）/ related（6位数字码且非内部）/ external（其余）。
 */
describe('derivePartyType', () => {
  it('名称命中公司主数据 → internal（即使编码是6位数字）', () => {
    expect(derivePartyType(true, '330032')).toBe('internal')
    expect(derivePartyType(true, 'C00285097')).toBe('internal')
  })

  it('非内部且编码为6位纯数字 → related（关联方）', () => {
    expect(derivePartyType(false, '330050')).toBe('related')
    expect(derivePartyType(false, '100068')).toBe('related')
  })

  it('非内部且编码非6位纯数字 → external', () => {
    expect(derivePartyType(false, 'C00285097')).toBe('external')
    expect(derivePartyType(false, 'S00005993')).toBe('external')
    expect(derivePartyType(false, '33005')).toBe('external') // 5位
    expect(derivePartyType(false, '3300501')).toBe('external') // 7位
    expect(derivePartyType(false, '')).toBe('external')
    expect(derivePartyType(false, null)).toBe('external')
  })

  it('标签映射完整', () => {
    expect(PARTY_TYPE_LABEL.internal).toBe('内部公司')
    expect(PARTY_TYPE_LABEL.related).toBe('关联方')
    expect(PARTY_TYPE_LABEL.external).toBe('外部')
  })
})
