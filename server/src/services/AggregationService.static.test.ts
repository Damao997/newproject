import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { AggregationService, flattenValueTree } from './AggregationService'
import { STATIC_DIMS } from '../lib/metric-values'

/**
 * 静态四维派生端到端验证（真实 DB）。
 * 造唯一公司 + 独立 active 静态批次，插入 4 个月原始快照（marker=CURRENT_AMOUNT），
 * 断言 buildStaticTree 按选定期的快照月份派生本期/年初/同期/上年年初。afterAll 硬删除；无 DB 时跳过。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const companyCode = `ENSTA${suffix}`.slice(0, 20)
const batchId = `batchsta_${suffix}`
let leafCode = ''
const P = '2099-02'

function utcDate(period: string): Date {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15))
}

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const leaves = await basePrisma.accountSubject.findMany({
      where: { subjectType: 'static', isLeaf: true, status: 'active' },
      select: { code: true },
    })
    const dataMetric = await basePrisma.metric.findFirst({
      where: { code: { in: leaves.map((l) => l.code) }, dataType: 'data' },
      select: { code: true },
    })
    leafCode = dataMetric?.code ?? ''
    dbReady = !!leafCode
    if (!dbReady) return
    await basePrisma.importBatch.create({
      data: { id: batchId, fileName: 'static-test.xlsx', status: 'success', dataType: 'static', lifecycleStatus: 'active', fiscalYear: 'FY2099' },
    })
    const row = (period: string, value: number, fy: string) => ({
      batchId, companyCode, accountCode: leafCode, snapshotDate: utcDate(period),
      periodDimCode: STATIC_DIMS.CURRENT_AMOUNT, fiscalYear: fy, value,
    })
    await basePrisma.factStatic.createMany({
      data: [
        row('2099-02', 5000, 'FY2099'), // 本期
        row('2099-01', 4800, 'FY2099'), // 年初（S=1）
        row('2098-02', 4500, 'FY2098'), // 同期
        row('2098-01', 4300, 'FY2098'), // 上年年初
      ],
    })
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.factStatic.deleteMany({ where: { batchId } }).catch(() => undefined)
  await basePrisma.importBatch.delete({ where: { id: batchId } }).catch(() => undefined)
})

describe('AggregationService 静态四维派生（真实 DB）', () => {
  it('按选定期快照月份派生本期/年初/同期/上年年初', async () => {
    if (!dbReady) return
    const tree = await AggregationService.buildStaticTree([companyCode], P)
    const leaf = flattenValueTree(tree).find((n) => n.code === leafCode)
    expect(leaf).toBeTruthy()
    expect(leaf!.values[STATIC_DIMS.CURRENT_AMOUNT]).toBe(5000) // 2099-02
    expect(leaf!.values[STATIC_DIMS.YEAR_START]).toBe(4800) // 2099-01
    expect(leaf!.values[STATIC_DIMS.SAME_PERIOD_AMOUNT]).toBe(4500) // 2098-02
    expect(leaf!.values[STATIC_DIMS.LAST_YEAR_START]).toBe(4300) // 2098-01
  })
})
