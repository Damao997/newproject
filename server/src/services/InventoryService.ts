import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { AggregationService, resolveCompanyCodes, flattenValueTree } from './AggregationService'
import { STATIC_DIMS, calcYoy } from '../lib/metric-values'
import { fiscalYearStartPeriod, periodMinusYears, formatPeriod, getFiscalStartMonth } from '../lib/period'
import type { AuthUserContext } from '../types/express'

/**
 * 存货管理服务：数据源为 fact_static（静态科目树「存货」下 13 个品类叶子科目），
 * 按 期间 × 公司 × 品类 聚合；周转指标直接复用静态树「存货周转天数」计算结果，
 * 与指标页口径完全一致（含公式计算层与 scope 过滤）。金额单位：万元。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & { dataScopeCodes?: string[] | null }

const INVENTORY_ROOT_NAME = '存货'
const TURNOVER_DAYS_NAME = '存货周转天数'

function round2(n: number): number {
  return Number(n.toFixed(2))
}

export interface InventoryCategoryRow {
  code: string
  name: string
  current: number
  yearStart: number
  samePeriod: number
  lastYearStart: number
  /** 占存货总额比例（%，总额 ≤0 时置 0） */
  share: number
  /** 同比增减率（%） */
  yoy: number
  /** 金额降序排名（1 起） */
  rank: number
}

export interface InventoryOverview {
  period: string
  companyCount: number
  total: { current: number; yearStart: number; samePeriod: number; lastYearStart: number }
  /** 存货周转天数（静态树跨维度公式；年初类时点列无口径，仅本期/同期） */
  turnoverDays: { current: number; samePeriod: number }
  categories: InventoryCategoryRow[]
}

export interface InventoryDetailRow {
  companyCode: string
  companyName: string
  companyShortName: string | null
  categoryCode: string
  categoryName: string
  current: number
  yearStart: number
  samePeriod: number
  lastYearStart: number
  yoy: number
}

export interface InventoryTrend {
  fiscalYear: string
  months: string[]
  total: number[]
  byCategory: { code: string; name: string; values: number[] }[]
}

interface InventorySubjects {
  rootCode: string
  categories: { code: string; name: string; orderNo: number }[]
  turnoverDaysCode: string | null
}

/** 解析静态科目树中的存货父节点、品类子科目与「存货周转天数」编码（不硬编码 ST_ 编码） */
async function resolveInventorySubjects(): Promise<InventorySubjects> {
  const root = await prisma.accountSubject.findFirst({
    where: { subjectType: 'static', name: INVENTORY_ROOT_NAME },
    select: { code: true },
  })
  if (!root) throw errors.notFound('静态科目树中不存在「存货」科目')
  const categories = await prisma.accountSubject.findMany({
    where: { subjectType: 'static', parentCode: root.code },
    orderBy: { orderNo: 'asc' },
    select: { code: true, name: true, orderNo: true },
  })
  const turnover = await prisma.accountSubject.findFirst({
    where: { subjectType: 'static', name: TURNOVER_DAYS_NAME },
    select: { code: true },
  })
  return { rootCode: root.code, categories, turnoverDaysCode: turnover?.code ?? null }
}

/** 公司多选归一化：未传 → 数据范围内全部单体；传入（单体/汇总主体）逐个展开取并集，越权 403 */
async function resolveCompanies(scope: Scope, companyCodes?: string[]): Promise<string[]> {
  if (!companyCodes || companyCodes.length === 0) return resolveCompanyCodes(scope)
  const out = new Set<string>()
  for (const c of companyCodes) {
    for (const r of await resolveCompanyCodes(scope, c)) out.add(r)
  }
  return [...out]
}

async function activeStaticBatchIds(): Promise<string[]> {
  const batches = await prisma.importBatch.findMany({
    where: { dataType: 'static', lifecycleStatus: 'active' },
    select: { id: true },
  })
  return batches.map((b) => b.id)
}

