import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { CollectionService } from './CollectionService'

/**
 * 催收管理服务集成测试（真实 DB，无 DB 时整组跳过）。
 * 覆盖：状态机合法/非法流转、generateSuggestions 幂等性、催收记录。
 * 使用独立测试公司编码 EN999901 隔离数据，afterAll 清理。
 */

const TEST_COMPANY = 'EN999901'
const TEST_CP = '__TEST_CP_001__'
const TEST_ACCOUNT = '__TEST_1122__'
const ctx = { userId: '__test_collection_user__' }

let dbReady = false
let detailId = ''

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    // 造一条 AR 逾期明细：半年到1年 300 + 1年到2年 200 = 逾期 500（6m 起算）
    const detail = await basePrisma.transactionDetail.create({
      data: {
        companyCode: TEST_COMPANY,
        transactionType: '应收账款',
        direction: 'AR',
        counterpartyCode: TEST_CP,
        accountCode: TEST_ACCOUNT,
        closingBalance: 1000,
        aging6mTo1y: 300,
        aging1yTo2y: 200,
        isInternal: false,
        isEliminated: false,
        period: '2098-01',
      },
    })
    detailId = detail.id
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  const plans = await basePrisma.collectionPlan.findMany({ where: { companyCode: TEST_COMPANY }, select: { id: true } })
  await basePrisma.collectionLog.deleteMany({ where: { planId: { in: plans.map((p) => p.id) } } }).catch(() => undefined)
  await basePrisma.collectionPlan.deleteMany({ where: { companyCode: TEST_COMPANY } }).catch(() => undefined)
  if (detailId) await basePrisma.transactionDetail.delete({ where: { id: detailId } }).catch(() => undefined)
})

describe('CollectionService（真实 DB）', () => {
  it('generateSuggestions 按逾期账龄生成计划且幂等', async () => {
    if (!dbReady) return
    const first = await CollectionService.generateSuggestions({ companyCodes: [TEST_COMPANY], minAgingBucket: '6m' }, ctx)
    expect(first.created).toBe(1)
    expect(first.skipped).toBe(0)

    const page = await CollectionService.list({ companyCodes: [TEST_COMPANY] })
    expect(page.total).toBe(1)
    expect(page.items[0].overdueAmount).toBe(500)
    expect(page.items[0].status).toBe('pending')

    // 再次生成：同键存在非终态计划则跳过
    const second = await CollectionService.generateSuggestions({ companyCodes: [TEST_COMPANY], minAgingBucket: '6m' }, ctx)
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(1)
  })

  it('非法逾期起算账龄段报错', async () => {
    if (!dbReady) return
    await expect(CollectionService.generateSuggestions({ minAgingBucket: 'bad' }, ctx)).rejects.toThrow('不合法')
  })

  it('状态机：pending→collecting→partial→full 合法；跳跃/回退非法', async () => {
    if (!dbReady) return
    const page = await CollectionService.list({ companyCodes: [TEST_COMPANY] })
    const planId = page.items[0].id

    // pending → full 非法
    await expect(CollectionService.update(planId, { status: 'full' }, ctx)).rejects.toThrow('不可从')
    // pending → collecting 合法
    const s1 = await CollectionService.update(planId, { status: 'collecting' }, ctx)
    expect(s1.status).toBe('collecting')
    // collecting → pending 非法（无回退）
    await expect(CollectionService.update(planId, { status: 'pending' }, ctx)).rejects.toThrow('不可从')
    // collecting → partial 合法，同步录入实际回收金额
    const s2 = await CollectionService.update(planId, { status: 'partial', actualAmount: 200 }, ctx)
    expect(s2.status).toBe('partial')
    expect(s2.actualAmount).toBe(200)
    // partial → full 合法
    const s3 = await CollectionService.update(planId, { status: 'full', actualAmount: 500 }, ctx)
    expect(s3.status).toBe('full')
    // full 终态不可再流转
    await expect(CollectionService.update(planId, { status: 'bad_debt' }, ctx)).rejects.toThrow('不可从')
  })

  it('催收记录：新增与查询', async () => {
    if (!dbReady) return
    const page = await CollectionService.list({ companyCodes: [TEST_COMPANY] })
    const planId = page.items[0].id
    const log = await CollectionService.addLog(planId, { content: '电话联系对方财务，承诺月底回款' }, ctx)
    expect(log.content).toContain('电话联系')
    const logs = await CollectionService.listLogs(planId)
    expect(logs.length).toBe(1)
    expect(logs[0].actionBy).toBe(ctx.userId)
  })

  it('手工创建计划：参数校验', async () => {
    if (!dbReady) return
    await expect(CollectionService.create({ companyCode: '', counterpartyCode: TEST_CP, accountCode: TEST_ACCOUNT, overdueAmount: 1, plannedDate: '2098-01-01' }, ctx)).rejects.toThrow('必填')
    await expect(CollectionService.create({ companyCode: TEST_COMPANY, counterpartyCode: TEST_CP, accountCode: TEST_ACCOUNT, overdueAmount: -1, plannedDate: '2098-01-01' }, ctx)).rejects.toThrow('正数')
    const plan = await CollectionService.create({ companyCode: TEST_COMPANY, counterpartyCode: TEST_CP, accountCode: TEST_ACCOUNT, overdueAmount: 88.5, plannedDate: '2098-02-01', method: 'letter', remark: '手工计划' }, ctx)
    expect(plan.status).toBe('pending')
    expect(plan.method).toBe('letter')
    expect(plan.overdueAmount).toBe(88.5)
  })

  it('计划不存在时报 404', async () => {
    if (!dbReady) return
    await expect(CollectionService.update('00000000-0000-0000-0000-000000000000', { status: 'collecting' }, ctx)).rejects.toThrow('不存在')
    await expect(CollectionService.listLogs('00000000-0000-0000-0000-000000000000')).rejects.toThrow('不存在')
  })
})
