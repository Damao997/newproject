import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { DashboardService } from './DashboardService'
import { AnalysisQueryService } from './AnalysisQueryService'
import { AggregationService, flattenValueTree } from './AggregationService'
import { OPERATING_DIMS } from '../lib/metric-values'

/**
 * 即席分析接口「契约对照测试」（真实 DB）——本方案唯一的安全网（技术方案 §11.1）。
 *
 * 同一 (period, companyCode) 下分别调用**旧接口**与**新接口**，逐字段断言一致；
 * 任何不一致都视为 P0 缺陷（口径漂移）。新接口的设计前提是「复用现有纯函数 + 投影」，
 * 因此这些断言在正确实现下应当恒等——它们的作用是捕获适配器选错数据源、行序错乱、
 * 过滤条件不一致等回归。
 *
 * 夹具：唯一公司 + 两个 active 批次（经营/预算）+ 全量经营叶子科目的 4 期事实，
 * 覆盖本月/同期/本年累计/同期累计与年度预算五条取数路径。无 DB 时整组跳过。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const companyCode = `ENAQ${suffix}`.slice(0, 20)
const batchId = `batchaq_${suffix}`
const budgetBatchId = `batchaqb_${suffix}`
const curPeriod = '2099-06'
const prevMonth = '2099-05'
const samePeriod = '2098-06'
const prevSameMonth = '2098-05'
const fiscalYear = 'FY2099'
const prevFiscalYear = 'FY2098'

const scope = { companyCode: null, scopeValue: '*', dataScopeCodes: null }

const round2 = (n: number): number => Number(n.toFixed(2))

/** 旧接口（ProductBudgetMetric）直接存在的口径字段 */
const DIRECT_KEYS = ['monthBudget', 'monthActual', 'monthSame', 'monthYoy', 'monthRate', 'ytdActual', 'ytdSame', 'ytdYoy'] as const
/** 需映射或派生的口径字段：annualBudget←budget、annualRate←ytdRate、monthChange/ytdChange 为新增派生 */
const EXTRA_KEYS = ['annualBudget', 'ytdBudget', 'annualRate', 'monthChange', 'ytdChange'] as const
/** 单组维度的全量对照指标集 */
const GROUP_KEYS = [...DIRECT_KEYS, ...EXTRA_KEYS] as string[]

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const leaves = await basePrisma.accountSubject.findMany({
      where: { subjectType: 'operating', status: 'active', isLeaf: true },
      select: { code: true },
    })
    if (leaves.length === 0) return
    await basePrisma.company.create({
      data: { code: companyCode, name: `即席测试_${suffix}`, entityType: 'single', status: 'active' },
    })
    await basePrisma.importBatch.createMany({
      data: [
        { id: batchId, fileName: 'aq-operating.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'active', fiscalYear },
        { id: budgetBatchId, fileName: 'aq-budget.xlsx', status: 'success', dataType: 'budget', lifecycleStatus: 'active', fiscalYear },
      ],
    })
    // 每期不同倍率，保证本月/同期/累计各口径互不相等（否则断言恒等无意义）
    const periods: { period: string; fy: string; mult: number }[] = [
      { period: prevSameMonth, fy: prevFiscalYear, mult: 0.7 },
      { period: samePeriod, fy: prevFiscalYear, mult: 0.9 },
      { period: prevMonth, fy: fiscalYear, mult: 1.0 },
      { period: curPeriod, fy: fiscalYear, mult: 1.1 },
    ]
    const facts: { batchId: string; companyCode: string; accountCode: string; period: string; periodDimCode: string; fiscalYear: string; value: number }[] = []
    const budgets: { batchId: string; companyCode: string; accountCode: string; fiscalYear: string; period: string; value: number }[] = []
    leaves.forEach((l, i) => {
      const base = 10 + (i % 7) * 3
      for (const p of periods) {
        facts.push({ batchId, companyCode, accountCode: l.code, period: p.period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: p.fy, value: round2(base * p.mult) })
      }
      budgets.push({ batchId: budgetBatchId, companyCode, accountCode: l.code, fiscalYear, period: fiscalYear, value: 120 })
    })
    await basePrisma.factOperating.createMany({ data: facts })
    await basePrisma.factBudget.createMany({ data: budgets })
    await basePrisma.subjectBudgetConfig.create({ data: { companyCode, sortOrder: 9999, status: 'active' } })
    dbReady = true
  } catch (e) {
    console.error('[AnalysisQueryService.test] 夹具准备失败：', e)
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.factOperating.deleteMany({ where: { batchId } }).catch(() => undefined)
  await basePrisma.factBudget.deleteMany({ where: { batchId: budgetBatchId } }).catch(() => undefined)
  await basePrisma.importBatch.deleteMany({ where: { id: { in: [batchId, budgetBatchId] } } }).catch(() => undefined)
  await basePrisma.subjectBudgetConfig.deleteMany({ where: { companyCode } }).catch(() => undefined)
  await basePrisma.company.deleteMany({ where: { code: companyCode } }).catch(() => undefined)
  await basePrisma.$disconnect().catch(() => undefined)
})

