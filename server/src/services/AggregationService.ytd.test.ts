import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { AggregationService, flattenValueTree } from './AggregationService'
import { OPERATING_DIMS } from '../lib/metric-values'

/**
 * 本年累计/同期累计 端到端聚合验证（真实 DB）。
 * 造一个唯一公司 + 独立 active 经营批次，插入同财年两个月的本月实际/同期实际事实，
 * 断言 buildOperatingTree 的当前期本月实际取当月、YTD 为逐月求和。afterAll 硬删除；无 DB 时跳过。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const companyCode = `ENYTD${suffix}`.slice(0, 20)
const batchId = `batchytd_${suffix}`
let leafCode = ''
const p1 = '2099-01'
const p2 = '2099-02'
const pp1 = '2098-01'
const pp2 = '2098-02'

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    // 取一个 data 类经营叶子科目，确保计算层不会覆盖其值
    const leaves = await basePrisma.accountSubject.findMany({
      where: { subjectType: 'operating', isLeaf: true, status: 'active' },
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
      data: { id: batchId, fileName: 'ytd-test.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'active', fiscalYear: 'FY2099' },
    })
    // 新模型：上年数据也以自身 period 存为 ACTUAL_MONTH；同期/同期累计由查询期派生
    await basePrisma.factOperating.createMany({
      data: [
        { batchId, companyCode, accountCode: leafCode, period: p1, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2099', value: 100 },
        { batchId, companyCode, accountCode: leafCode, period: p2, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2099', value: 150 },
        { batchId, companyCode, accountCode: leafCode, period: pp1, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2098', value: 80 },
        { batchId, companyCode, accountCode: leafCode, period: pp2, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2098', value: 90 },
      ],
    })
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.factOperating.deleteMany({ where: { batchId } }).catch(() => undefined)
  await basePrisma.importBatch.delete({ where: { id: batchId } }).catch(() => undefined)
})

describe('AggregationService 本年累计/同期累计（真实 DB）', () => {
  it('本月/同期按单期取数；本年累计/同期累计由原始 ACTUAL_MONTH 按区间派生', async () => {
    if (!dbReady) return
    const tree = await AggregationService.buildOperatingTree([companyCode], p2)
    const leaf = flattenValueTree(tree).find((n) => n.code === leafCode)
    expect(leaf).toBeTruthy()
    expect(leaf!.values[OPERATING_DIMS.ACTUAL_MONTH]).toBe(150) // 当期 2099-02
    expect(leaf!.values[OPERATING_DIMS.SAME_PERIOD_ACTUAL]).toBe(90) // 2098-02
    expect(leaf!.values[OPERATING_DIMS.YTD_ACTUAL]).toBe(250) // 100 + 150
    expect(leaf!.values[OPERATING_DIMS.SAME_PERIOD_YTD]).toBe(170) // 80 + 90
  })
})
