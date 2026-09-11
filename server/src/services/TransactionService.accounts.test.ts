import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { TransactionService } from './TransactionService'

/**
 * 科目筛选选项集成测试（真实 DB，无 DB 时整组跳过）。
 * 覆盖：主数据与实际数据合并、hasData 标注、无数据科目置底、
 * 主数据缺失但实际有数据的科目仍返回、transactionType 对两侧同时过滤。
 * 用独立往来类型 __TEST_ACC_TYPE__ 与 9000 开头科目编码隔离，afterAll 清理。
 */

const TYPE = '__TEST_ACC_TYPE__'
const CODE_WITH_DATA = '900000000001' // 主数据 + 有明细
const CODE_NO_DATA = '900000000002' // 仅主数据，无明细
const CODE_DATA_ONLY = '900000000003' // 仅明细，主数据缺失

let dbReady = false
const detailIds: string[] = []

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    await basePrisma.transactionAccount.createMany({
      data: [
        { code: CODE_WITH_DATA, name: '测试科目-有数据', transactionType: TYPE, direction: 'AR', orderNo: 1 },
        { code: CODE_NO_DATA, name: '测试科目-无数据', transactionType: TYPE, direction: 'AR', orderNo: 2 },
      ],
      skipDuplicates: true,
    })
    for (const code of [CODE_WITH_DATA, CODE_DATA_ONLY]) {
      const row = await basePrisma.transactionDetail.create({
        data: {
          companyCode: 'EN999905',
          transactionType: TYPE,
          direction: 'AR',
          counterpartyCode: '__TEST_ACC_CP__',
          accountCode: code,
          accountDesc: `明细科目说明-${code}`,
          closingBalance: 100,
          period: '2099-12',
        },
      })
      detailIds.push(row.id)
    }
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.transactionDetail.deleteMany({ where: { id: { in: detailIds } } }).catch(() => undefined)
  await basePrisma.transactionAccount.deleteMany({ where: { transactionType: TYPE } }).catch(() => undefined)
})

describe('TransactionService.listAccounts（真实 DB）', () => {
  it('合并主数据与实际数据：标注 hasData，无数据科目置底', async () => {
    if (!dbReady) return
    const options = await TransactionService.listAccounts({ transactionType: TYPE })
    expect(options.map((o) => o.accountCode)).toEqual([CODE_WITH_DATA, CODE_DATA_ONLY, CODE_NO_DATA])
    expect(options.map((o) => o.hasData)).toEqual([true, true, false])
    // 主数据存在时科目名取主数据；主数据缺失时取明细的科目说明
    expect(options[0].accountDesc).toBe('测试科目-有数据')
    expect(options[1].accountDesc).toBe(`明细科目说明-${CODE_DATA_ONLY}`)
    expect(options[2].accountDesc).toBe('测试科目-无数据')
  })

  it('transactionType 过滤同时作用于主数据与实际数据两侧', async () => {
    if (!dbReady) return
    const other = await TransactionService.listAccounts({ transactionType: '应收账款' })
    expect(other.some((o) => o.accountCode.startsWith('9000'))).toBe(false)
    // 真实科目主数据已 seed：应收账款为 14 条，且有数据项排在前面
    expect(other.length).toBeGreaterThanOrEqual(14)
    const firstNoDataIdx = other.findIndex((o) => !o.hasData)
    if (firstNoDataIdx >= 0) {
      expect(other.slice(firstNoDataIdx).every((o) => !o.hasData)).toBe(true)
    }
  })

  it('不传类型时返回六大往来全部科目（含测试类型）', async () => {
    if (!dbReady) return
    const all = await TransactionService.listAccounts()
    expect(all.some((o) => o.accountCode === CODE_NO_DATA)).toBe(true)
    expect(all.length).toBeGreaterThan(100) // seed 主数据 125 条 + 测试科目
  })
})
