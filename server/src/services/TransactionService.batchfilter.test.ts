import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { TransactionService } from './TransactionService'

/**
 * 生效批次过滤回归（真实 DB，无 DB 时整组跳过）：
 * 草稿/归档往来批次不参与总览与账龄统计，无 batchId 的存量历史行保留。
 * 用独立公司 EN999911、往来类型 __TEST_BF__、科目 911000000001 隔离，afterAll 清理。
 */

const CO = 'EN999911'
const TYPE = '__TEST_BF__'
const ACC = '911000000001'
const PERIOD = '2099-12'

let dbReady = false
const detailIds: string[] = []
const batchIds: string[] = []

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    await basePrisma.transactionAccount.createMany({
      data: [{ code: ACC, name: '测试BF-科目', transactionType: TYPE, direction: 'AR', status: 'active', orderNo: 1 }],
      skipDuplicates: true,
    })
    const mkBatchRow = async (lifecycleStatus: 'draft' | 'active' | 'archived', closing: number) => {
      const b = await basePrisma.importBatch.create({
        data: { fileName: `__bf_${lifecycleStatus}__.xlsx`, status: 'success', dataType: 'transaction', lifecycleStatus, sourceType: 'upload' },
      })
      batchIds.push(b.id)
      const row = await basePrisma.transactionDetail.create({
        data: {
          batchId: b.id, companyCode: CO, transactionType: TYPE, direction: 'AR', period: PERIOD,
          counterpartyCode: `CP_${lifecycleStatus}`, accountCode: ACC, closingBalance: closing,
        },
      })
      detailIds.push(row.id)
    }
    await mkBatchRow('active', 100)
    await mkBatchRow('draft', 200)
    await mkBatchRow('archived', 400)
    // 存量行（无 batchId，批次体系上线前导入）保留参与统计
    const legacy = await basePrisma.transactionDetail.create({
      data: { companyCode: CO, transactionType: TYPE, direction: 'AR', period: PERIOD, counterpartyCode: 'CP_LEGACY', accountCode: ACC, closingBalance: 50 },
    })
    detailIds.push(legacy.id)
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.transactionDetail.deleteMany({ where: { id: { in: detailIds } } }).catch(() => undefined)
  await basePrisma.importBatch.deleteMany({ where: { id: { in: batchIds } } }).catch(() => undefined)
  await basePrisma.transactionAccount.deleteMany({ where: { code: ACC } }).catch(() => undefined)
})

describe('生效批次过滤（真实 DB，H1 回归）', () => {
  it('总览仅统计 active 批次与存量行（draft/archived 不参与）', async () => {
    if (!dbReady) return
    const rows = await TransactionService.getOverview({ companyCodes: [CO], period: PERIOD })
    const item = rows.find((r) => r.transactionType === TYPE)
    // active 100 + legacy 50；draft 200 与 archived 400 不计入
    expect(item?.totalClosingBalance).toBe(150)
  })

  it('账龄分析同口径（仅 active 与存量行的往来对象出现）', async () => {
    if (!dbReady) return
    const rows = (await TransactionService.getAgingAnalysis({
      companyCodes: [CO], transactionType: TYPE, period: PERIOD, groupBy: 'counterparty',
    })) as Array<{ counterpartyCode: string; closingBalance: number }>
    expect(rows.map((r) => r.counterpartyCode).sort()).toEqual(['CP_LEGACY', 'CP_active'])
    expect(rows.reduce((s, r) => s + r.closingBalance, 0)).toBe(150)
  })
})
