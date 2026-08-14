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
  // 跨公司业务员（无外键关联，手工清理）
  await basePrisma.salesman.deleteMany({ where: { companyCode: 'EN999902', name: '李四' } }).catch(() => undefined)
  // 测试公司业务员（无外键关联，手工清理：按公司清理，覆盖张三及业务员管理用例自建数据）
  await basePrisma.salesman.deleteMany({ where: { companyCode: TEST_COMPANY } }).catch(() => undefined)
  // 测试客商主数据（无外键关联，手工清理）
  await basePrisma.counterparty.deleteMany({ where: { code: TEST_CP } }).catch(() => undefined)
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

  it('update 扩展字段：已开票未收款金额/状态说明/业务员（含校验）', async () => {
    if (!dbReady) return
    const page = await CollectionService.list({ companyCodes: [TEST_COMPANY] })
    const planId = page.items[0].id

    // 负数非法
    await expect(CollectionService.update(planId, { billedUncollectedAmount: -1 }, ctx)).rejects.toThrow('已开票未收款金额')
    // 状态说明超长非法
    await expect(CollectionService.update(planId, { statusNote: 'x'.repeat(501) }, ctx)).rejects.toThrow('500')
    // 业务员不存在非法
    await expect(CollectionService.update(planId, { salesmanId: '00000000-0000-0000-0000-000000000000' }, ctx)).rejects.toThrow('业务员不存在')

    // 合法写入
    const s1 = await CollectionService.update(planId, { billedUncollectedAmount: 300.5, statusNote: '客户承诺月底回款 300' }, ctx)
    expect(s1.billedUncollectedAmount).toBe(300.5)
    expect(s1.statusNote).toBe('客户承诺月底回款 300')

    // 业务员：先创建再挂接；其他公司业务员不可挂接
    const sm = await CollectionService.createSalesman({ companyCode: TEST_COMPANY, name: '张三', phone: '13800000000' }, ctx)
    const other = await CollectionService.createSalesman({ companyCode: 'EN999902', name: '李四' }, ctx)
    await expect(CollectionService.update(planId, { salesmanId: other.id }, ctx)).rejects.toThrow('不属于该公司')
    const s2 = await CollectionService.update(planId, { salesmanId: sm.id }, ctx)
    expect(s2.salesmanId).toBe(sm.id)
    expect(s2.salesmanName).toBe('张三')

    // 清空业务员
    const s3 = await CollectionService.update(planId, { salesmanId: null }, ctx)
    expect(s3.salesmanId).toBeNull()
  })

  it('list 返回状态统计 stats（按状态计数 + 逾期金额合计）', async () => {
    if (!dbReady) return
    const page = await CollectionService.list({ companyCodes: [TEST_COMPANY] })
    expect(page.stats).toBeDefined()
    expect(typeof page.stats.byStatus.pending).toBe('number')
    expect(page.stats.byStatus.pending).toBeGreaterThanOrEqual(1)
    expect(page.stats.totalOverdue).toBeGreaterThan(0)
  })

  it('计划不存在时报 404', async () => {
    if (!dbReady) return
    await expect(CollectionService.update('00000000-0000-0000-0000-000000000000', { status: 'collecting' }, ctx)).rejects.toThrow('不存在')
    await expect(CollectionService.listLogs('00000000-0000-0000-0000-000000000000')).rejects.toThrow('不存在')
  })

  it('业务员与客商选项接口', async () => {
    if (!dbReady) return
    // 测试客商主数据：beforeAll 未创建，本用例内创建（afterAll 清理）
    await basePrisma.counterparty.create({
      data: { code: TEST_CP, name: '测试客商', companyCode: TEST_COMPANY },
    })
    // 关键词过滤客商
    const cps = await CollectionService.listCounterparties({ companyCodes: [TEST_COMPANY], keyword: TEST_CP.slice(0, 8) })
    expect(cps.length).toBeGreaterThanOrEqual(1)
    expect(cps.some((c) => c.code === TEST_CP)).toBe(true)
    // 关键词无匹配返回空
    const none = await CollectionService.listCounterparties({ companyCodes: [TEST_COMPANY], keyword: '__NOT_EXIST_CP__' })
    expect(none.length).toBe(0)
    // 业务员列表按公司过滤
    const sms = await CollectionService.listSalesmen({ companyCodes: [TEST_COMPANY] })
    expect(sms.some((s) => s.name === '张三')).toBe(true)
    // 创建校验：姓名必填
    await expect(CollectionService.createSalesman({ companyCode: TEST_COMPANY, name: '  ' }, ctx)).rejects.toThrow('必填')
  })

  it('业务员管理：管理列表分页/关键词/状态筛选、编辑、停用', async () => {
    if (!dbReady) return
    // 自建两个业务员：A（active）、B（active 后停用）
    const a = await CollectionService.createSalesman({ companyCode: TEST_COMPANY, name: '管理甲', phone: '13900000001' }, ctx)
    const b = await CollectionService.createSalesman({ companyCode: TEST_COMPANY, name: '管理乙', phone: '13900000002' }, ctx)

    // 管理列表：全部
    const all = await CollectionService.listSalesmenManage({ companyCodes: [TEST_COMPANY], pageSize: 50 })
    expect(all.items.some((s) => s.id === a.id)).toBe(true)
    // 关键词（姓名）
    const kw = await CollectionService.listSalesmenManage({ companyCodes: [TEST_COMPANY], keyword: '管理甲', pageSize: 50 })
    expect(kw.items.map((s) => s.id)).toEqual([a.id])
    // 关键词（电话）
    const kwPhone = await CollectionService.listSalesmenManage({ companyCodes: [TEST_COMPANY], keyword: '13900000002', pageSize: 50 })
    expect(kwPhone.items.map((s) => s.id)).toEqual([b.id])
    // 状态筛选
    const activeOnly = await CollectionService.listSalesmenManage({ companyCodes: [TEST_COMPANY], status: 'active', pageSize: 50 })
    expect(activeOnly.items.some((s) => s.id === b.id)).toBe(true)

    // 编辑：姓名/电话修改；公司不可改
    const edited = await CollectionService.updateSalesman(a.id, { name: '管理甲改', phone: '13900000009' }, ctx)
    expect(edited.name).toBe('管理甲改')
    expect(edited.phone).toBe('13900000009')
    await expect(CollectionService.updateSalesman(a.id, { name: 'x', companyCode: 'EN999902' } as never, ctx)).rejects.toThrow('公司不可修改')

    // 停用：选项接口不再返回，管理列表状态为 inactive
    const deactivated = await CollectionService.setSalesmanStatus(b.id, 'inactive', ctx)
    expect(deactivated.status).toBe('inactive')
    const options = await CollectionService.listSalesmen({ companyCodes: [TEST_COMPANY] })
    expect(options.some((s) => s.id === b.id)).toBe(false)
    const manageInactive = await CollectionService.listSalesmenManage({ companyCodes: [TEST_COMPANY], status: 'inactive', pageSize: 50 })
    expect(manageInactive.items.some((s) => s.id === b.id)).toBe(true)

    // 非法状态
    await expect(CollectionService.setSalesmanStatus(a.id, 'bogus' as never, ctx)).rejects.toThrow('状态不合法')
  })
})
