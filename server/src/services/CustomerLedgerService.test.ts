import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { CustomerLedgerService } from './CustomerLedgerService'

/**
 * 应收款客商台账集成测试（真实 DB，无 DB 时整组跳过）。
 * 覆盖：应收账款限定、余额>0 过滤、inactive 科目剔除、公司×客商聚合、
 * 计划关联（仅应收账款科目、取最新）、扩展表字段、状态过滤、stats。
 * 使用独立测试编码 EN999905 隔离，afterAll 清理。
 */

const CO = 'EN999905'
const CP_A = '__LEDGER_CP_A__'
const CP_B = '__LEDGER_CP_B__'
const ACC_AR = '__LEDGER_AR_01__'
const ACC_AR2 = '__LEDGER_AR_02__'
const ACC_OTHER = '__LEDGER_OT_01__'
const ACC_INACTIVE = '__LEDGER_IN_01__'
const ctx = { userId: '__test_ledger_user__' }

let dbReady = false

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    // 科目：应收账款 ×2、其他应收款 ×1、inactive 应收账款 ×1
    await basePrisma.transactionAccount.createMany({
      data: [
        { code: ACC_AR, name: '测试应收科目1', transactionType: '应收账款', direction: 'AR' },
        { code: ACC_AR2, name: '测试应收科目2', transactionType: '应收账款', direction: 'AR' },
        { code: ACC_OTHER, name: '测试其他应收科目', transactionType: '其他应收款', direction: 'AR' },
        { code: ACC_INACTIVE, name: '测试停用科目', transactionType: '应收账款', direction: 'AR', status: 'inactive' },
      ],
    })
    // 明细：CP_A 两个科目（合计 1500 + 账龄）、CP_B 一个科目（500）、其他应收款（应排除）、inactive 科目（应排除）、零余额（应排除）
    await basePrisma.transactionDetail.createMany({
      data: [
        { companyCode: CO, transactionType: '应收账款', direction: 'AR', counterpartyCode: CP_A, accountCode: ACC_AR, closingBalance: 1000, aging1m: 400, aging6mTo1y: 300, aging3yPlus: 300, isInternal: false, isEliminated: false, period: '2099-01' },
        { companyCode: CO, transactionType: '应收账款', direction: 'AR', counterpartyCode: CP_A, accountCode: ACC_AR2, closingBalance: 500, aging2m: 500, isInternal: false, isEliminated: false, period: '2099-01' },
        { companyCode: CO, transactionType: '应收账款', direction: 'AR', counterpartyCode: CP_B, accountCode: ACC_AR, closingBalance: 500, aging1m: 500, isInternal: false, isEliminated: false, period: '2099-01' },
        { companyCode: CO, transactionType: '其他应收款', direction: 'AR', counterpartyCode: CP_B, accountCode: ACC_OTHER, closingBalance: 9999, isInternal: false, isEliminated: false, period: '2099-01' },
        { companyCode: CO, transactionType: '应收账款', direction: 'AR', counterpartyCode: CP_B, accountCode: ACC_INACTIVE, closingBalance: 9999, isInternal: false, isEliminated: false, period: '2099-01' },
        { companyCode: CO, transactionType: '应收账款', direction: 'AR', counterpartyCode: CP_B, accountCode: ACC_AR, closingBalance: 0, isInternal: false, isEliminated: false, period: '2099-01' },
      ],
    })
    // 计划：CP_A 两个科目计划（旧 pending、新 collecting——取最新）、CP_B 其他应收款科目计划（应排除）
    // 注：collection_plan.method 为非空枚举且无默认值，必须显式提供
    await basePrisma.collectionPlan.createMany({
      data: [
        { companyCode: CO, counterpartyCode: CP_A, accountCode: ACC_AR, overdueAmount: 600, plannedDate: new Date('2099-02-01'), status: 'pending', method: 'phone', createdAt: new Date('2099-01-01') },
        { companyCode: CO, counterpartyCode: CP_A, accountCode: ACC_AR2, overdueAmount: 200, plannedDate: new Date('2099-02-02'), status: 'collecting', method: 'phone', createdAt: new Date('2099-01-02') },
        { companyCode: CO, counterpartyCode: CP_B, accountCode: ACC_OTHER, overdueAmount: 100, plannedDate: new Date('2099-02-03'), status: 'collecting', method: 'phone', createdAt: new Date('2099-01-03') },
      ],
    })
    // 业务员（供扩展表挂接测试）
    await basePrisma.salesman.create({ data: { companyCode: CO, name: '台账测试员' } })
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.customerExt.deleteMany({ where: { companyCode: CO } }).catch(() => undefined)
  await basePrisma.collectionPlan.deleteMany({ where: { companyCode: CO } }).catch(() => undefined)
  await basePrisma.transactionDetail.deleteMany({ where: { companyCode: CO } }).catch(() => undefined)
  await basePrisma.transactionAccount.deleteMany({ where: { code: { in: [ACC_AR, ACC_AR2, ACC_OTHER, ACC_INACTIVE] } } }).catch(() => undefined)
  await basePrisma.salesman.deleteMany({ where: { companyCode: CO } }).catch(() => undefined)
})

