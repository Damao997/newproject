import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 审计富化单测：targetId / detail 编码 → 业务名称。
 * 不触库：mock 各 prisma 模型的 findMany，断言解析结果与降级行为。
 */

const mocks = vi.hoisted(() => {
  const model = () => ({ findMany: vi.fn().mockResolvedValue([]) })
  return {
    prisma: {
      user: model(), role: model(), subjectAnalysis: model(), reportTemplate: model(), report: model(),
      importBatch: model(), salesman: model(), collectionPlan: model(), customerExt: model(),
      transactionAccount: model(), company: model(), accountSubject: model(), metric: model(),
      productCategory: model(), keyMetricsProduct: model(), expenseSubjectMapping: model(),
    },
  }
})

vi.mock('../lib/prisma', () => ({ prisma: mocks.prisma, basePrisma: mocks.prisma, prismaForUser: vi.fn() }))

import { resolveAuditLabels } from './audit-labels'

const ID = '11111111-1111-1111-1111-111111111111'
const ID2 = '22222222-2222-2222-2222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  Object.values(mocks.prisma).forEach((m) => m.findMany.mockResolvedValue([]))
})

describe('resolveAuditLabels', () => {
  it('auth.login 的 targetId 解析为操作用户姓名', async () => {
    mocks.prisma.user.findMany.mockResolvedValue([{ id: ID, displayName: '王芳' }])
    const { targetLabels } = await resolveAuditLabels([{ module: 'auth', action: 'login', targetId: ID, detail: null }])
    expect(targetLabels).toEqual(['王芳'])
  })

  it('权限变更的 targetId 解析为角色名', async () => {
    mocks.prisma.role.findMany.mockResolvedValue([{ id: ID, code: 'finance', name: '财务' }])
    const { targetLabels } = await resolveAuditLabels([
      { module: 'admin', action: 'permission_change', targetId: ID, detail: { action: 'batch' } },
    ])
    expect(targetLabels).toEqual(['财务'])
  })

  it('data 模块按 detail.entity 用编码查公司名', async () => {
    mocks.prisma.company.findMany.mockResolvedValue([{ code: 'C001', name: '深圳某某有限公司' }])
    const { targetLabels } = await resolveAuditLabels([
      { module: 'data', action: 'update', targetId: 'C001', detail: { entity: 'company' } },
    ])
    expect(targetLabels).toEqual(['深圳某某有限公司'])
  })

  it('导入批次 targetId 解析为文件名', async () => {
    mocks.prisma.importBatch.findMany.mockResolvedValue([{ id: ID, fileName: '2026年8月经营数据.xlsx' }])
    const { targetLabels } = await resolveAuditLabels([
      { module: 'data', action: 'import', targetId: ID, detail: { templateType: 'operating' } },
    ])
    expect(targetLabels).toEqual(['2026年8月经营数据.xlsx'])
  })

  it('往来未标注 action 时按候选顺序识别业务员', async () => {
    mocks.prisma.salesman.findMany.mockResolvedValue([{ id: ID, name: '李强' }])
    const { targetLabels } = await resolveAuditLabels([
      { module: 'transactions', action: 'update', targetId: ID, detail: {} },
    ])
    expect(targetLabels).toEqual(['李强'])
  })

  it('催收计划解析为「公司 · 客商」', async () => {
    mocks.prisma.collectionPlan.findMany.mockResolvedValue([{ id: ID, companyCode: 'C001', counterpartyCode: 'K900' }])
    mocks.prisma.company.findMany.mockResolvedValue([{ code: 'C001', name: '深圳某某有限公司' }])
    const { targetLabels } = await resolveAuditLabels([
      { module: 'transactions', action: 'update', targetId: ID, detail: { action: 'update-collection' } },
    ])
    expect(targetLabels).toEqual(['深圳某某有限公司 · K900'])
  })

  it('detail 中的公司/科目编码进入 codeLabels', async () => {
    mocks.prisma.company.findMany.mockResolvedValue([{ code: 'C001', name: '深圳某某有限公司' }])
    mocks.prisma.accountSubject.findMany.mockResolvedValue([{ code: 'PL0201', name: '营业收入' }])
    const { codeLabels } = await resolveAuditLabels([
      { module: 'data', action: 'reclassify', targetId: 'PL0201', detail: { kind: 'subject', companyCode: 'C001', fromParent: 'PL02', toParent: 'PL03' } },
    ])
    expect(codeLabels).toMatchObject({ C001: '深圳某某有限公司', PL0201: '营业收入' })
  })

  it('结构化 targetId「公司A->公司B」渲染为可读箭头', async () => {
    mocks.prisma.company.findMany.mockResolvedValue([
      { code: 'C001', name: '甲公司' },
      { code: 'C002', name: '乙公司' },
    ])
    const { targetLabels } = await resolveAuditLabels([
      { module: 'data', action: 'reclassification', targetId: 'C001->C002', detail: {} },
    ])
    expect(targetLabels).toEqual(['甲公司 → 乙公司'])
  })

  it('无法解析时返回 null（前端回退原始标识）', async () => {
    const { targetLabels } = await resolveAuditLabels([
      { module: 'admin', action: 'export', targetId: 'users', detail: null },
    ])
    expect(targetLabels).toEqual([null])
  })

  it('查询失败静默降级，不抛出', async () => {
    mocks.prisma.user.findMany.mockRejectedValue(new Error('db down'))
    await expect(
      resolveAuditLabels([{ module: 'auth', action: 'login', targetId: ID, detail: null }]),
    ).resolves.toEqual({ targetLabels: [null], codeLabels: {} })
  })
})
