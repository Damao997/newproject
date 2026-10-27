import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { AnalysisQueryService } from './AnalysisQueryService'
import { applyColFilter } from './analysis/row-adapters'
import { resolveColMembers } from './analysis/col-members'
import { OPERATING_DIMS } from '../lib/metric-values'
import type { ValueNode } from './AggregationService'

/**
 * 即席分析矩阵模式（v2 colDim）契约测试（真实 DB）。
 *
 * 核心不变量：**互斥列成员下逐单元求和 == 行小计（__total）**。
 * 列成员 = 单体公司（互斥完备）时，Σ cells[各单体] 应等于全量切片（= v1 单轴口径），
 * 这是矩阵聚合正确性的关键断言，任何行列交叉取数错误都会在此暴露。
 *
 * 夹具：1 汇总主体 + 3 个互斥单体（同一 suffix），各自带 2099-06 当月/同期/累计与 FY2099 预算事实。
 * 无 DB 时整组跳过（与 AnalysisQueryService.test 同策略）。
 */

let dbReady = false
const suffix = `MX${Date.now().toString(36)}`
const summaryCode = `ETMX${suffix}`.slice(0, 20)
const singles = ['ENMX1', 'ENMX2', 'ENMX3'].map((c) => `${c}${suffix}`.slice(0, 20))
const period = '2099-06'
const batchId = `batchmx_${suffix}`
const budgetBatchId = `batchmxb_${suffix}`
/** 列成员回归夹具：品类配置（关键词 = 真实收入叶子名），断言其命中科目集非空 */
const catCode = `MXCAT${suffix}`.slice(0, 20)
let incomeLeafCode = ''
const scope = { companyCode: null, scopeValue: '*', dataScopeCodes: null }

