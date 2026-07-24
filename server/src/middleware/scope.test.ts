import { describe, it, expect, vi } from 'vitest'
import { buildScopeWhere, applyScopeWhere, resolveScope, type DataScope } from './scope'

describe('scope 数据范围', () => {
  describe('buildScopeWhere', () => {
    it('all → 不注入过滤（null）', () => {
      expect(buildScopeWhere({ type: 'all' })).toBeNull()
    })
    it('companies → companyCode in 列表', () => {
      expect(buildScopeWhere({ type: 'companies', companyCodes: ['CO330059'] })).toEqual({
        companyCode: { in: ['CO330059'] },
      })
    })
    it('none → 空集合（in []）', () => {
      expect(buildScopeWhere({ type: 'none' })).toEqual({ companyCode: { in: [] } })
    })
  })

  describe('applyScopeWhere', () => {
    it('作用于受范围约束的模型读操作', () => {
      const scope: DataScope = { type: 'companies', companyCodes: ['CO1'] }
      const where = applyScopeWhere('FactOperating', 'findMany', { period: '2025-06' }, scope)
      expect(where).toEqual({ AND: [{ period: '2025-06' }, { companyCode: { in: ['CO1'] } }] })
    })
    it('all 范围不改变 where', () => {
      const where = applyScopeWhere('FactOperating', 'findMany', { period: '2025-06' }, { type: 'all' })
      expect(where).toEqual({ period: '2025-06' })
    })
    it('非受约束模型不改变 where', () => {
      const scope: DataScope = { type: 'companies', companyCodes: ['CO1'] }
      const where = applyScopeWhere('Role', 'findMany', { code: 'admin' }, scope)
      expect(where).toEqual({ code: 'admin' })
    })
  })

  describe('resolveScope 三优先级', () => {
    const clientAll = { company: { findMany: vi.fn() } } as never

    it('优先级1：company_code 非空 → 精确公司', async () => {
      const scope = await resolveScope(clientAll, {
        companyCode: 'CO330059',
        orgScopeBu: ['BU_EAST'],
        scopeValue: '*',
      })
      expect(scope).toEqual({ type: 'companies', companyCodes: ['CO330059'] })
    })

    it('优先级2：company_code 空 + org_scope_bu → BU 映射公司集合', async () => {
      const findMany = vi.fn().mockResolvedValue([{ code: 'CO1' }, { code: 'CO2' }])
      const client = { company: { findMany } } as never
      const scope = await resolveScope(client, {
        companyCode: null,
        orgScopeBu: ['BU_EAST'],
        scopeValue: '',
      })
      expect(scope).toEqual({ type: 'companies', companyCodes: ['CO1', 'CO2'] })
      expect(findMany).toHaveBeenCalledWith({
        where: { businessUnit: { in: ['BU_EAST'] }, status: 'active' },
        select: { code: true },
      })
    })

    it('优先级3：均空 + scope_value=* → 全量', async () => {
      const scope = await resolveScope(clientAll, {
        companyCode: null,
        orgScopeBu: null,
        scopeValue: '*',
      })
      expect(scope).toEqual({ type: 'all' })
    })

    it('兜底：均空且非全量 → none（默认拒绝）', async () => {
      const scope = await resolveScope(clientAll, {
        companyCode: null,
        orgScopeBu: [],
        scopeValue: '',
      })
      expect(scope).toEqual({ type: 'none' })
    })
  })
})
