import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { InventoryService } from './InventoryService'
import { STATIC_DIMS } from '../lib/metric-values'

/**
 * 存货管理服务集成测试（真实 DB，无 DB 或静态科目树缺「存货」时整组跳过）。
 * 造唯一测试公司 + 独立 active 静态批次，对前两个存货品类叶子插入多月快照，
 * 覆盖：overview 总额四维/占比/排名/同比、details 公司×品类月份归集与空组合剔除、
 * trend 财年区间截断与品类/总额序列。afterAll 硬删除。
 * 月份口径按 S=4（FISCAL_START_MONTH=4）：P='2099-08' → 年初 2099-04 / 同期 2098-08 / 上年年初 2098-04。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const companyCode = `ENINV${suffix}`.slice(0, 20)
const batchId = `batchinv_${suffix}`
let cat1 = ''
let cat2 = ''
const P = '2099-08'
const scope = { companyCode, scopeValue: null as string | null, dataScopeCodes: null }

function utcDate(period: string): Date {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 28))
}

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const root = await basePrisma.accountSubject.findFirst({
      where: { subjectType: 'static', name: '存货' },
      select: { code: true },
    })
    if (!root) return
    const cats = await basePrisma.accountSubject.findMany({
      where: { subjectType: 'static', parentCode: root.code },
      orderBy: { orderNo: 'asc' },
      select: { code: true },
      take: 2,
    })
    if (cats.length < 2) return
    cat1 = cats[0].code
    cat2 = cats[1].code
    await basePrisma.company.create({
      data: { code: companyCode, name: '存货测试公司', entityType: 'single', status: 'active' },
    })
    await basePrisma.importBatch.create({
      data: { id: batchId, fileName: 'inventory-test.xlsx', status: 'success', dataType: 'static', lifecycleStatus: 'active', fiscalYear: 'FY2099' },
    })
    const row = (accountCode: string, period: string, value: number, fy: string) => ({
      batchId, companyCode, accountCode, snapshotDate: utcDate(period),
      periodDimCode: STATIC_DIMS.CURRENT_AMOUNT, fiscalYear: fy, value,
    })
    await basePrisma.factStatic.createMany({
      data: [
        // cat1：本期 600 / 年初 500 / 同期 400 / 上年年初 300
        row(cat1, '2099-08', 600, 'FY2099'),
        row(cat1, '2099-04', 500, 'FY2099'),
        row(cat1, '2098-08', 400, 'FY2098'),
        row(cat1, '2098-04', 300, 'FY2098'),
        // cat2：本期 200 / 年初 100 / 同期 100（无上年年初）
        row(cat2, '2099-08', 200, 'FY2099'),
        row(cat2, '2099-04', 100, 'FY2099'),
        row(cat2, '2098-08', 100, 'FY2098'),
      ],
    })
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.factStatic.deleteMany({ where: { batchId } }).catch(() => undefined)
  await basePrisma.importBatch.delete({ where: { id: batchId } }).catch(() => undefined)
  await basePrisma.company.delete({ where: { code: companyCode } }).catch(() => undefined)
})

describe('InventoryService.getOverview（真实 DB）', () => {
  it('总额四维 = 品类求和；品类含占比/排名/同比', async () => {
    if (!dbReady) return
    const r = await InventoryService.getOverview(scope, { period: P })
    expect(r.period).toBe(P)
    expect(r.companyCount).toBe(1)
    expect(r.total).toEqual({ current: 800, yearStart: 600, samePeriod: 500, lastYearStart: 300 })

    const c1 = r.categories.find((c) => c.code === cat1)
    const c2 = r.categories.find((c) => c.code === cat2)
    expect(c1).toBeDefined()
    expect(c2).toBeDefined()
    expect(c1).toMatchObject({ current: 600, yearStart: 500, samePeriod: 400, lastYearStart: 300, share: 75, rank: 1, yoy: 50 })
    expect(c2).toMatchObject({ current: 200, yearStart: 100, samePeriod: 100, share: 25, rank: 2, yoy: 100 })
    // 周转天数字段恒存在（无经营成本数据时为 0 兜底）
    expect(typeof r.turnoverDays.current).toBe('number')
    expect(typeof r.turnoverDays.samePeriod).toBe('number')
  })

  it('显式传入本公司编码时结果一致；无数据品类金额为 0', async () => {
    if (!dbReady) return
    const r = await InventoryService.getOverview(scope, { period: P, companyCodes: [companyCode] })
    expect(r.total.current).toBe(800)
    const others = r.categories.filter((c) => c.code !== cat1 && c.code !== cat2)
    for (const o of others) expect(o.current).toBe(0)
  })
})

describe('InventoryService.getDetails（真实 DB）', () => {
  it('公司×品类行按快照月归集，三主月份均无数据的组合不出行', async () => {
    if (!dbReady) return
    const r = await InventoryService.getDetails(scope, { period: P })
    expect(r.rows).toHaveLength(2)
    const r1 = r.rows.find((x) => x.categoryCode === cat1)
    const r2 = r.rows.find((x) => x.categoryCode === cat2)
    expect(r1).toMatchObject({
      companyCode, companyName: '存货测试公司',
      current: 600, yearStart: 500, samePeriod: 400, lastYearStart: 300, yoy: 50,
    })
    expect(r2).toMatchObject({ current: 200, yearStart: 100, samePeriod: 100, lastYearStart: 0, yoy: 100 })
  })
})

describe('InventoryService.getTrend（真实 DB）', () => {
  it('财年区间截断：仅纳入 FY2099 内快照月，品类/总额序列对齐', async () => {
    if (!dbReady) return
    const r = await InventoryService.getTrend(scope, { fiscalYear: 'FY2099' })
    // S=4：FY2099 = 2099-04 ~ 2100-03，2098-XX 快照被截断
    expect(r.months).toEqual(['2099-04', '2099-08'])
    expect(r.total).toEqual([600, 800])
    const c1 = r.byCategory.find((c) => c.code === cat1)
    const c2 = r.byCategory.find((c) => c.code === cat2)
    expect(c1?.values).toEqual([500, 600])
    expect(c2?.values).toEqual([100, 200])
  })

  it('非法财年格式报 badRequest', async () => {
    if (!dbReady) return
    await expect(InventoryService.getTrend(scope, { fiscalYear: '2099' })).rejects.toThrow()
  })
})
