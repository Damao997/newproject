import { prisma } from '../lib/prisma'
import { AggregationService, resolveCompanyCodes, flattenValueTree, type ValueNode } from './AggregationService'
import { OPERATING_DIMS, STATIC_DIMS, calcYoy, calcAchievement } from '../lib/metric-values'
import { buildExcel } from '../lib/excel'
import { errors } from '../lib/errors'
import type { AuthUserContext } from '../types/express'

/**
 * 财务指标服务：科目树、经营/静态指标聚合、单指标详情、交叉表、导出。
 * 同比/达成率由后端计算，不存库（见 CLAUDE.md 公式计算铁律）。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'orgScopeBu' | 'scopeValue'>

export interface OperatingRow {
  code: string
  name: string
  level: number
  category: string
  dataType: string
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
  return {
    code: node.code, name: node.name, level: node.level, category: node.category,
    dataType: node.dataType, isLeaf: node.isLeaf,
    budget, actual, samePeriod, ytd, samePeriodYtd,
    yoy: calcYoy(actual, samePeriod),
    achievement: calcAchievement(actual, budget),
    ytdYoy: calcYoy(ytd, samePeriodYtd),
    children: node.children.map(serializeOperating),
  }
}

function serializeStatic(node: ValueNode): StaticRow {
  const v = node.values
  const current = v[STATIC_DIMS.CURRENT_AMOUNT] ?? 0
  const yearStart = v[STATIC_DIMS.YEAR_START] ?? 0
  const samePeriod = v[STATIC_DIMS.SAME_PERIOD_AMOUNT] ?? 0
  const lastYearStart = v[STATIC_DIMS.LAST_YEAR_START] ?? 0
  return {
    code: node.code, name: node.name, level: node.level, category: node.category,
    dataType: node.dataType, isLeaf: node.isLeaf,
    current, yearStart, samePeriod, lastYearStart,
    yoy: calcYoy(current, samePeriod),
    children: node.children.map(serializeStatic),
  }
}

/** 结构化科目树（仅结构，无数值） */
async function structuralTree(subjectType: 'operating' | 'static'): Promise<unknown[]> {
  const rows = await prisma.accountSubject.findMany({
    where: { subjectType },
    orderBy: { orderNo: 'asc' },
    select: { code: true, name: true, level: true, parentCode: true, category: true },
  })
  const metrics = await prisma.metric.findMany({ select: { code: true, dataType: true } })
  const dt = new Map(metrics.map((m) => [m.code, m.dataType]))
  interface Node { code: string; name: string; level: number; category: string; dataType: string; children: Node[] }
  const byCode = new Map<string, Node>()
  const roots: Node[] = []
  for (const r of rows) {
    byCode.set(r.code, { code: r.code, name: r.name, level: r.level, category: r.category, dataType: dt.get(r.code) ?? 'data', children: [] })
  }
  for (const r of rows) {
    const n = byCode.get(r.code) as Node
    if (r.parentCode && byCode.has(r.parentCode)) byCode.get(r.parentCode)?.children.push(n)
    else roots.push(n)
  }
  return roots
}

/** 最新经营期间（active 批次内的最大 period），无数据回退 2025-06 */
export async function latestOperatingPeriod(): Promise<string> {
  const batch = await prisma.importBatch.findFirst({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
  if (!batch) return '2025-06'
  const row = await prisma.factOperating.findFirst({
    where: { batchId: batch.id },
    orderBy: { period: 'desc' },
    select: { period: true },
  })
  return row?.period ?? '2025-06'
}

export const IndicatorsService = {
  async getTree(subjectType: 'operating' | 'static'): Promise<unknown[]> {
    return structuralTree(subjectType)
  },

  async getOperating(scope: Scope, params: { companyCode?: string; period?: string }): Promise<{ items: OperatingRow[]; total: number; period: string; companyCount: number }> {
    const companyCodes = await resolveCompanyCodes(scope, params.companyCode)
    const period = params.period || (await latestOperatingPeriod())
    const tree = await AggregationService.buildOperatingTree(companyCodes, period)
    const items = tree.map(serializeOperating)
    const total = flattenValueTree(tree).length
    return { items, total, period, companyCount: companyCodes.length }
  },

  async getStatic(scope: Scope, params: { companyCode?: string }): Promise<{ items: StaticRow[]; total: number; companyCount: number }> {
    const companyCodes = await resolveCompanyCodes(scope, params.companyCode)
    const tree = await AggregationService.buildStaticTree(companyCodes)
    const items = tree.map(serializeStatic)
    const total = flattenValueTree(tree).length
    return { items, total, companyCount: companyCodes.length }
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

  /** 交叉表：指标（行）× 公司（列）的本月实际 */
  async getCross(scope: Scope, body: { companyCodes?: string[]; metricCodes?: string[]; period?: string }): Promise<{ period: string; companies: string[]; rows: { code: string; name: string; values: Record<string, number> }[] }> {
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
    const period = body.period || (await latestOperatingPeriod())

    // 逐公司聚合，取 metricCodes 的本月实际
    const perCompany = new Map<string, Map<string, number>>()
    for (const cc of companies) {
      const tree = await AggregationService.buildOperatingTree([cc], period)
      const flat = flattenValueTree(tree)
      const m = new Map<string, number>()
      for (const n of flat) m.set(n.code, n.values[OPERATING_DIMS.ACTUAL_MONTH] ?? 0)
      perCompany.set(cc, m)
    }

    // 行：指定 metricCodes，或默认取 level0 节点
    let codes = body.metricCodes
    if (!codes || codes.length === 0) {
      const level0 = await prisma.accountSubject.findMany({ where: { subjectType: 'operating', level: 0 }, orderBy: { orderNo: 'asc' }, select: { code: true } })
      codes = level0.map((r) => r.code)
    }
    const nameRows = await prisma.accountSubject.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } })
    const nameMap = new Map(nameRows.map((r) => [r.code, r.name]))

    const rows = codes.map((code) => {
      const values: Record<string, number> = {}
      for (const cc of companies) values[cc] = perCompany.get(cc)?.get(code) ?? 0
      return { code, name: nameMap.get(code) ?? code, values }
    })
    return { period, companies, rows }
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
