import { prisma } from '../lib/prisma'
import { AggregationService, resolveCompanyCodes, flattenValueTree, type ValueNode, type ReclassifyReversalMeta } from './AggregationService'
import { OPERATING_DIMS, STATIC_DIMS, calcYoy, calcAchievement } from '../lib/metric-values'
import { buildExcel } from '../lib/excel'
import { errors } from '../lib/errors'
import { fiscalYearLabel, getFiscalStartMonth } from '../lib/period'
import type { AuthUserContext } from '../types/express'

/**
 * 财务指标服务：科目树、经营/静态指标聚合、单指标详情、交叉表、导出。
 * 同比/达成率由后端计算，不存库（见 CLAUDE.md 公式计算铁律）。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & { dataScopeCodes?: string[] | null }

export interface OperatingRow {
  code: string
  name: string
  level: number
  category: string
  dataType: string
  valueType: string
  isLeaf: boolean
  budget: number
  actual: number
  samePeriod: number
  ytd: number
  samePeriodYtd: number
  yoy: number
  achievement: number
  ytdYoy: number
  children?: OperatingRow[]
}

export interface StaticRow {
  code: string
  name: string
  level: number
  category: string
  dataType: string
  valueType: string
  isLeaf: boolean
  current: number
  yearStart: number
  samePeriod: number
  lastYearStart: number
  yoy: number
  children?: StaticRow[]
}

function serializeOperating(node: ValueNode): OperatingRow {
  const v = node.values
  const budget = v[OPERATING_DIMS.BUDGET_AMOUNT] ?? 0
  const actual = v[OPERATING_DIMS.ACTUAL_MONTH] ?? 0
  const samePeriod = v[OPERATING_DIMS.SAME_PERIOD_ACTUAL] ?? 0
  const ytd = v[OPERATING_DIMS.YTD_ACTUAL] ?? 0
  const samePeriodYtd = v[OPERATING_DIMS.SAME_PERIOD_YTD] ?? 0
  // 比率类科目同比用百分点差（pp），避免相对变化率误导（20%→22% 不应显示 +10%）
  const isRatio = node.valueType === 'ratio'
  return {
    code: node.code, name: node.name, level: node.level, category: node.category,
    dataType: node.dataType, valueType: node.valueType, isLeaf: node.isLeaf,
    budget, actual, samePeriod, ytd, samePeriodYtd,
    yoy: isRatio ? round2pp((actual - samePeriod) * 100) : calcYoy(actual, samePeriod),
    // 预算为全年值，达成率用本年累计作分子（避免月实际/年预算的口径错配）
    achievement: calcAchievement(ytd, budget),
    ytdYoy: isRatio ? round2pp((ytd - samePeriodYtd) * 100) : calcYoy(ytd, samePeriodYtd),
    children: node.children.map(serializeOperating),
  }
}

function round2pp(n: number): number {
  return Number(n.toFixed(2))
}

function serializeStatic(node: ValueNode): StaticRow {
  const v = node.values
  const current = v[STATIC_DIMS.CURRENT_AMOUNT] ?? 0
  const yearStart = v[STATIC_DIMS.YEAR_START] ?? 0
  const samePeriod = v[STATIC_DIMS.SAME_PERIOD_AMOUNT] ?? 0
  const lastYearStart = v[STATIC_DIMS.LAST_YEAR_START] ?? 0
  const isRatio = node.valueType === 'ratio'
  return {
    code: node.code, name: node.name, level: node.level, category: node.category,
    dataType: node.dataType, valueType: node.valueType, isLeaf: node.isLeaf,
    current, yearStart, samePeriod, lastYearStart,
    yoy: isRatio ? round2pp((current - samePeriod) * 100) : calcYoy(current, samePeriod),
    children: node.children.map(serializeStatic),
  }
}

/** 结构化科目树（仅结构，无数值） */
async function structuralTree(subjectType: 'operating' | 'static'): Promise<unknown[]> {
  const rows = await prisma.accountSubject.findMany({
    where: { subjectType },
    orderBy: { orderNo: 'asc' },
    select: { code: true, name: true, level: true, parentCode: true, category: true, valueType: true },
  })
  const metrics = await prisma.metric.findMany({ select: { code: true, dataType: true } })
  const dt = new Map(metrics.map((m) => [m.code, m.dataType]))
  interface Node { code: string; name: string; level: number; category: string; dataType: string; valueType: string; children: Node[] }
  const byCode = new Map<string, Node>()
  const roots: Node[] = []
  for (const r of rows) {
    byCode.set(r.code, { code: r.code, name: r.name, level: r.level, category: r.category, dataType: dt.get(r.code) ?? 'data', valueType: r.valueType, children: [] })
  }
  for (const r of rows) {
    const n = byCode.get(r.code) as Node
    if (r.parentCode && byCode.has(r.parentCode)) byCode.get(r.parentCode)?.children.push(n)
    else roots.push(n)
  }
  return roots
}

