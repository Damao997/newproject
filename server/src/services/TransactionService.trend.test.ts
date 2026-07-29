import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { TransactionService } from './TransactionService'

/**
 * 往来变动趋势聚合集成测试（真实 DB，无 DB 时整组跳过）。
 * 覆盖：同公司同期间求和聚合、月份轴连续补全（缺月补 null）、
 * 空 companyCodes 合计线、months 范围截断、无数据返回空；
 * 另复用同一组种子验证 getOverview 的 companyCodes IN 与 period 单期过滤。
 * 使用独立测试公司编码 EN999902/EN999903 隔离，afterAll 清理。
 */

const CO_A = 'EN999902'
const CO_B = 'EN999903'
// 用预付账款类型隔离：避免与 coverage 测试（2099 期间的应收/应付种子）并行时干扰“全库最新期间”推导
const TYPE = '预付账款'

let dbReady = false
const createdIds: string[] = []

async function seedDetail(companyCode: string, companyName: string, period: string, closing: number, aging: Record<string, number> = {}) {
  const row = await basePrisma.transactionDetail.create({
    data: {
      companyCode,
      companyName,
      transactionType: TYPE,
      direction: 'AP',
      counterpartyCode: '__TREND_CP__',
      accountCode: '__TREND_1122__',
      closingBalance: closing,
      period,
      ...aging,
    },
  })
  createdIds.push(row.id)
}

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    // A 公司：2097-01 两条（求和 100+50）、2097-03 一条（2097-02 缺失 → null）；
    // 2097-03 这条带 10 段账龄，验证 5 段归集：1-3月=200 / 4-6月=50 / 半年以上=20 / 1年至3年=25 / 3年以上=5
    await seedDetail(CO_A, '趋势测试A', '2097-01', 100)
    await seedDetail(CO_A, '趋势测试A', '2097-01', 50)
    await seedDetail(CO_A, '趋势测试A', '2097-03', 300, {
      aging1m: 100, aging2m: 50, aging3m: 50,
      aging4m: 40, aging5m: 0, aging6m: 10,
      aging6mTo1y: 20, aging1yTo2y: 15, aging2yTo3y: 10, aging3yPlus: 5,
    })
    // B 公司：仅 2097-03
    await seedDetail(CO_B, '趋势测试B', '2097-03', 700)
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.transactionDetail.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined)
})

describe('TransactionService.getTrend（真实 DB）', () => {
  it('按公司分线：同期间求和、缺月补 null、月份轴连续', async () => {
    if (!dbReady) return
    const r = await TransactionService.getTrend({ transactionType: TYPE, companyCodes: [CO_A, CO_B], months: 3 })
    expect(r.periods).toEqual(['2097-01', '2097-02', '2097-03'])
    expect(r.series).toHaveLength(2)
    const a = r.series.find((s) => s.companyCode === CO_A)!
    const b = r.series.find((s) => s.companyCode === CO_B)!
    expect(a.companyName).toBe('趋势测试A')
    expect(a.points).toEqual([150, null, 300])
    expect(b.points).toEqual([null, null, 700])
  })

  it('months 截断：范围外期间不入轴', async () => {
    if (!dbReady) return
    const r = await TransactionService.getTrend({ transactionType: TYPE, companyCodes: [CO_A], months: 1 })
    expect(r.periods).toEqual(['2097-03'])
    expect(r.series[0].points).toEqual([300])
  })

  it('空 companyCodes：返回全部公司逐公司曲线（不合并）', async () => {
    if (!dbReady) return
    const r = await TransactionService.getTrend({ transactionType: TYPE, months: 3 })
    // 终点为该类型全库最新期间；测试数据 2097 远超真实数据，必为终点
    expect(r.periods[r.periods.length - 1]).toBe('2097-03')
    expect(r.series).toHaveLength(2)
    // 按公司编码升序：CO_A 在前
    expect(r.series[0].companyCode).toBe(CO_A)
    expect(r.series[1].companyCode).toBe(CO_B)
    expect(r.series[0].points).toEqual([150, null, 300])
    expect(r.series[1].points).toEqual([null, null, 700])
  })

  it('财年轴：完整 12 个月，数据落在对应月份，其余补 null', async () => {
    if (!dbReady) return
    // 测试数据 2097-01/2097-03 均属 FY2096（起始月=4，2096-04~2097-03）
    const r = await TransactionService.getTrend({ transactionType: TYPE, fiscalYear: 'FY2096' })
    expect(r.periods).toHaveLength(12)
    expect(r.periods[0]).toBe('2096-04')
    expect(r.periods[11]).toBe('2097-03')
    const a = r.series.find((s) => s.companyCode === CO_A)!
    const b = r.series.find((s) => s.companyCode === CO_B)!
    // 2097-01 索引 9、2097-03 索引 11
    expect(a.points[9]).toBe(150)
    expect(a.points[11]).toBe(300)
    expect(a.points[0]).toBeNull()
    expect(b.points[11]).toBe(700)
    expect(b.points[9]).toBeNull()
  })

  it('无数据类型返回空轴空序列', async () => {
    if (!dbReady) return
    const r = await TransactionService.getTrend({ transactionType: TYPE, companyCodes: ['EN000000'], months: 12 })
    expect(r.periods).toEqual([])
    expect(r.series).toEqual([])
  })
})

