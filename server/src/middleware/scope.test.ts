import { describe, it, expect, vi } from 'vitest'
import { buildScopeWhere, applyScopeWhere, resolveScope, type DataScope } from './scope'

/**
 * 构造 resolveScope 所需的最小 Prisma 替身：按 where 形态分派，
 * 以覆盖「取指定编码」「取全部汇总主体」「按事业部取单体」三类查询。
 */
function makeClient(
  companies: { code: string; entityType: string }[],
  maps: { summaryCompanyCode: string; singleCompanyCode: string }[] = [],
) {
  return {
    company: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn(async ({ where }: any) => {
        if (where?.entityType === 'summary') {
          return companies.filter((c) => c.entityType === 'summary').map((c) => ({ code: c.code }))
        }
        if (where?.businessUnit) {
          return companies.filter((c) => c.entityType === 'single').map((c) => ({ code: c.code }))
        }
        const codes: string[] = where?.code?.in ?? []
        return companies.filter((c) => codes.includes(c.code)).map((c) => ({ code: c.code, entityType: c.entityType }))
      }),
    },
    companyAggregationMap: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: vi.fn(async ({ where }: any) => {
        const sums: string[] = where?.summaryCompanyCode?.in ?? []
        return maps.filter((m) => sums.includes(m.summaryCompanyCode))
      }),
    },
  } as never
}