/** 快照日期 → 快照月份 `YYYY-MM`（UTC，口径与 buildStaticTree 一致） */
function snapshotMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export const InventoryService = {
  /** 总览：存货总额四维值 + 品类占比/排名 + 存货周转天数（复用静态聚合树） */
  async getOverview(scope: Scope, params: { companyCodes?: string[]; period: string }): Promise<InventoryOverview> {
    const subjects = await resolveInventorySubjects()
    const companies = await resolveCompanies(scope, params.companyCodes)
    const flat = flattenValueTree(await AggregationService.buildStaticTree(companies, params.period))
    const byCode = new Map(flat.map((n) => [n.code, n]))

    const rootValues = byCode.get(subjects.rootCode)?.values ?? {}
    const total = {
      current: rootValues[STATIC_DIMS.CURRENT_AMOUNT] ?? 0,
      yearStart: rootValues[STATIC_DIMS.YEAR_START] ?? 0,
      samePeriod: rootValues[STATIC_DIMS.SAME_PERIOD_AMOUNT] ?? 0,
      lastYearStart: rootValues[STATIC_DIMS.LAST_YEAR_START] ?? 0,
    }
    const turnoverValues = subjects.turnoverDaysCode ? byCode.get(subjects.turnoverDaysCode)?.values ?? {} : {}
    const turnoverDays = {
      current: turnoverValues[STATIC_DIMS.CURRENT_AMOUNT] ?? 0,
      samePeriod: turnoverValues[STATIC_DIMS.SAME_PERIOD_AMOUNT] ?? 0,
    }

    const categories = subjects.categories
      .map((c) => {
        const v = byCode.get(c.code)?.values ?? {}
        const current = v[STATIC_DIMS.CURRENT_AMOUNT] ?? 0
        const samePeriod = v[STATIC_DIMS.SAME_PERIOD_AMOUNT] ?? 0
        return {
          code: c.code,
          name: c.name,
          current,
          yearStart: v[STATIC_DIMS.YEAR_START] ?? 0,
          samePeriod,
          lastYearStart: v[STATIC_DIMS.LAST_YEAR_START] ?? 0,
          share: total.current > 0 ? round2((current / total.current) * 100) : 0,
          yoy: calcYoy(current, samePeriod),
          rank: 0,
        }
      })
      .sort((a, b) => b.current - a.current)
    categories.forEach((c, i) => { c.rank = i + 1 })

    return { period: params.period, companyCount: companies.length, total, turnoverDays, categories }
  },

  /** 明细：公司 × 品类行（本期 / 年初 / 同期），直接对 fact_static 品类叶子按快照月归集 */
  async getDetails(scope: Scope, params: { companyCodes?: string[]; period: string }): Promise<{ period: string; rows: InventoryDetailRow[] }> {
    const subjects = await resolveInventorySubjects()
    const companies = await resolveCompanies(scope, params.companyCodes)
    const catCodes = subjects.categories.map((c) => c.code)
    if (companies.length === 0 || catCodes.length === 0) return { period: params.period, rows: [] }

    const batchIds = await activeStaticBatchIds()
    if (batchIds.length === 0) return { period: params.period, rows: [] }

    const targetMonths = {
      current: params.period,
      yearStart: fiscalYearStartPeriod(params.period),
      samePeriod: periodMinusYears(params.period, 1),
      lastYearStart: fiscalYearStartPeriod(periodMinusYears(params.period, 1)),
    }
    const grouped = await prisma.factStatic.groupBy({
      by: ['companyCode', 'accountCode', 'snapshotDate'],
      where: { companyCode: { in: companies }, accountCode: { in: catCodes }, batchId: { in: batchIds } },
      _sum: { value: true },
    })
    // (公司|品类|月份) → 金额（同月多快照日期合计）
    const monthSum = new Map<string, number>()
    for (const g of grouped) {
      const k = `${g.companyCode}|${g.accountCode}|${snapshotMonth(g.snapshotDate as Date)}`
      monthSum.set(k, (monthSum.get(k) ?? 0) + Number(g._sum.value ?? 0))
    }
    const pick = (company: string, acc: string, mon: string): number | undefined => monthSum.get(`${company}|${acc}|${mon}`)

    const companyRows = await prisma.company.findMany({
      where: { code: { in: companies } },
      orderBy: { orderNo: 'asc' },
      select: { code: true, name: true, shortName: true },
    })

    const rows: InventoryDetailRow[] = []
    for (const co of companyRows) {
      for (const cat of subjects.categories) {
        const current = pick(co.code, cat.code, targetMonths.current)
        const yearStart = pick(co.code, cat.code, targetMonths.yearStart)
        const samePeriod = pick(co.code, cat.code, targetMonths.samePeriod)
        const lastYearStart = pick(co.code, cat.code, targetMonths.lastYearStart)
        // 三个主月份均无数据的组合不出行，避免明细表被空行淹没
        if (current === undefined && yearStart === undefined && samePeriod === undefined) continue
        rows.push({
          companyCode: co.code,
          companyName: co.name,
          companyShortName: co.shortName,
          categoryCode: cat.code,
          categoryName: cat.name,
          current: round2(current ?? 0),
          yearStart: round2(yearStart ?? 0),
          samePeriod: round2(samePeriod ?? 0),
          lastYearStart: round2(lastYearStart ?? 0),
          yoy: calcYoy(round2(current ?? 0), round2(samePeriod ?? 0)),
        })
      }
    }
    return { period: params.period, rows }
  },

  /** 趋势：财年内各月存货总额与品类值（月份取实际存在快照的月份，升序） */
  async getTrend(scope: Scope, params: { companyCodes?: string[]; fiscalYear: string }): Promise<InventoryTrend> {
    if (!/^FY\d{4}$/.test(params.fiscalYear)) throw errors.badRequest('财年格式应为 FYxxxx')
    const subjects = await resolveInventorySubjects()
    const companies = await resolveCompanies(scope, params.companyCodes)
    const catCodes = subjects.categories.map((c) => c.code)
    const empty: InventoryTrend = { fiscalYear: params.fiscalYear, months: [], total: [], byCategory: [] }
    if (companies.length === 0 || catCodes.length === 0) return empty

    const batchIds = await activeStaticBatchIds()
    if (batchIds.length === 0) return empty

    const startYear = Number(params.fiscalYear.slice(2))
    const startMonth = getFiscalStartMonth()
    const fyStart = formatPeriod(startYear, startMonth)
    const fyEnd = formatPeriod(startYear, startMonth + 11)

    const grouped = await prisma.factStatic.groupBy({
      by: ['accountCode', 'snapshotDate'],
      where: { companyCode: { in: companies }, accountCode: { in: catCodes }, batchId: { in: batchIds } },
      _sum: { value: true },
    })
    // (品类|月份) → 金额，仅保留财年区间内的快照月
    const monthSum = new Map<string, number>()
    const monthSet = new Set<string>()
    for (const g of grouped) {
      const mon = snapshotMonth(g.snapshotDate as Date)
      if (mon < fyStart || mon > fyEnd) continue
      monthSet.add(mon)
      const k = `${g.accountCode}|${mon}`
      monthSum.set(k, (monthSum.get(k) ?? 0) + Number(g._sum.value ?? 0))
    }
    const months = [...monthSet].sort()
    const byCategory = subjects.categories.map((c) => ({
      code: c.code,
      name: c.name,
      values: months.map((m) => round2(monthSum.get(`${c.code}|${m}`) ?? 0)),
    }))
    const total = months.map((_, i) => round2(byCategory.reduce((sum, c) => sum + (c.values[i] ?? 0), 0)))
    return { fiscalYear: params.fiscalYear, months, total, byCategory }
  },
}