const round2 = (n: number): number => Number(n.toFixed(2))

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const leaves = await basePrisma.accountSubject.findMany({
      where: { subjectType: 'operating', status: 'active', isLeaf: true },
      select: { code: true },
    })
    if (leaves.length === 0) return
    // 汇总主体 + 3 单体 + 聚合映射（互斥成员集合）
    await basePrisma.company.create({
      data: { code: summaryCode, name: `矩阵测试汇总_${suffix}`, entityType: 'summary', status: 'active' },
    })
    await basePrisma.company.createMany({
      data: singles.map((c) => ({ code: c, name: `矩阵测试_${c}`, entityType: 'single', status: 'active' })),
    })
    await basePrisma.companyAggregationMap.createMany({
      data: singles.map((c) => ({ singleCompanyCode: c, summaryCompanyCode: summaryCode })),
    })
    await basePrisma.importBatch.createMany({
      data: [
        { id: batchId, fileName: 'mx-operating.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'active', fiscalYear: 'FY2099' },
        { id: budgetBatchId, fileName: 'mx-budget.xlsx', status: 'success', dataType: 'budget', lifecycleStatus: 'active', fiscalYear: 'FY2099' },
      ],
    })
    // 每公司不同倍率（0.8/1.0/1.2），保证逐公司值互不相等（否则求和断言恒真无意义）
    const mults = [0.8, 1.0, 1.2]
    const facts: { batchId: string; companyCode: string; accountCode: string; period: string; periodDimCode: string; fiscalYear: string; value: number }[] = []
    const budgets: { batchId: string; companyCode: string; accountCode: string; fiscalYear: string; period: string; value: number }[] = []
    singles.forEach((c, ci) => {
      leaves.forEach((l, i) => {
        const base = 10 + (i % 5) * 4
        facts.push({ batchId, companyCode: c, accountCode: l.code, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2099', value: round2(base * mults[ci]) })
      })
      budgets.push({ batchId: budgetBatchId, companyCode: c, accountCode: 'PL0101', fiscalYear: 'FY2099', period: 'FY2099', value: 100 + ci * 50 })
    })
    await basePrisma.factOperating.createMany({ data: facts })
    await basePrisma.factBudget.createMany({ data: budgets })
    // 列成员来源：subjectBudgetConfig（3 个单体）
    await basePrisma.subjectBudgetConfig.createMany({
      data: singles.map((c, i) => ({ companyCode: c, sortOrder: 100 + i, status: 'active' as const })),
    })
    // 列成员回归夹具：品类配置的关键词取真实收入叶子名（保证必然命中）
    const incomeLeaf = await basePrisma.accountSubject.findFirst({
      where: { subjectType: 'operating', status: 'active', isLeaf: true, category: '壹品慧收入' },
      select: { code: true, name: true },
    })
    if (incomeLeaf) {
      incomeLeafCode = incomeLeaf.code
      await basePrisma.productCategory.create({
        data: { code: catCode, name: `矩阵品类_${suffix}`, subjectKeyword: incomeLeaf.name, sortOrder: 900, status: 'active' },
      })
    }
    dbReady = true
  } catch (e) {
    console.error('[AnalysisQueryMatrix.test] 夹具准备失败：', e)
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.factOperating.deleteMany({ where: { batchId } }).catch(() => undefined)
  await basePrisma.factBudget.deleteMany({ where: { batchId: budgetBatchId } }).catch(() => undefined)
  await basePrisma.importBatch.deleteMany({ where: { id: { in: [batchId, budgetBatchId] } } }).catch(() => undefined)
  await basePrisma.subjectBudgetConfig.deleteMany({ where: { companyCode: { in: singles } } }).catch(() => undefined)
  await basePrisma.productCategory.deleteMany({ where: { code: catCode } }).catch(() => undefined)
  await basePrisma.companyAggregationMap.deleteMany({ where: { summaryCompanyCode: summaryCode } }).catch(() => undefined)
  await basePrisma.company.deleteMany({ where: { code: { in: [summaryCode, ...singles] } } }).catch(() => undefined)
  await basePrisma.$disconnect().catch(() => undefined)
})

const METRICS = ['income.monthActual', 'income.ytdActual', 'income.ytdBudget', 'profit.monthActual']

describe('resolveColMembers 列成员解析（真实 DB）', () => {
  it('品类成员命中科目非空且含被配置叶子（关键词扫描须基于扁平树）', async () => {
    if (!dbReady || !incomeLeafCode) return
    const members = await resolveColMembers('category')
    const mine = members.find((m) => m.code === catCode)
    expect(mine, '夹具品类配置应出现在列成员中').toBeDefined()
    expect(mine!.subjectCodes.length, '命中科目集为空 = 关键词只扫了根节点（T28 回归）').toBeGreaterThan(0)
    expect(mine!.subjectCodes).toContain(incomeLeafCode)
  })
})

describe('applyColFilter（纯函数）', () => {
  const leaf = (code: string, values: Record<string, number> = {}): ValueNode => ({
    code, name: code, level: 3, category: '壹品慧收入', dataType: 'data', direction: 'credit',
    valueType: 'amount', isLeaf: true, values, children: [],
  })
  const tree = (): ValueNode[] => [{
    code: 'ROOT', name: 'ROOT', level: 1, category: '壹品慧收入', dataType: 'data', direction: 'credit',
    valueType: 'amount', isLeaf: false, values: {},
    children: [leaf('B'), leaf('C')],
  }]

  it('空/undefined 过滤返回原树', () => {
    expect(applyColFilter(tree(), undefined)).toEqual(tree())
    expect(applyColFilter(tree(), null)).toEqual(tree())
    expect(applyColFilter(tree(), new Set())).toEqual(tree())
  })

  it('命中叶子：保留该叶子及其祖先链', () => {
    const out = applyColFilter(tree(), new Set(['B']))
    expect(out.length).toBe(1)
    expect(out[0].code).toBe('ROOT')
    expect(out[0].children.map((c) => c.code)).toEqual(['B'])
    expect(out[0].isLeaf).toBe(false)
  })

  it('命中非叶子：整枝保留（不再对后代筛选，防与聚合值重复求和）', () => {
    const out = applyColFilter(tree(), new Set(['ROOT']))
    expect(out[0].children.map((c) => c.code)).toEqual(['B', 'C'])
  })

  it('多个叶子命中：各自保留', () => {
    const out = applyColFilter(tree(), new Set(['B', 'C']))
    expect(out[0].children.map((c) => c.code)).toEqual(['B', 'C'])
  })
})

describe('AnalysisQueryService 矩阵模式（colDim）', () => {
  it('列维度不能与行维度相同（schema 层 400）', async () => {
    if (!dbReady) return
    await expect(
      AnalysisQueryService.query(scope, { rowDim: 'category', colDim: 'category', period, companyCode: summaryCode }),
    ).rejects.toThrow(/列维度不能与行维度相同/)
  })

  it('v1 兼容：无 colDim 时响应不含 cells / colMembers 字段', async () => {
    if (!dbReady) return
    const res = await AnalysisQueryService.query(scope, { rowDim: 'category', period, companyCode: summaryCode, metrics: METRICS })
    expect(res.rows.length).toBeGreaterThan(0)
    expect(res.rows[0].cells).toBeUndefined()
    expect(res.colDim).toBeUndefined()
    expect(res.colMembers).toBeUndefined()
  })

  it('colDim=company × rowDim=category：互斥列成员逐单元求和 == __total（核心不变量）', async () => {
    if (!dbReady) return
    const res = await AnalysisQueryService.query(scope, { rowDim: 'category', colDim: 'company', colCodes: singles, period, companyCode: summaryCode, metrics: METRICS })
    expect(res.colDim).toBe('company')
    expect(res.colMembers?.map((m) => m.code)).toEqual(singles)
    expect(res.rows.length).toBeGreaterThan(0)
    for (const row of res.rows) {
      expect(row.cells).toBeDefined()
      for (const key of METRICS) {
        // null = 无预算口径（前端显示「—」），求和时按 0 计，与 __total 的 null 归一后比较
        const sum = round2(singles.reduce((acc, c) => acc + (row.cells?.[c]?.[key] ?? 0), 0))
        expect(sum, `${key} @${row.name}`).toBe(row.cells?.__total?.[key] ?? 0)
      }
    }
  })

  it('colDim=company × rowDim=subject：科目行同样满足互斥求和恒等（比率类科目除外——比率不可横加）', async () => {
    if (!dbReady) return
    const res = await AnalysisQueryService.query(scope, { rowDim: 'subject', colDim: 'company', colCodes: singles, period, companyCode: summaryCode, metrics: ['monthActual', 'ytdActual'] })
    const ratioRows = await basePrisma.accountSubject.findMany({
      where: { code: { in: res.rows.map((r) => r.code) }, valueType: 'ratio' },
      select: { code: true },
    })
    const ratioCodes = new Set(ratioRows.map((r) => r.code))
    expect(res.rows.length).toBeGreaterThan(0)
    expect(ratioCodes.size).toBeGreaterThan(0) // 夹具必然含比率科目（壹品慧毛利率），排除逻辑不能空转
    for (const row of res.rows) {
      if (ratioCodes.has(row.code)) continue
      const sum = round2(singles.reduce((acc, c) => acc + (row.cells?.[c]?.['monthActual'] ?? 0), 0))
      expect(sum, `@${row.name}`).toBe(row.cells?.__total?.['monthActual'] ?? 0)
    }
  })

  it('colCodes 过滤列成员：只返回指定成员，cells 不含被过滤成员', async () => {
    if (!dbReady) return
    const res = await AnalysisQueryService.query(scope, { rowDim: 'category', colDim: 'company', colCodes: [singles[0], singles[2]], period, companyCode: summaryCode, metrics: METRICS })
    expect(res.colMembers?.map((m) => m.code)).toEqual([singles[0], singles[2]])
    for (const row of res.rows) {
      expect(Object.keys(row.cells ?? {}).sort()).toEqual([singles[0], singles[2], '__total'].sort())
    }
  })

  it('colDim=product × rowDim=category：科目维度作列成员，行列正交缺失不产 cell', async () => {
    if (!dbReady) return
    const res = await AnalysisQueryService.query(scope, { rowDim: 'category', colDim: 'product', period, companyCode: summaryCode, metrics: METRICS })
    expect(res.colDim).toBe('product')
    const memberCount = res.colMembers?.length ?? 0
    expect(memberCount).toBeGreaterThan(0)
    // 语义：列切片中不存在的行不产出 cell（前端渲染「—」）。
    // 产品列 = 该产品命中科目集过滤聚合树，品类行若不在该科目集内则整行不存在——
    // 「每行每列都有 cell」只在过滤失效（空科目集不过滤）时成立，那是 bug 不是特性（T28 回归）。
    const kitchen = res.rows.find((r) => r.name.includes('厨房'))
    expect(kitchen, '夹具/种子品类应含厨房产品行').toBeDefined()
    if (kitchen) {
      const kitchenMember = (res.colMembers ?? []).find((m) => m.name.includes('厨房'))
      const securityMember = (res.colMembers ?? []).find((m) => m.name.includes('安检'))
      if (kitchenMember) expect(kitchen.cells?.[kitchenMember.code], '厨房品类行在厨房产品列应有 cell').toBeDefined()
      if (securityMember) expect(kitchen.cells?.[securityMember.code], '厨房品类行在安检产品列不应有 cell（科目集不相交）').toBeUndefined()
    }
    for (const row of res.rows) {
      expect(row.cells?.__total).toBeDefined()
    }
  })

  it('列成员上限：colCodes 超 50 被 schema 拒绝', async () => {
    if (!dbReady) return
    const tooMany = Array.from({ length: 51 }, (_, i) => `C${i}`)
    await expect(
      AnalysisQueryService.query(scope, { rowDim: 'category', colDim: 'company', colCodes: tooMany, period, companyCode: summaryCode }),
    ).rejects.toThrow(/colCodes|at most/)
  })

  it('矩阵 totals 与 v1 单轴一致（合计口径不漂移）', async () => {
    if (!dbReady) return
    const [v1, v2] = await Promise.all([
      AnalysisQueryService.query(scope, { rowDim: 'category', period, companyCode: summaryCode, metrics: METRICS }),
      AnalysisQueryService.query(scope, { rowDim: 'category', colDim: 'company', colCodes: singles, period, companyCode: summaryCode, metrics: METRICS }),
    ])
    expect(v2.totals?.values).toEqual(v1.totals?.values)
  })
})