describe('CustomerLedgerService（真实 DB）', () => {
  it('台账聚合：仅应收账款、余额>0、剔除 inactive、公司×客商合并', async () => {
    if (!dbReady) return
    const page = await CustomerLedgerService.list({ companyCodes: [CO], pageSize: 50 })
    // 2 个客商（CP_A 合并两科目 1500；CP_B 500；其他类型/停用科目/零余额不计）
    expect(page.total).toBe(2)
    const a = page.items.find((r) => r.counterpartyCode === CP_A)!
    expect(a.closingBalance).toBe(1500)
    expect(a.aging['1个月']).toBe(400)
    expect(a.aging['2个月']).toBe(500)
    expect(a.aging['半年以上']).toBe(300)
    expect(a.aging['3年以上']).toBe(300)
    expect(a.overdueAmount).toBe(600) // 半年以上+1年至2年+2年至3年+3年以上 = 300+300
    const b = page.items.find((r) => r.counterpartyCode === CP_B)!
    expect(b.closingBalance).toBe(500)
  })

  it('计划关联：仅应收账款科目、取最新创建计划；无计划客商 planStatus 为 null', async () => {
    if (!dbReady) return
    const page = await CustomerLedgerService.list({ companyCodes: [CO], pageSize: 50 })
    const a = page.items.find((r) => r.counterpartyCode === CP_A)!
    // CP_A 最新计划 = ACC_AR2 的 collecting（createdAt 2099-01-02 晚于 2099-01-01）
    expect(a.planId).not.toBeNull()
    expect(a.planStatus).toBe('collecting')
    expect(a.plannedDate).toBe('2099-02-02')
    const b = page.items.find((r) => r.counterpartyCode === CP_B)!
    // CP_B 仅有其他应收款科目的计划，不关联 → 未计划
    expect(b.planId).toBeNull()
    expect(b.planStatus).toBeNull()
  })

  it('状态过滤：unplanned 与计划状态', async () => {
    if (!dbReady) return
    const unplanned = await CustomerLedgerService.list({ companyCodes: [CO], status: 'unplanned', pageSize: 50 })
    expect(unplanned.items.map((r) => r.counterpartyCode)).toEqual([CP_B])
    const collecting = await CustomerLedgerService.list({ companyCodes: [CO], status: 'collecting', pageSize: 50 })
    expect(collecting.items.map((r) => r.counterpartyCode)).toEqual([CP_A])
  })

  it('stats：未计划计数 + 计划状态计数 + 应收余额合计（不含状态过滤）', async () => {
    if (!dbReady) return
    const page = await CustomerLedgerService.list({ companyCodes: [CO], pageSize: 50 })
    expect(page.stats.byStatus.unplanned).toBe(1)
    expect(page.stats.byStatus.collecting).toBe(1)
    expect(page.stats.byStatus.pending).toBe(0)
    expect(page.stats.totalBalance).toBe(2000) // 1500 + 500
    // 带状态过滤时 stats 仍为全量口径
    const filtered = await CustomerLedgerService.list({ companyCodes: [CO], status: 'collecting', pageSize: 50 })
    expect(filtered.stats.byStatus.unplanned).toBe(1)
  })

  it('扩展表字段与客商关键词过滤', async () => {
    if (!dbReady) return
    // 注：CP_A 与 CP_B 共享前缀 '__LEDGER_C'，slice(0,10) 会同时命中两者；
    // 改用 slice(0,14)（'__LEDGER_CP_A'）确保仅命中 CP_A
    const kw = await CustomerLedgerService.list({ companyCodes: [CO], counterpartyKeyword: CP_A.slice(0, 14), pageSize: 50 })
    expect(kw.items.map((r) => r.counterpartyCode)).toEqual([CP_A])
    const none = await CustomerLedgerService.list({ companyCodes: [CO], counterpartyKeyword: '__NOT_EXIST__', pageSize: 50 })
    expect(none.total).toBe(0)
    // 扩展表 upsert 后可见
    await CustomerLedgerService.upsertCustomerExt(CO, CP_B, { billedUncollectedAmount: 88.5 }, ctx)
    const after = await CustomerLedgerService.list({ companyCodes: [CO], pageSize: 50 })
    const b = after.items.find((r) => r.counterpartyCode === CP_B)!
    expect(b.billedUncollectedAmount).toBe(88.5)
  })

  it('upsert 校验：金额负数、跨公司业务员、无字段', async () => {
    if (!dbReady) return
    await expect(CustomerLedgerService.upsertCustomerExt(CO, CP_A, { billedUncollectedAmount: -1 }, ctx)).rejects.toThrow('已开票未收款金额')
    await expect(CustomerLedgerService.upsertCustomerExt(CO, CP_A, { salesmanId: '00000000-0000-0000-0000-000000000000' }, ctx)).rejects.toThrow('业务员不存在')
    await expect(CustomerLedgerService.upsertCustomerExt(CO, CP_A, {}, ctx)).rejects.toThrow('无可更新字段')
  })
})
