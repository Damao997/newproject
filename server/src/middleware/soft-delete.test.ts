import { describe, it, expect } from 'vitest'
import { applyActiveWhere, hasStatusFilter } from './soft-delete'

describe('soft-delete 过滤', () => {
  it('对带 status 的模型的读操作注入 status=active', () => {
    const where = applyActiveWhere('User', 'findMany', { roleId: 'r1' })
    expect(where).toEqual({ roleId: 'r1', status: 'active' })
  })

  it('where 为空时也注入 status=active', () => {
    expect(applyActiveWhere('Company', 'findMany', undefined)).toEqual({ status: 'active' })
  })

  it('调用方已显式声明 status 时不覆盖', () => {
    const where = applyActiveWhere('User', 'findMany', { status: 'inactive' })
    expect(where).toEqual({ status: 'inactive' })
  })

  it('非 status 模型不注入', () => {
    const where = applyActiveWhere('FactOperating', 'findMany', { period: '2025-06' })
    expect(where).toEqual({ period: '2025-06' })
  })

  it('写操作不注入（如 create）', () => {
    const where = applyActiveWhere('User', 'create', undefined)
    expect(where).toBeUndefined()
  })

  it('组合条件中已含 status 视为接管', () => {
    expect(hasStatusFilter({ OR: [{ status: 'inactive' }, { id: '1' }] })).toBe(true)
  })
})
