import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { TransactionService } from './TransactionService'

/**
 * 第一阶段集成测试（真实 DB，无 DB 时整组跳过）：
 *  - Req3 关联方过滤：listDetails/getAgingAnalysis 的 partyType 三态过滤；
 *  - Req5 科目排除：inactive 科目在明细/账龄中被自动剔除，且不出现在筛选选项；
 *  - Req4 明细合计：totals.closingBalance = 全筛选集（跨页）期末余额之和。
 * 用独立公司 EN999910、往来类型 __TEST_P1__、科目 9100xxx 隔离，afterAll 清理。
 */

const CO = 'EN999910'
const TYPE = '__TEST_P1__'
const ACC_ACTIVE = '910000000001'
const ACC_INACTIVE = '910000000002'
const PERIOD = '2099-11'

let dbReady = false
const detailIds: string[] = []

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    await basePrisma.transactionAccount.createMany({
      data: [
        { code: ACC_ACTIVE, name: '测试P1-纳入', transactionType: TYPE, direction: 'AR', status: 'active', orderNo: 1 },
        { code: ACC_INACTIVE, name: '测试P1-排除', transactionType: TYPE, direction: 'AR', status: 'inactive', orderNo: 2 },
      ],
      skipDuplicates: true,
    })
    // 确保状态正确（若旧数据已存在）
    await basePrisma.transactionAccount.update({ where: { code: ACC_ACTIVE }, data: { status: 'active' } })
    await basePrisma.transactionAccount.update({ where: { code: ACC_INACTIVE }, data: { status: 'inactive' } })

    const mk = async (accountCode: string, counterpartyCode: string, partyType: string, closing: number) => {
      const row = await basePrisma.transactionDetail.create({
        data: {
          companyCode: CO, transactionType: TYPE, direction: 'AR', period: PERIOD,
          counterpartyCode, accountCode, accountDesc: `P1-${accountCode}`,
          closingBalance: closing, partyType,
        },
      })
      detailIds.push(row.id)
    }
    await mk(ACC_ACTIVE, '330099', 'related', 100) // 关联方
    await mk(ACC_ACTIVE, 'C0001', 'external', 200) // 外部
    await mk(ACC_ACTIVE, '330088', 'internal', 300) // 内部公司
    await mk(ACC_INACTIVE, 'C0002', 'external', 999) // 排除科目（应被剔除）
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.transactionDetail.deleteMany({ where: { id: { in: detailIds } } }).catch(() => undefined)
  await basePrisma.transactionAccount.deleteMany({ where: { code: { in: [ACC_ACTIVE, ACC_INACTIVE] } } }).catch(() => undefined)
})

describe('Req3 关联方过滤（真实 DB）', () => {
  it('listDetails 按 partyType 过滤，且合计随筛选变化', async () => {
    if (!dbReady) return
    const related = await TransactionService.listDetails({ companyCodes: [CO], transactionType: TYPE, partyType: 'related' })
    expect(related.items).toHaveLength(1)
    expect(related.items[0].counterpartyCode).toBe('330099')
    expect(related.totals?.closingBalance).toBe(100)

    const internal = await TransactionService.listDetails({ companyCodes: [CO], transactionType: TYPE, partyType: 'internal' })
    expect(internal.items).toHaveLength(1)
    expect(internal.totals?.closingBalance).toBe(300)
  })

  it('getAgingAnalysis 按 partyType 过滤', async () => {
    if (!dbReady) return
    const rows = await TransactionService.getAgingAnalysis({ companyCodes: [CO], transactionType: TYPE, period: PERIOD, partyType: 'external', groupBy: 'counterparty' }) as Array<{ counterpartyCode: string; closingBalance: number }>
    // external 仅剩 C0001(200)；C0002(999) 因科目排除被剔除
    expect(rows).toHaveLength(1)
    expect(rows[0].counterpartyCode).toBe('C0001')
    expect(rows[0].closingBalance).toBe(200)
  })
})

describe('Req5 科目排除（真实 DB）', () => {
  it('inactive 科目在明细中被自动剔除，合计不含其金额', async () => {
    if (!dbReady) return
    const all = await TransactionService.listDetails({ companyCodes: [CO], transactionType: TYPE })
    // A/B/C 三条（100+200+300），排除科目的 999 不在内
    expect(all.items).toHaveLength(3)
    expect(all.items.every((i) => i.accountCode !== ACC_INACTIVE)).toBe(true)
    expect(all.totals?.closingBalance).toBe(600)
  })

  it('筛选选项 listAccounts 不含 inactive 科目', async () => {
    if (!dbReady) return
    const options = await TransactionService.listAccounts({ transactionType: TYPE })
    const codes = options.map((o) => o.accountCode)
    expect(codes).toContain(ACC_ACTIVE)
    expect(codes).not.toContain(ACC_INACTIVE)
  })

  it('管理列表含 inactive，状态切换生效', async () => {
    if (!dbReady) return
    const manage = await TransactionService.listAccountsForManage()
    const item = manage.find((m) => m.code === ACC_INACTIVE)
    expect(item?.status).toBe('inactive')
    await TransactionService.updateAccountStatus(ACC_INACTIVE, 'active', '__test_user__')
    const after = (await TransactionService.listAccountsForManage()).find((m) => m.code === ACC_INACTIVE)
    expect(after?.status).toBe('active')
    // 还原
    await TransactionService.updateAccountStatus(ACC_INACTIVE, 'inactive', '__test_user__')
  })
})

describe('Req4 明细合计（真实 DB）', () => {
  it('totals 为全筛选集期末余额之和（跨页）', async () => {
    if (!dbReady) return
    const page1 = await TransactionService.listDetails({ companyCodes: [CO], transactionType: TYPE, page: 1, pageSize: 2 })
    expect(page1.items).toHaveLength(2) // 分页只返回 2 条
    expect(page1.total).toBe(3)
    expect(page1.totals?.closingBalance).toBe(600) // 合计仍为全部 3 条之和
  })
})
