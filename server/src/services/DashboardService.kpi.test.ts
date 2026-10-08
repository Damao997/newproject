import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardService, kpiMonthComparison } from './DashboardService'
import { OPERATING_DIMS } from '../lib/metric-values'
import type { ValueNode } from './AggregationService'

const mocks = vi.hoisted(() => ({
  batches: vi.fn(), periods: vi.fn(), previousData: vi.fn(), tree: vi.fn(), resolve: vi.fn(), ratios: vi.fn(),
}))
vi.mock('../lib/prisma', () => ({ prisma: {
  importBatch: { findMany: mocks.batches },
  factOperating: { findMany: mocks.periods, findFirst: mocks.previousData },
} }))
vi.mock('./AggregationService', () => ({
  AggregationService: { buildOperatingTree: mocks.tree }, resolveDashboardCompany: mocks.resolve,
}))
vi.mock('./BudgetRatioService', async importOriginal => {
  const original = await importOriginal<typeof import('./BudgetRatioService')>()
  return { ...original, BudgetRatioService: { budgetRatiosOf: mocks.ratios } }
})

function node(code: string, category: string, amount: number, name = category): ValueNode {
  return {
    code, name, category, level: 0, dataType: 'data', direction: 'credit', valueType: 'amount', isLeaf: true, children: [],
    values: { [OPERATING_DIMS.ACTUAL_MONTH]: amount, [OPERATING_DIMS.SAME_PERIOD_ACTUAL]: 100,
      [OPERATING_DIMS.YTD_ACTUAL]: 500, [OPERATING_DIMS.SAME_PERIOD_YTD]: 250, [OPERATING_DIMS.BUDGET_AMOUNT]: 1200 },
  }
}
function tree(previous = false): ValueNode[] {
  return [
    node('PL02', '壹品慧收入', previous ? 80 : 120),
    node('PL04', '壹品慧毛利', previous ? 40 : 30),
    node('PL06', '经营成果', previous ? -40 : -20, '净利润'),
    node('PL01', '壹品慧回款', 0),
  ]
}
const scope = { companyCode: 'EN330001', scopeValue: 'company' }

describe('看板 KPI 比较口径', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.batches.mockImplementation(async query => query.where.dataType === 'operating' ? [{ id: 'active-operating' }] : [])
    mocks.periods.mockResolvedValue([{ period: '2026-03' }, { period: '2026-04' }])
    mocks.previousData.mockResolvedValue({ id: 'previous-row' })
    mocks.resolve.mockResolvedValue({ codes: ['EN330001'], companyCode: 'EN330001', companyName: '测试公司', companyType: 'single', degraded: false })
    mocks.ratios.mockResolvedValue(null)
    mocks.tree.mockImplementation(async (_codes, period) => tree(period === '2026-03'))
  })

  it('四月与三月跨财年比较，累计同比使用同期累计，保留原预算口径', async () => {
    const result = await DashboardService.getDrill(scope, { period: '2026-04' })
    expect(mocks.tree).toHaveBeenCalledWith(['EN330001'], '2026-03', { consolidationSummaryCode: null })
    expect(result.kpiData.map(kpi => kpi.monthMom)).toEqual([0.5, -0.25, 0.5, null])
    expect(result.kpiData[0]).toMatchObject({ monthActual: 120, ytdActual: 500, yoy: 0.2, ytdYoy: 1, monthRate: 120, ytdRate: 41.67 })
    expect(result.kpiData[3].monthMomReason).toBe('zero-base')
    expect(result.trendData).toHaveLength(12)
    expect(result.trendData[0].period).toBe('2026-04')
    expect(result.trendData.some(row => row.period === '2026-03')).toBe(false)
  })

  it('一月自然上月为上一年十二月，财年内已有上月聚合树只构建一次', async () => {
    mocks.periods.mockResolvedValue([{ period: '2026-12' }, { period: '2027-01' }])
    mocks.tree.mockImplementation(async (_codes, period) => tree(period === '2026-12'))
    const result = await DashboardService.getDrill(scope, { period: '2027-01' })
    expect(result.kpiData[0].monthMom).toBe(0.5)
    expect(mocks.tree.mock.calls.filter(call => call[1] === '2026-12')).toHaveLength(1)
  })

  it('其他公司有上月数据时，当前授权主体缺失仍返回不可计算', async () => {
    mocks.previousData.mockResolvedValue(null)
    const result = await DashboardService.getDrill(scope, { period: '2026-04' })
    expect(result.kpiData.every(kpi => kpi.monthMom === null && kpi.monthMomReason === 'no-data')).toBe(true)
    expect(mocks.previousData).toHaveBeenCalledWith({ where: {
      companyCode: { in: ['EN330001'] }, period: '2026-03', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH,
      batchId: { in: ['active-operating'] },
    }, select: { id: true } })
  })

  it('缺失上月不回退到最近有数据月份，也不把趋势缺失月改成零', async () => {
    mocks.periods.mockResolvedValue([{ period: '2026-04' }, { period: '2026-06' }])
    mocks.previousData.mockResolvedValue(null)
    const result = await DashboardService.getDrill(scope, { period: '2026-06' })
    expect(mocks.previousData.mock.calls[0][0].where.period).toBe('2026-05')
    expect(result.kpiData[0].monthMomReason).toBe('no-data')
    expect(result.trendData.find(row => row.period === '2026-05')?.revenueActual).toBeNull()
  })

  it('汇总主体的当前月和上月都透传相同抵消上下文', async () => {
    mocks.resolve.mockResolvedValue({ codes: ['EN330001', 'EN330002'], companyCode: 'ET0001', companyType: 'summary', degraded: false })
    await DashboardService.getDrill(scope, { period: '2026-04', companyCode: 'ET0001' })
    expect(mocks.tree).toHaveBeenCalledWith(['EN330001', 'EN330002'], '2026-04', { consolidationSummaryCode: 'ET0001' })
    expect(mocks.tree).toHaveBeenCalledWith(['EN330001', 'EN330002'], '2026-03', { consolidationSummaryCode: 'ET0001' })
  })

  it('无数据权限返回空卡片，且不发起上月数据查询', async () => {
    mocks.resolve.mockResolvedValue({ codes: [], companyCode: null, companyType: null, degraded: false })
    expect((await DashboardService.getDrill(scope, { period: '2026-04' })).kpiData).toEqual([])
    expect(mocks.previousData).not.toHaveBeenCalled()
  })

  it.each([
    [100, null, null, 'no-data'], [100, 0, null, 'zero-base'], [0, 0, null, 'zero-base'],
    [100, 100, 0, null], [0, 100, -1, null], [50, -100, 1.5, null], [-150, -100, -0.5, null],
    [100.4, 100, 0.004, null],
  ] as const)('环比边界：当前 %s、上月 %s', (current, previous, monthMom, monthMomReason) => {
    expect(kpiMonthComparison(current, previous)).toEqual({ monthMom, monthMomReason })
  })
})