describe('TransactionService.getOverview 过滤（真实 DB）', () => {
  it('period 单期过滤：仅计入该期，不跨期累加', async () => {
    if (!dbReady) return
    const r = await TransactionService.getOverview({ companyCodes: [CO_A, CO_B], period: '2097-03' })
    expect(r).toHaveLength(1)
    expect(r[0].transactionType).toBe(TYPE)
    expect(r[0].totalClosingBalance).toBe(1000) // 300 + 700，不含 2097-01 的 150
    expect(r[0].recordCount).toBe(2)
  })

  it('companyCodes IN 过滤生效', async () => {
    if (!dbReady) return
    const r = await TransactionService.getOverview({ companyCodes: [CO_B], period: '2097-03' })
    expect(r).toHaveLength(1)
    expect(r[0].totalClosingBalance).toBe(700)

    const r2 = await TransactionService.getOverview({ companyCodes: [CO_A], period: '2097-01' })
    expect(r2).toHaveLength(1)
    expect(r2[0].totalClosingBalance).toBe(150) // 同期两条求和
    expect(r2[0].recordCount).toBe(2)
  })
})

describe('TransactionService.getAgingAnalysis / listDetails（真实 DB）', () => {
  it('账龄 10 段归集为 5 段，支持 period + 科目多选过滤，按期末余额倒序', async () => {
    if (!dbReady) return
    const rows = await TransactionService.getAgingAnalysis({ groupBy: 'type', period: '2097-03', accountCodes: ['__TREND_1122__'] }) as Array<{ companyCode: string; closingBalance: number; aging: Record<string, number> }>
    expect(rows).toHaveLength(2)
    // 倒序：B(700) 在前，A(300) 在后
    expect(rows[0].companyCode).toBe(CO_B)
    expect(rows[1].companyCode).toBe(CO_A)
    // 5 段归集断言（CO_A 种子）
    expect(rows[1].aging).toEqual({ '1-3月': 200, '4-6月': 50, '半年以上': 20, '1年至3年': 25, '3年以上': 5 })
    // 科目过滤：不存在的科目返回空
    const none = await TransactionService.getAgingAnalysis({ groupBy: 'type', period: '2097-03', accountCodes: ['__NO_SUCH__'] })
    expect(none).toHaveLength(0)
  })

  it('明细按金额倒序，支持科目多选过滤', async () => {
    if (!dbReady) return
    const page = await TransactionService.listDetails({ period: '2097-03', accountCodes: ['__TREND_1122__'] })
    expect(page.total).toBe(2)
    expect(page.items[0].closingBalance).toBe(700)
    expect(page.items[1].closingBalance).toBe(300)
    const none = await TransactionService.listDetails({ period: '2097-03', accountCodes: ['__NO_SUCH__'] })
    expect(none.total).toBe(0)
  })
})