describe('scope 数据范围', () => {
  describe('buildScopeWhere', () => {
    it('all → 不注入过滤（null）', () => {
      expect(buildScopeWhere({ type: 'all' })).toBeNull()
    })
    it('companies → companyCode in 列表（只用单体编码）', () => {
      expect(buildScopeWhere({ type: 'companies', companyCodes: ['CO330059'], summaryCodes: ['ET0001'] })).toEqual({
        companyCode: { in: ['CO330059'] },
      })
    })
    it('none → 空集合（in []）', () => {
      expect(buildScopeWhere({ type: 'none' })).toEqual({ companyCode: { in: [] } })
    })
  })

  describe('applyScopeWhere', () => {
    it('作用于受范围约束的模型读操作', () => {
      const scope: DataScope = { type: 'companies', companyCodes: ['CO1'], summaryCodes: [] }
      const where = applyScopeWhere('FactOperating', 'findMany', { period: '2025-06' }, scope)
      expect(where).toEqual({ AND: [{ period: '2025-06' }, { companyCode: { in: ['CO1'] } }] })
    })
    it('all 范围不改变 where', () => {
      const where = applyScopeWhere('FactOperating', 'findMany', { period: '2025-06' }, { type: 'all' })
      expect(where).toEqual({ period: '2025-06' })
    })
    it('非受约束模型不改变 where', () => {
      const scope: DataScope = { type: 'companies', companyCodes: ['CO1'], summaryCodes: [] }
      const where = applyScopeWhere('Role', 'findMany', { code: 'admin' }, scope)
      expect(where).toEqual({ code: 'admin' })
    })
    it('SubjectAnalysis 纳入范围约束', () => {
      const scope: DataScope = { type: 'companies', companyCodes: ['CO1'], summaryCodes: [] }
      const where = applyScopeWhere('SubjectAnalysis', 'findMany', undefined, scope)
      expect(where).toEqual({ AND: [{}, { companyCode: { in: ['CO1'] } }] })
    })
    it('updateMany/deleteMany 同样注入（防越权批量改删）', () => {
      const scope: DataScope = { type: 'companies', companyCodes: ['CO1'], summaryCodes: [] }
      for (const op of ['updateMany', 'deleteMany']) {
        expect(applyScopeWhere('TransactionDetail', op, { period: '2025-06' }, scope)).toEqual({
          AND: [{ period: '2025-06' }, { companyCode: { in: ['CO1'] } }],
        })
      }
    })
    it('update/delete 不注入（唯一 where 入参不可污染）', () => {
      const scope: DataScope = { type: 'companies', companyCodes: ['CO1'], summaryCodes: [] }
      expect(applyScopeWhere('TransactionDetail', 'update', { id: 'x' }, scope)).toEqual({ id: 'x' })
      expect(applyScopeWhere('TransactionDetail', 'delete', { id: 'x' }, scope)).toEqual({ id: 'x' })
    })
  })

  describe('resolveScope 优先级', () => {
    it('优先级1：company_code 非空 → 精确公司', async () => {
      const client = makeClient([{ code: 'CO330059', entityType: 'single' }])
      const scope = await resolveScope(client, { companyCode: 'CO330059', scopeValue: '*' })
      expect(scope).toEqual({ type: 'companies', companyCodes: ['CO330059'], summaryCodes: [] })
    })

    it('优先级2：company_code 空 + scope_value=* → 全量', async () => {
      const client = makeClient([])
      const scope = await resolveScope(client, { companyCode: null, scopeValue: '*' })
      expect(scope).toEqual({ type: 'all' })
    })

    it('兜底：company_code 空且非全量 → none（默认拒绝）', async () => {
      const client = makeClient([])
      const scope = await resolveScope(client, { companyCode: null, scopeValue: '' })
      expect(scope).toEqual({ type: 'none' })
    })
  })

  describe('resolveScope 多选数据范围（dataScopeCodes）', () => {
    it('仅单体编码 → 直接采用', async () => {
      const client = makeClient([{ code: 'EN000001', entityType: 'single' }])
      const scope = await resolveScope(client, {
        companyCode: null,
        scopeValue: '',
        dataScopeCodes: ['EN000001'],
      })
      expect(scope).toEqual({ type: 'companies', companyCodes: ['EN000001'], summaryCodes: [] })
    })

    it('含汇总主体 → 展开为下属单体，汇总编码不进 companyCodes（防重复计算）', async () => {
      const client = makeClient(
        [
          { code: 'EN000001', entityType: 'single' },
          { code: 'EN000002', entityType: 'single' },
          { code: 'ET0001', entityType: 'summary' },
        ],
        [
          { summaryCompanyCode: 'ET0001', singleCompanyCode: 'EN000001' },
          { summaryCompanyCode: 'ET0001', singleCompanyCode: 'EN000002' },
        ],
      )
      const scope = await resolveScope(client, {
        companyCode: null,
        scopeValue: '',
        dataScopeCodes: ['ET0001'],
      })
      expect(scope.type).toBe('companies')
      const s = scope as { companyCodes: string[]; summaryCodes: string[] }
      expect([...s.companyCodes].sort()).toEqual(['EN000001', 'EN000002'])
      expect(s.summaryCodes).toEqual(['ET0001'])
    })

    it('编码均已失效 → none（默认拒绝），不回退角色全量', async () => {
      const client = makeClient([])
      const scope = await resolveScope(client, {
        companyCode: null,
        scopeValue: '*',
        dataScopeCodes: ['EN_GONE'],
      })
      expect(scope).toEqual({ type: 'none' })
    })

    it('空数组 → 回退既有优先级（角色全量）', async () => {
      const client = makeClient([])
      const scope = await resolveScope(client, {
        companyCode: null,
        scopeValue: '*',
        dataScopeCodes: [],
      })
      expect(scope).toEqual({ type: 'all' })
    })

    it('多选范围优先于 companyCode 单值', async () => {
      const client = makeClient([{ code: 'EN000002', entityType: 'single' }])
      const scope = await resolveScope(client, {
        companyCode: 'EN000001',
        scopeValue: '',
        dataScopeCodes: ['EN000002'],
      })
      expect(scope).toEqual({ type: 'companies', companyCodes: ['EN000002'], summaryCodes: [] })
    })
  })

  describe('resolveScope 汇总主体「全有或全无」授权', () => {
    const companies = [
      { code: 'EN01', entityType: 'single' },
      { code: 'EN02', entityType: 'single' },
      { code: 'EN03', entityType: 'single' },
      { code: 'ET_FULL', entityType: 'summary' },
      { code: 'ET_EMPTY', entityType: 'summary' },
    ]
    const maps = [
      { summaryCompanyCode: 'ET_FULL', singleCompanyCode: 'EN01' },
      { summaryCompanyCode: 'ET_FULL', singleCompanyCode: 'EN02' },
    ]

    it('成员被完整分配 → 汇总主体自动授权（与直接分配等价）', async () => {
      const scope = await resolveScope(makeClient(companies, maps), {
        companyCode: null,
        scopeValue: '',
        dataScopeCodes: ['EN01', 'EN02'],
      })
      expect((scope as { summaryCodes: string[] }).summaryCodes).toEqual(['ET_FULL'])
    })

    it('成员仅部分被分配 → 汇总主体不授权（口径不得失真）', async () => {
      const scope = await resolveScope(makeClient(companies, maps), {
        companyCode: null,
        scopeValue: '',
        dataScopeCodes: ['EN01'],
      })
      expect(scope).toEqual({ type: 'companies', companyCodes: ['EN01'], summaryCodes: [] })
    })

    it('成员集为空的汇总主体 → 不授权', async () => {
      const scope = await resolveScope(makeClient(companies, maps), {
        companyCode: null,
        scopeValue: '',
        dataScopeCodes: ['EN01', 'EN02', 'EN03'],
      })
      expect((scope as { summaryCodes: string[] }).summaryCodes).not.toContain('ET_EMPTY')
    })

    it('companyCode 单值绑定也参与汇总主体授权判定', async () => {
      const single = [
        { code: 'EN01', entityType: 'single' },
        { code: 'ET_ONE', entityType: 'summary' },
      ]
      const scope = await resolveScope(
        makeClient(single, [{ summaryCompanyCode: 'ET_ONE', singleCompanyCode: 'EN01' }]),
        { companyCode: 'EN01', scopeValue: '' },
      )
      expect(scope).toEqual({ type: 'companies', companyCodes: ['EN01'], summaryCodes: ['ET_ONE'] })
    })
  })
})