/** 最新经营期间（全部 active 批次内的最大 period），无数据回退 2025-06 */
export async function latestOperatingPeriod(): Promise<string> {
  const batches = await prisma.importBatch.findMany({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
  if (batches.length === 0) return '2025-06'
  const row = await prisma.factOperating.findFirst({
    where: { batchId: { in: batches.map((b) => b.id) } },
    orderBy: { period: 'desc' },
    select: { period: true },
  })
  return row?.period ?? '2025-06'
}

/** 最新静态快照期间（全部 active 静态批次内最大快照月），无则回退最新经营期 */
export async function latestStaticPeriod(): Promise<string> {
  const batches = await prisma.importBatch.findMany({ where: { dataType: 'static', lifecycleStatus: 'active' }, select: { id: true } })
  if (batches.length === 0) return latestOperatingPeriod()
  const row = await prisma.factStatic.findFirst({
    where: { batchId: { in: batches.map((b) => b.id) } },
    orderBy: { snapshotDate: 'desc' },
    select: { snapshotDate: true },
  })
  if (!row) return latestOperatingPeriod()
  const d = row.snapshotDate
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export const IndicatorsService = {
  async getTree(subjectType: 'operating' | 'static'): Promise<unknown[]> {
    return structuralTree(subjectType)
  },

  async getOperating(scope: Scope, params: { companyCode?: string; period?: string; excludeReclassify?: boolean }): Promise<{ items: OperatingRow[]; total: number; period: string; companyCount: number; reclassifyExcluded: boolean; skippedReclassifyLogs: number }> {
    const companyCodes = await resolveCompanyCodes(scope, params.companyCode)
    const period = params.period || (await latestOperatingPeriod())
    const meta: ReclassifyReversalMeta = { appliedLogs: 0, skippedLogs: 0 }
    const tree = await AggregationService.buildOperatingTree(companyCodes, period, params.excludeReclassify ? { excludeReclassify: true, reclassifyMeta: meta } : undefined)
    const items = tree.map(serializeOperating)
    const total = flattenValueTree(tree).length
    return { items, total, period, companyCount: companyCodes.length, reclassifyExcluded: !!params.excludeReclassify, skippedReclassifyLogs: meta.skippedLogs }
  },

  async getStatic(scope: Scope, params: { companyCode?: string; period?: string; excludeReclassify?: boolean }): Promise<{ items: StaticRow[]; total: number; period: string; companyCount: number; reclassifyExcluded: boolean; skippedReclassifyLogs: number }> {
    const companyCodes = await resolveCompanyCodes(scope, params.companyCode)
    const period = params.period || (await latestStaticPeriod())
    const meta: ReclassifyReversalMeta = { appliedLogs: 0, skippedLogs: 0 }
    const tree = await AggregationService.buildStaticTree(companyCodes, period, params.excludeReclassify ? { excludeReclassify: true, reclassifyMeta: meta } : undefined)
    const items = tree.map(serializeStatic)
    const total = flattenValueTree(tree).length
    return { items, total, period, companyCount: companyCodes.length, reclassifyExcluded: !!params.excludeReclassify, skippedReclassifyLogs: meta.skippedLogs }
  },

  async getByCode(scope: Scope, code: string, params: { companyCode?: string; period?: string }): Promise<OperatingRow | StaticRow> {
    const subject = await prisma.accountSubject.findUnique({ where: { code }, select: { subjectType: true } })
    if (!subject) throw errors.notFound('科目不存在')
    if (subject.subjectType === 'operating') {
      const { items } = await this.getOperating(scope, params)
      const found = findRow(items, code)
      if (!found) throw errors.notFound('指标无数据')
      return found
    }
    const { items } = await this.getStatic(scope, params)
    const found = findRow(items, code)
    if (!found) throw errors.notFound('指标无数据')
    return found
  },

  /** 交叉表：指标（行）× 公司（列）的本月实际（经营）或本期金额（静态）；未指定 metricCodes 时返回全部层级科目（树前序）供前端展开浏览 */
  async getCross(scope: Scope, body: { companyCodes?: string[]; metricCodes?: string[]; period?: string; subjectType?: 'operating' | 'static' }): Promise<{ period: string; companies: string[]; rows: { code: string; name: string; valueType: string; level: number; parentCode: string | null; isLeaf: boolean; values: Record<string, number> }[] }> {
    const subjectType = body.subjectType === 'static' ? 'static' : 'operating'
    const scopeCompanies = await resolveCompanyCodes(scope)
    // 请求的公司码（可能含汇总主体）逐个经映射展开为单体成员，再取权限交集
    let companies: string[]
    if (body.companyCodes && body.companyCodes.length > 0) {
      const expanded: string[] = []
      for (const c of body.companyCodes) {
        expanded.push(...(await resolveCompanyCodes(scope, c)))
      }
      const scopeSet = new Set(scopeCompanies)
      companies = Array.from(new Set(expanded)).filter((c) => scopeSet.has(c))
    } else {
      companies = scopeCompanies
    }
    const period = body.period || (subjectType === 'static' ? await latestStaticPeriod() : await latestOperatingPeriod())

    // 逐公司聚合，取对应维度值
    const targetDim = subjectType === 'static' ? STATIC_DIMS.CURRENT_AMOUNT : OPERATING_DIMS.ACTUAL_MONTH
    const perCompany = new Map<string, Map<string, number>>()
    for (const cc of companies) {
      const tree = subjectType === 'static'
        ? await AggregationService.buildStaticTree([cc], period)
        : await AggregationService.buildOperatingTree([cc], period)
      const flat = flattenValueTree(tree)
      const m = new Map<string, number>()
      for (const n of flat) m.set(n.code, n.values[targetDim] ?? 0)
      perCompany.set(cc, m)
    }

    // 行元信息：全量 active 科目（按 orderNo），附层级/父码/叶子标记
    const subjects = await prisma.accountSubject.findMany({
      where: { subjectType },
      orderBy: { orderNo: 'asc' },
      select: { code: true, name: true, valueType: true, level: true, parentCode: true, isLeaf: true },
    })
    const metaMap = new Map(subjects.map((s) => [s.code, s]))
    // 行顺序：指定 metricCodes 按传入顺序；否则按科目树前序（保证父在前、子紧随其后，便于前端展开）
    let codes: string[]
    if (body.metricCodes && body.metricCodes.length > 0) {
      codes = body.metricCodes
    } else {
      const childrenMap = new Map<string, string[]>()
      const roots: string[] = []
      for (const s of subjects) {
        if (s.parentCode && metaMap.has(s.parentCode)) {
          const list = childrenMap.get(s.parentCode) ?? []
          list.push(s.code)
          childrenMap.set(s.parentCode, list)
        } else {
          roots.push(s.code)
        }
      }
      codes = []
      const walk = (code: string): void => {
        codes.push(code)
        for (const ch of childrenMap.get(code) ?? []) walk(ch)
      }
      roots.forEach(walk)
    }

    const rows = codes.map((code) => {
      const meta = metaMap.get(code)
      const values: Record<string, number> = {}
      for (const cc of companies) values[cc] = perCompany.get(cc)?.get(code) ?? 0
      return {
        code,
        name: meta?.name ?? code,
        valueType: (meta?.valueType as string) ?? 'amount',
        level: meta?.level ?? 0,
        parentCode: meta?.parentCode ?? null,
        isLeaf: meta?.isLeaf ?? true,
        values,
      }
    })
    return { period, companies, rows }
  },

  /** 可用期间与财年列表：汇总全部 active 经营批次的期间，财年由期间派生（降序） */
  async getAvailablePeriods(): Promise<{ periods: string[]; fiscalYears: string[]; fiscalStartMonth: number }> {
    const batches = await prisma.importBatch.findMany({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
    if (batches.length === 0) return { periods: [], fiscalYears: [], fiscalStartMonth: getFiscalStartMonth() }
    const rows = await prisma.factOperating.findMany({
      where: { batchId: { in: batches.map((b) => b.id) } },
      distinct: ['period'],
      orderBy: { period: 'asc' },
      select: { period: true },
    })
    const periods = rows.map((r) => r.period)
    const fiscalYears = [...new Set(periods.map((p) => fiscalYearLabel(p)))].sort().reverse()
    return { periods, fiscalYears, fiscalStartMonth: getFiscalStartMonth() }
  },

  /** 导出经营/静态指标为 Excel */
  async exportIndicators(scope: Scope, subjectType: 'operating' | 'static', params: { companyCode?: string; period?: string }): Promise<Buffer> {
    if (subjectType === 'static') {
      const { items } = await this.getStatic(scope, params)
      const flat = flattenRows(items)
      return buildExcel('静态指标', [
        { header: '编码', key: 'code' }, { header: '名称', key: 'name', width: 28 },
        { header: '本期金额', key: 'current' }, { header: '年初金额', key: 'yearStart' },
        { header: '同期金额', key: 'samePeriod' }, { header: '上年年初', key: 'lastYearStart' },
        { header: '同比(%)', key: 'yoy' },
      ], flat as unknown as Record<string, unknown>[])
    }
    const { items } = await this.getOperating(scope, params)
    const flat = flattenRows(items)
    return buildExcel('经营指标', [
      { header: '编码', key: 'code' }, { header: '名称', key: 'name', width: 28 },
      { header: '预算金额', key: 'budget' }, { header: '本月实际', key: 'actual' },
      { header: '同期实际', key: 'samePeriod' }, { header: '本年累计', key: 'ytd' },
      { header: '同期累计', key: 'samePeriodYtd' }, { header: '同比(%)', key: 'yoy' },
      { header: '达成率(%)', key: 'achievement' },
    ], flat as unknown as Record<string, unknown>[])
  },
}

function findRow<T extends { code: string; children?: T[] }>(rows: T[], code: string): T | null {
  for (const r of rows) {
    if (r.code === code) return r
    if (r.children) {
      const f = findRow(r.children, code)
      if (f) return f
    }
  }
  return null
}

function flattenRows<T extends { children?: T[] }>(rows: T[]): T[] {
  const out: T[] = []
  const walk = (list: T[]): void => {
    for (const r of list) {
      out.push(r)
      if (r.children) walk(r.children)
    }
  }
  walk(rows)
  return out
}
