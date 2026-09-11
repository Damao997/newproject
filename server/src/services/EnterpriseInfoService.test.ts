import { describe, it, expect, vi, beforeEach } from 'vitest'

// 通过 vi.hoisted 构造可变 mock，供 vi.mock 工厂与用例共享
const mocks = vi.hoisted(() => ({
  prisma: {
    enterpriseInfo: { findFirst: vi.fn(), upsert: vi.fn() },
    enterpriseQueryLog: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
  providerSearch: vi.fn(),
}))

vi.mock('../lib/prisma', () => ({
  prisma: mocks.prisma,
  basePrisma: mocks.prisma,
  prismaForUser: vi.fn(),
}))

vi.mock('./enterprise-providers', () => ({
  getProvider: () => ({ name: 'mock', search: mocks.providerSearch }),
}))

import { EnterpriseInfoService } from './EnterpriseInfoService'

const CTX = { userId: 'u1', traceId: 't1' }

function cacheRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    creditCode: '91330106MA2CE7XW08',
    name: '杭州云帆网络科技有限公司',
    legalPerson: '陈建国',
    registeredCapital: '1000万元人民币',
    establishDate: '2016-03-18',
    status: '在业',
    companyType: '有限责任公司',
    industry: '软件和信息技术服务业',
    registeredAddress: '杭州市西湖区文三路 258 号',
    businessScope: '技术开发、技术服务',
    raw: null,
    provider: 'mock',
    fetchedAt: new Date('2026-07-20T00:00:00Z'),
    expiresAt: new Date('2026-07-27T00:00:00Z'),
    ...overrides,
  }
}

function providerInfo(overrides: Record<string, unknown> = {}) {
  return {
    name: '杭州云帆网络科技有限公司',
    creditCode: '91330106MA2CE7XW08',
    legalPerson: '陈建国',
    registeredCapital: '1000万元人民币',
    establishDate: '2016-03-18',
    status: '在业',
    companyType: '有限责任公司',
    industry: '软件和信息技术服务业',
    registeredAddress: '杭州市西湖区文三路 258 号',
    businessScope: '技术开发、技术服务',
    raw: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.enterpriseQueryLog.create.mockResolvedValue({})
})

describe('EnterpriseInfoService.search', () => {
  it('空 keyword → 400', async () => {
    await expect(EnterpriseInfoService.search('   ', CTX.userId, CTX.traceId)).rejects.toMatchObject({ code: 400 })
    expect(mocks.providerSearch).not.toHaveBeenCalled()
  })

  it('缓存命中 → 不调 provider，fromCache=true，写日志', async () => {
    mocks.prisma.enterpriseInfo.findFirst.mockResolvedValue(cacheRow())

    const result = await EnterpriseInfoService.search('杭州云帆网络科技有限公司', CTX.userId, CTX.traceId)

    expect(result?.fromCache).toBe(true)
    expect(result?.name).toBe('杭州云帆网络科技有限公司')
    expect(mocks.providerSearch).not.toHaveBeenCalled()
    expect(mocks.prisma.enterpriseQueryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', fromCache: true, matchedName: '杭州云帆网络科技有限公司' }),
    })
  })

  it('缓存未命中 → 调 provider 并 upsert 缓存（expiresAt = 7 天后）', async () => {
    mocks.prisma.enterpriseInfo.findFirst.mockResolvedValue(null)
    mocks.providerSearch.mockResolvedValue(providerInfo())
    mocks.prisma.enterpriseInfo.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve(cacheRow({ ...create, id: 'e-new' })))

    const before = Date.now()
    const result = await EnterpriseInfoService.search('91330106MA2CE7XW08', CTX.userId, CTX.traceId)

    expect(result?.fromCache).toBe(false)
    expect(mocks.providerSearch).toHaveBeenCalledWith('91330106MA2CE7XW08')
    const upsertArgs = mocks.prisma.enterpriseInfo.upsert.mock.calls[0][0]
    expect(upsertArgs.where).toEqual({ creditCode: '91330106MA2CE7XW08' })
    const expiresAt = (upsertArgs.create.expiresAt as Date).getTime()
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    expect(expiresAt - before).toBeGreaterThanOrEqual(sevenDays - 1000)
    expect(expiresAt - before).toBeLessThanOrEqual(sevenDays + 60_000)
    expect(mocks.prisma.enterpriseQueryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromCache: false }),
    })
  })

  it('provider 未命中 → 返回 null 且写日志（matchedName=null）', async () => {
    mocks.prisma.enterpriseInfo.findFirst.mockResolvedValue(null)
    mocks.providerSearch.mockResolvedValue(null)

    const result = await EnterpriseInfoService.search('不存在的企业', CTX.userId, CTX.traceId)

    expect(result).toBeNull()
    expect(mocks.prisma.enterpriseInfo.upsert).not.toHaveBeenCalled()
    expect(mocks.prisma.enterpriseQueryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matchedName: null, fromCache: false }),
    })
  })

  it('结果不回传原始报文 raw', async () => {
    mocks.prisma.enterpriseInfo.findFirst.mockResolvedValue(cacheRow({ raw: { secret: true } }))

    const result = await EnterpriseInfoService.search('杭州云帆网络科技有限公司', CTX.userId, CTX.traceId)

    expect(result?.raw).toBeNull()
  })
})

describe('EnterpriseInfoService.listHistory', () => {
  it('仅查本人记录并倒序分页', async () => {
    mocks.prisma.enterpriseQueryLog.findMany.mockResolvedValue([
      { id: 'l1', keyword: '云帆', matchedName: '杭州云帆网络科技有限公司', fromCache: true, createdAt: new Date('2026-07-25T01:00:00Z') },
    ])
    mocks.prisma.enterpriseQueryLog.count.mockResolvedValue(1)

    const data = await EnterpriseInfoService.listHistory('u1', { page: 2, pageSize: 10 })

    expect(mocks.prisma.enterpriseQueryLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    }))
    expect(data.total).toBe(1)
    expect(data.items[0]).toMatchObject({ id: 'l1', keyword: '云帆', fromCache: true })
  })
})
