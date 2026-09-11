import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { CASHFLOW_DIMS } from '../lib/metric-values'
import { AggregationService, flattenValueTree } from './AggregationService'

/**
 * 现金流聚合树汇总抵消（真实 DB，无 DB 时整组跳过）。
 * 覆盖：templateType='cashflow' 调整单在汇总主体链路的四维叠加（本月/本年累计/同期/同期累计）、
 * 软删除调整不计入、单体链路不叠加。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const EN = `ENCF${suffix}`.slice(0, 20)
const ET = `ETCF${suffix}`.slice(0, 20)
const P = '2096-04'
const PREV = '2095-04'
const FY = 'FY2096'
let cfLeaf: { code: string } | null = null
let batchId = ''

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    // 取数据类叶子（排除 calc 类如「自由现金流 CF04」：公式层会覆盖直写事实值，导致抵消断言失效）
    const cfData = await basePrisma.metric.findMany({ where: { dataType: 'data', code: { startsWith: 'CF' } }, select: { code: true } })
    cfLeaf = await basePrisma.accountSubject.findFirst({
      where: { subjectType: 'cashflow', isLeaf: true, status: 'active', code: { in: cfData.map((m) => m.code) } },
      select: { code: true },
    })
    if (!cfLeaf) return
    await basePrisma.company.createMany({
      data: [
        { code: EN, name: `现金流单体_${suffix}`, entityType: 'single', status: 'active' },
        { code: ET, name: `现金流汇总_${suffix}`, entityType: 'summary', status: 'active' },
      ],
    })
    await basePrisma.companyAggregationMap.create({ data: { summaryCompanyCode: ET, singleCompanyCode: EN } })
    const b = await basePrisma.importBatch.create({
      data: { fileName: `__test_cf_consolidate_${suffix}__.xlsx`, status: 'success', dataType: 'cashflow', lifecycleStatus: 'active', sourceType: 'upload', fiscalYear: FY },
    })
    batchId = b.id
    await basePrisma.factOperating.create({
      data: { batchId: b.id, companyCode: EN, accountCode: cfLeaf.code, period: P, periodDimCode: CASHFLOW_DIMS.ACTUAL_MONTH, fiscalYear: FY, value: 100 },
    })
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.consolidationAdjustment.deleteMany({ where: { summaryCompanyCode: ET } }).catch(() => undefined)
  await basePrisma.factOperating.deleteMany({ where: { batchId: batchId } }).catch(() => undefined)
  await basePrisma.importBatch.deleteMany({ where: { id: batchId } }).catch(() => undefined)
  await basePrisma.companyAggregationMap.deleteMany({ where: { summaryCompanyCode: ET } }).catch(() => undefined)
  await basePrisma.company.deleteMany({ where: { code: { in: [EN, ET] } } }).catch(() => undefined)
})

describe('buildCashflowTree 汇总抵消（真实 DB）', () => {
  it('单体链路不叠加抵消', async () => {
    if (!dbReady || !cfLeaf) return
    const tree = await AggregationService.buildCashflowTree([EN], P)
    const node = flattenValueTree(tree).find((n) => n.code === cfLeaf!.code)
    expect(node).toBeTruthy()
    expect(node!.values[CASHFLOW_DIMS.ACTUAL_MONTH]).toBe(100)
    expect(node!.values[CASHFLOW_DIMS.YTD_ACTUAL]).toBe(100)
    expect(node!.values[CASHFLOW_DIMS.SAME_PERIOD_ACTUAL]).toBe(0)
    expect(node!.values[CASHFLOW_DIMS.SAME_PERIOD_YTD]).toBe(0)
  })

  it('汇总主体链路按 templateType=cashflow 调整单四维叠加', async () => {
    if (!dbReady || !cfLeaf) return
    await basePrisma.consolidationAdjustment.createMany({
      data: [
        { templateType: 'cashflow', summaryCompanyCode: ET, accountCode: cfLeaf!.code, period: P, amount: 10, reason: 'test', createdBy: 'test-user' },
        { templateType: 'cashflow', summaryCompanyCode: ET, accountCode: cfLeaf!.code, period: PREV, amount: 5, reason: 'test', createdBy: 'test-user' },
      ],
    })
    const tree = await AggregationService.buildCashflowTree([EN], P, { consolidationSummaryCode: ET })
    const node = flattenValueTree(tree).find((n) => n.code === cfLeaf!.code)!
    expect(node.values[CASHFLOW_DIMS.ACTUAL_MONTH]).toBe(110) // 100 + 10
    expect(node.values[CASHFLOW_DIMS.YTD_ACTUAL]).toBe(110) // P 落在本年累计区间内
    expect(node.values[CASHFLOW_DIMS.SAME_PERIOD_ACTUAL]).toBe(5) // 0 + 5（同期无事实）
    expect(node.values[CASHFLOW_DIMS.SAME_PERIOD_YTD]).toBe(5) // PREV 落在同期累计区间内
  })

  it('软删除调整单不计入抵消', async () => {
    if (!dbReady || !cfLeaf) return
    await basePrisma.consolidationAdjustment.create({
      data: { templateType: 'cashflow', summaryCompanyCode: ET, accountCode: cfLeaf!.code, period: P, amount: 100, reason: 'test', createdBy: 'test-user', deletedAt: new Date() },
    })
    const tree = await AggregationService.buildCashflowTree([EN], P, { consolidationSummaryCode: ET })
    const node = flattenValueTree(tree).find((n) => n.code === cfLeaf!.code)!
    expect(node.values[CASHFLOW_DIMS.ACTUAL_MONTH]).toBe(110) // 软删调整 100 不计入
  })

  it('预算维度：流入/流出层直填导入值，净额与自由现金流由公式推导', async () => {
    if (!dbReady) return
    // 独立财年 FY2097（与其他测试财年隔离，避免 active 预算批次叠加）
    const P2 = '2097-04'
    const FY2 = 'FY2097'
    const cfIn = await basePrisma.accountSubject.findFirst({ where: { subjectType: 'cashflow', name: '经营活动产生的现金流入', status: 'active' }, select: { code: true } })
    const cfOut = await basePrisma.accountSubject.findFirst({ where: { subjectType: 'cashflow', name: '经营活动产生的现金流出', status: 'active' }, select: { code: true } })
    const cfInvOut = await basePrisma.accountSubject.findFirst({ where: { subjectType: 'cashflow', name: '投资活动产生的现金流出', status: 'active' }, select: { code: true } })
    if (!cfIn || !cfOut || !cfInvOut) return
    const b = await basePrisma.importBatch.create({
      data: { fileName: `__test_cf_budget_${suffix}__.xlsx`, status: 'success', dataType: 'budget', lifecycleStatus: 'active', sourceType: 'upload', fiscalYear: FY2 },
    })
    try {
      await basePrisma.factBudget.createMany({
        data: [
          { batchId: b.id, companyCode: EN, accountCode: cfIn.code, fiscalYear: FY2, period: 'annual', value: 200 },
          { batchId: b.id, companyCode: EN, accountCode: cfOut.code, fiscalYear: FY2, period: 'annual', value: 80 },
          { batchId: b.id, companyCode: EN, accountCode: cfInvOut.code, fiscalYear: FY2, period: 'annual', value: 50 },
        ],
      })
      const tree = await AggregationService.buildCashflowTree([EN], P2)
      const byName = new Map(flattenValueTree(tree).map((n) => [n.name, n]))
      // 流入/流出层：直填导入值（不被子级求和覆盖）
      expect(byName.get('经营活动产生的现金流入')!.values[CASHFLOW_DIMS.BUDGET_AMOUNT]).toBe(200)
      expect(byName.get('经营活动产生的现金流出')!.values[CASHFLOW_DIMS.BUDGET_AMOUNT]).toBe(80)
      // 净额类与自由现金流：公式推导（流入预算 - 流出预算）
      expect(byName.get('经营活动产生的现金流量')!.values[CASHFLOW_DIMS.BUDGET_AMOUNT]).toBe(120)
      expect(byName.get('投资活动产生的现金流量')!.values[CASHFLOW_DIMS.BUDGET_AMOUNT]).toBe(-50)
      expect(byName.get('自由现金流')!.values[CASHFLOW_DIMS.BUDGET_AMOUNT]).toBe(70) // 经营净额 120 - 投资流出 50
    } finally {
      await basePrisma.factBudget.deleteMany({ where: { batchId: b.id } }).catch(() => undefined)
      await basePrisma.importBatch.deleteMany({ where: { id: b.id } }).catch(() => undefined)
    }
  })
})