describe('AnalysisQueryService 契约对照（真实 DB）', () => {
  it('category 维度：行集合/行序/每行口径与 getProductBudget 逐字段一致', async () => {
    if (!dbReady) return
    const keys = ['income', 'profit'].flatMap((g) => GROUP_KEYS.map((k) => `${g}.${k}`))
    const [old, res] = await Promise.all([
      DashboardService.getProductBudget(scope, { period: curPeriod, companyCode }),
      AnalysisQueryService.query(scope, { rowDim: 'category', period: curPeriod, companyCode, metrics: keys }),
    ])
    expect(res.rows.map((r) => r.name)).toEqual(old.rows.map((r) => r.category))
    expect(old.rows.length).toBeGreaterThan(0)
    res.rows.forEach((row, i) => {
      const o = old.rows[i]
      for (const g of ['income', 'profit'] as const) {
        const m = o[g]
        for (const k of DIRECT_KEYS) expect(row.values[`${g}.${k}`], `${g}.${k} @${o.category}`).toBe(m[k])
        expect(row.values[`${g}.annualBudget`]).toBe(m.budget)
        expect(row.values[`${g}.ytdBudget`]).toBe(m.ytdBudget)
        expect(row.values[`${g}.annualRate`]).toBe(m.ytdRate)
        expect(row.values[`${g}.monthChange`]).toBe(round2(m.monthActual - m.monthSame))
        expect(row.values[`${g}.ytdChange`]).toBe(round2(m.ytdActual - m.ytdSame))
      }
    })
  })

  it('product 维度：含空行（includeEmptyRows）时行集合与合计均与 getProductMetrics 一致', async () => {
    if (!dbReady) return
    const keys = ['income', 'profit'].flatMap((g) => GROUP_KEYS.map((k) => `${g}.${k}`))
    const [old, res] = await Promise.all([
      DashboardService.getProductMetrics(scope, { period: curPeriod, companyCode }),
      AnalysisQueryService.query(scope, { rowDim: 'product', period: curPeriod, companyCode, metrics: keys, options: { includeEmptyRows: true, includeTotals: true, level: null } }),
    ])
    expect(res.rows.map((r) => r.code)).toEqual(old.rows.map((r) => r.code))
    expect(res.rows.map((r) => r.name)).toEqual(old.rows.map((r) => r.name))
    res.rows.forEach((row, i) => {
      const o = old.rows[i]
      for (const g of ['income', 'profit'] as const) {
        // getProductMetrics 的 income/profit 本身即 KeyMetricsGroup，可直接逐字段对照
        const m = o[g]
        for (const k of DIRECT_KEYS) expect(row.values[`${g}.${k}`], `${g}.${k} @${o.name}`).toBe(m[k])
        expect(row.values[`${g}.annualBudget`]).toBe(m.annualBudget)
        expect(row.values[`${g}.ytdBudget`]).toBe(m.ytdBudget)
        expect(row.values[`${g}.annualRate`]).toBe(m.annualRate)
        expect(row.values[`${g}.monthChange`]).toBe(m.monthChange)
        expect(row.values[`${g}.ytdChange`]).toBe(m.ytdChange)
      }
    })
    expect(res.totals?.values['income.ytdActual']).toBe(old.totals.income.ytdActual)
    expect(res.totals?.values['profit.ytdActual']).toBe(old.totals.profit.ytdActual)
    expect(res.totals?.values['income.ytdBudget']).toBe(old.totals.income.ytdBudget)
  })

  it('expense 维度：行集合/行序/每行口径（含环比）与 getExpenseAnalysis 一致', async () => {
    if (!dbReady) return
    // monthChange / ytdChange / monthMomChange 为新增派生（旧接口无同名字段），单独断言
    const keys = [...DIRECT_KEYS, 'monthMom', 'ytdBudget', 'annualBudget', 'annualRate', 'monthChange', 'ytdChange', 'monthMomChange']
    const [old, res] = await Promise.all([
      DashboardService.getExpenseAnalysis(scope, { period: curPeriod, companyCode }),
      AnalysisQueryService.query(scope, { rowDim: 'expense', period: curPeriod, companyCode, metrics: keys }),
    ])
    expect(res.rows.map((r) => r.code)).toEqual(old.rows.map((r) => r.code))
    expect(old.rows.length).toBeGreaterThan(0)
    res.rows.forEach((row, i) => {
      const o = old.rows[i]
      expect(row.name).toBe(o.name)
      for (const k of DIRECT_KEYS) expect(row.values[k], `${k} @${o.name}`).toBe(o[k])
      expect(row.values['monthMom']).toBe(o.monthMom)
      expect(row.values['ytdBudget']).toBe(o.ytdBudget)
      expect(row.values['annualBudget']).toBe(o.budget)
      expect(row.values['annualRate']).toBe(o.ytdRate)
      expect(row.values['monthChange']).toBe(round2(o.monthActual - o.monthSame))
      expect(row.values['ytdChange']).toBe(round2(o.ytdActual - o.ytdSame))
      expect(row.values['monthMomChange']).toBe(round2(o.monthActual - o.monthPrev))
    })
  })

  it('company 维度：指定主体的收入/毛利/净利润口径与 getSubjectBudget 一致', async () => {
    if (!dbReady) return
    const keys = ['income', 'profit', 'netProfit'].flatMap((g) => GROUP_KEYS.map((k) => `${g}.${k}`))
    const [old, res] = await Promise.all([
      DashboardService.getSubjectBudget(scope, { period: curPeriod, companyCode, mode: 'single' }),
      AnalysisQueryService.query(scope, { rowDim: 'company', period: curPeriod, companyCode, metrics: keys, filters: { excludeReclassify: false, keyword: '', rowCodes: [companyCode] } }),
    ])
    const o = old.rows.find((r) => r.code === companyCode)
    expect(o).toBeTruthy()
    const row = res.rows.find((r) => r.code === companyCode)
    expect(row).toBeTruthy()
    expect(row!.name).toBe(o!.name)
    for (const g of ['income', 'profit', 'netProfit'] as const) {
      const m = o![g]
      for (const k of DIRECT_KEYS) expect(row!.values[`${g}.${k}`], `${g}.${k}`).toBe(m[k])
      expect(row!.values[`${g}.annualBudget`]).toBe(m.budget)
      expect(row!.values[`${g}.ytdBudget`]).toBe(m.ytdBudget)
      expect(row!.values[`${g}.annualRate`]).toBe(m.ytdRate)
      expect(row!.values[`${g}.ytdChange`]).toBe(round2(m.ytdActual - m.ytdSame))
    }
  })

  it('subject 维度：收入顶层节点的累计口径与 getKeyMetrics 的「收入」行一致', async () => {
    if (!dbReady) return
    const [old, res, tree] = await Promise.all([
      DashboardService.getKeyMetrics(scope, { period: curPeriod, companyCode }),
      AnalysisQueryService.query(scope, { rowDim: 'subject', period: curPeriod, companyCode, metrics: ['ytdActual', 'ytdBudget', 'monthActual', 'annualBudget'] }),
      AggregationService.buildOperatingTree([companyCode], curPeriod),
    ])
    const revenueRoot = flattenValueTree(tree).find((n) => n.category === '壹品慧收入' && n.level === 0)
    expect(revenueRoot).toBeTruthy()
    const oldIncome = old.rows.find((r) => r.key === 'income')
    const row = res.rows.find((r) => r.code === revenueRoot!.code)
    expect(row).toBeTruthy()
    expect(row!.name).toBe(revenueRoot!.name)
    expect(row!.values.ytdActual).toBe(oldIncome!.values.ytdActual)
    expect(row!.values.ytdBudget).toBe(oldIncome!.values.ytdBudget)
    expect(row!.values.monthActual).toBe(oldIncome!.values.monthActual)
    expect(row!.values.annualBudget).toBe(oldIncome!.values.annualBudget)
  })

  it('列定义随 metrics 下发，长度与顺序一致', async () => {
    if (!dbReady) return
    const metrics = ['income.ytdBudget', 'income.ytdActual', 'income.deviation', 'income.alertRate', 'income.share', 'marginRate']
    const res = await AnalysisQueryService.query(scope, { rowDim: 'category', period: curPeriod, companyCode, metrics })
    expect(res.columns.map((c) => c.key)).toEqual(metrics)
    expect(res.columns.map((c) => c.valueType)).toEqual(['amount', 'amount', 'amount', 'ratio', 'ratio', 'ratio'])
    expect(res.rows.length).toBeGreaterThan(0)
    // share 的分母来自合计行，故必须非 null（合计不为 0）
    expect(res.rows[0].values['income.share']).not.toBeNull()
    expect(res.totals?.values['income.share']).toBe(100)
  })

  it('回显生效口径（period/companyCode/companyName/companyType/degraded）', async () => {
    if (!dbReady) return
    const res = await AnalysisQueryService.query(scope, { rowDim: 'subject', period: curPeriod, companyCode, options: { includeEmptyRows: false, includeTotals: false, level: 0 } })
    expect(res.period).toBe(curPeriod)
    expect(res.companyCode).toBe(companyCode)
    expect(res.companyType).toBe('single')
    expect(res.degraded).toBe(false)
    expect(res.totals).toBeUndefined() // includeTotals=false
    expect(res.rows.length).toBeGreaterThan(0)
    expect(res.rows.every((r) => r.level === 0)).toBe(true)
  })

  describe('入参校验与边界', () => {
    it('非法指标 key → 400（不静默忽略）', async () => {
      if (!dbReady) return
      await expect(AnalysisQueryService.query(scope, { rowDim: 'subject', period: curPeriod, companyCode, metrics: ['nope'] }))
        .rejects.toMatchObject({ httpStatus: 400 })
    })

    it('单组维度使用带前缀 key → 400', async () => {
      if (!dbReady) return
      await expect(AnalysisQueryService.query(scope, { rowDim: 'expense', period: curPeriod, companyCode, metrics: ['income.ytdActual'] }))
        .rejects.toMatchObject({ httpStatus: 400 })
    })

    it('marginRate 用于单组维度 → 400', async () => {
      if (!dbReady) return
      await expect(AnalysisQueryService.query(scope, { rowDim: 'subject', period: curPeriod, companyCode, metrics: ['marginRate'] }))
        .rejects.toMatchObject({ httpStatus: 400 })
    })

    it('period 不在可用期间内 → 400', async () => {
      if (!dbReady) return
      await expect(AnalysisQueryService.query(scope, { rowDim: 'subject', period: '1999-01', companyCode }))
        .rejects.toMatchObject({ httpStatus: 400 })
    })

    it('metrics 空数组 → 400', async () => {
      if (!dbReady) return
      await expect(AnalysisQueryService.query(scope, { rowDim: 'subject', period: curPeriod, companyCode, metrics: [] }))
        .rejects.toMatchObject({ httpStatus: 400 })
    })

    it('rowDim 非法 → 400', async () => {
      if (!dbReady) return
      await expect(AnalysisQueryService.query(scope, { rowDim: 'nope' })).rejects.toMatchObject({ httpStatus: 400 })
    })

    it('filters.rowCodes 限定行成员', async () => {
      if (!dbReady) return
      const all = await AnalysisQueryService.query(scope, { rowDim: 'subject', period: curPeriod, companyCode, options: { includeEmptyRows: false, includeTotals: false, level: 0 } })
      expect(all.rows.length).toBeGreaterThan(1)
      const one = all.rows[0]
      const filtered = await AnalysisQueryService.query(scope, { rowDim: 'subject', period: curPeriod, companyCode, filters: { excludeReclassify: false, keyword: '', rowCodes: [one.code] } })
      expect(filtered.rows.map((r) => r.code)).toEqual([one.code])
    })

    it('filters.keyword 按行名过滤', async () => {
      if (!dbReady) return
      const all = await AnalysisQueryService.query(scope, { rowDim: 'subject', period: curPeriod, companyCode })
      const kw = all.rows[0].name.slice(0, 2)
      const filtered = await AnalysisQueryService.query(scope, { rowDim: 'subject', period: curPeriod, companyCode, filters: { excludeReclassify: false, keyword: kw, rowCodes: [] } })
      expect(filtered.rows.length).toBeGreaterThan(0)
      expect(filtered.rows.every((r) => r.name.includes(kw))).toBe(true)
    })

    it('无任何数据权限（越权主体降级）→ 空 rows 且 degraded，不报错', async () => {
      if (!dbReady) return
      const res = await AnalysisQueryService.query({ companyCode: null, scopeValue: '', dataScopeCodes: [] }, { rowDim: 'category', period: curPeriod, companyCode: 'NOT_EXIST_COMPANY' })
      expect(res.degraded).toBe(true)
      expect(res.rows).toEqual([])
    })
  })
})
