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

  describe('resolveScope 两优先级', () => {
    const clientAll = { company: { findMany: vi.fn() } } as never

    it('优先级1：company_code 非空 → 精确公司', async () => {
      const scope = await resolveScope(clientAll, {
        companyCode: 'CO330059',
        scopeValue: '*',
      })
      expect(scope).toEqual({ type: 'companies', companyCodes: ['CO330059'] })
    })

    it('优先级2：company_code 空 + scope_value=* → 全量', async () => {
      const scope = await resolveScope(clientAll, {
        companyCode: null,
        scopeValue: '*',
      })
      expect(scope).toEqual({ type: 'all' })
    })

    it('兜底：company_code 空且非全量 → none（默认拒绝）', async () => {
      const scope = await resolveScope(clientAll, {
        companyCode: null,
        scopeValue: '',
      })
      expect(scope).toEqual({ type: 'none' })
    })
  })

  describe('resolveScope 多选数据范围（dataScopeCodes）', () => {
    function makeClient(companies: { code: string; entityType: string }[], maps: { singleCompanyCode: string }[]) {
      return {
        company: { findMany: vi.fn().mockResolvedValue(companies) },
        companyAggregationMap: { findMany: vi.fn().mockResolvedValue(maps) },
      } as never
    }

    it('仅单体编码 → 直接采用，不查汇总映射', async () => {
      const client = makeClient([{ code: 'EN000001', entityType: 'single' }], [])
      const scope = await resolveScope(client, {
        companyCode: null,
        scopeValue: '',
        dataScopeCodes: ['EN000001'],
      })
      expect(scope).toEqual({ type: 'companies', companyCodes: ['EN000001'] })
    })

    it('含汇总主体 → 展开为下属单体并保留自身编码，去重', async () => {
      const client = makeClient(
        [{ code: 'EN000001', entityType: 'single' }, { code: 'ET0001', entityType: 'summary' }],
        [{ singleCompanyCode: 'EN000001' }, { singleCompanyCode: 'EN000002' }],
      )
      const scope = await resolveScope(client, {
        companyCode: null,
        scopeValue: '',
        dataScopeCodes: ['EN000001', 'ET0001'],
      })
      expect(scope.type).toBe('companies')
      const codes = (scope as { companyCodes: string[] }).companyCodes
      expect([...codes].sort()).toEqual(['EN000001', 'EN000002', 'ET0001'])
    })

    it('编码均已失效 → none（默认拒绝），不回退角色全量', async () => {
      const client = makeClient([], [])
      const scope = await resolveScope(client, {
        companyCode: null,
        scopeValue: '*',
        dataScopeCodes: ['EN_GONE'],
      })
      expect(scope).toEqual({ type: 'none' })
    })

    it('空数组 → 回退既有优先级（角色全量）', async () => {
      const client = makeClient([], [])
      const scope = await resolveScope(client, {
        companyCode: null,
        scopeValue: '*',
        dataScopeCodes: [],
      })
      expect(scope).toEqual({ type: 'all' })
    })

    it('多选范围优先于 companyCode 单值', async () => {
      const client = makeClient([{ code: 'EN000002', entityType: 'single' }], [])
      const scope = await resolveScope(client, {
        companyCode: 'EN000001',
        scopeValue: '',
        dataScopeCodes: ['EN000002'],
      })
      expect(scope).toEqual({ type: 'companies', companyCodes: ['EN000002'] })
    })
  })
})
