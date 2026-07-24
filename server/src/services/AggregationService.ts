import { prisma } from '../lib/prisma'
import { resolveScope } from '../middleware/scope'
import type { AuthUserContext } from '../types/express'
import { OPERATING_DIMS, STATIC_DIMS } from '../lib/metric-values'
import { evaluateFormula, topoSortMetrics } from '../lib/formula'
import { extractCodes } from './FormulaRuleService'
import { periodMinusYears, fiscalYearStartPeriod, fiscalYearLabel } from '../lib/period'

/**
 * 聚合服务：从事实表按科目树自底向上汇总（父节点 = 子节点求和，与前端一致），
 * 并遵循数据范围（scope）过滤。金额单位：万元。
 */

export interface ValueNode {
  code: string
  name: string
  level: number
  category: string
  dataType: 'data' | 'calc' | 'display'
  direction: 'debit' | 'credit'
  isLeaf: boolean
  values: Record<string, number>
  children: ValueNode[]
}

interface SubjectRow {
  code: string
  name: string
  level: number
  parentCode: string | null
  category: string
  direction: 'debit' | 'credit'
  isLeaf: boolean
  dataType: 'data' | 'calc' | 'display'
  orderNo: number
}

function round2(n: number): number {
  return Number(n.toFixed(2))
}

/** 将汇总主体编码经 company_aggregation_map 展开为其单体成员；单体编码原样保留 */
async function expandSummaries(codes: string[]): Promise<string[]> {
  if (codes.length === 0) return []
  const companies = await prisma.company.findMany({ where: { code: { in: codes } }, select: { code: true, entityType: true } })
  const summaryCodes = companies.filter((c) => c.entityType === 'summary').map((c) => c.code)
  const singleCodes = new Set(companies.filter((c) => c.entityType === 'single').map((c) => c.code))
  if (summaryCodes.length > 0) {
    const maps = await prisma.companyAggregationMap.findMany({ where: { summaryCompanyCode: { in: summaryCodes } }, select: { singleCompanyCode: true } })
    for (const m of maps) singleCodes.add(m.singleCompanyCode)
  }
  return Array.from(singleCodes)
}

/** 解析当前用户的有效公司编码集合（叠加可选的公司过滤；汇总主体自动展开为单体成员） */
export async function resolveCompanyCodes(
  authUser: Pick<AuthUserContext, 'companyCode' | 'scopeValue'>,
  requestedCompany?: string,
): Promise<string[]> {
  const scope = await resolveScope(prisma, authUser)
  let base: string[]
  if (scope.type === 'all') {
    const all = await prisma.company.findMany({ where: { entityType: 'single', status: 'active' }, select: { code: true } })
    base = all.map((c) => c.code)
  } else if (scope.type === 'companies') {
    base = scope.companyCodes
  } else {
    base = []
  }
  if (requestedCompany) {
    // 请求为汇总主体：展开其单体成员；请求为单体：需在权限范围内
    const requested = await prisma.company.findUnique({ where: { code: requestedCompany }, select: { code: true, entityType: true } })
    if (!requested) return []
    if (requested.entityType === 'summary') {
      const members = await expandSummaries([requestedCompany])
      const baseSet = new Set(base)
      return members.filter((c) => baseSet.has(c))
    }
    return base.includes(requestedCompany) ? [requestedCompany] : []
  }
  return base
}

async function activeBatchIds(dataType: 'operating' | 'static' | 'budget'): Promise<string[]> {
  const batches = await prisma.importBatch.findMany({
    where: { dataType, lifecycleStatus: 'active' },
    select: { id: true },
  })
  return batches.map((b) => b.id)
}

async function loadSubjects(subjectType: 'operating' | 'static'): Promise<SubjectRow[]> {
  const rows = await prisma.accountSubject.findMany({
    where: { subjectType },
    orderBy: { orderNo: 'asc' },
    select: {
      code: true, name: true, level: true, parentCode: true, category: true,
      direction: true, isLeaf: true, orderNo: true,
    },
  })
  // dataType 来自 metric 表
  const metrics = await prisma.metric.findMany({ select: { code: true, dataType: true } })
  const dtMap = new Map(metrics.map((m) => [m.code, m.dataType]))
  return rows.map((r) => ({ ...r, dataType: (dtMap.get(r.code) ?? 'data') as SubjectRow['dataType'] }))
}

export interface CalcFormula {
  code: string
  formula: string
  dependsOn: string[]
}

/** 加载指定科目类型下、含公式的 active 计算类指标（用于展示层公式计算） */
async function loadCalcFormulas(subjectType: 'operating' | 'static'): Promise<CalcFormula[]> {
  const prefix = subjectType === 'operating' ? 'OP_' : 'ST_'
  const metrics = await prisma.metric.findMany({
    where: { dataType: 'calc', status: 'active', formula: { not: null }, code: { startsWith: prefix } },
    select: { code: true, formula: true, dependsOn: true },
  })
  return metrics.map((m) => ({
    code: m.code,
    formula: m.formula as string,
    dependsOn: Array.isArray(m.dependsOn) ? (m.dependsOn as string[]) : extractCodes(m.formula as string),
  }))
}

/**
 * 计算层：对含公式的计算类科目按 DAG 拓扑序用公式求值，逐维度覆盖"父=子求和"的默认值。
 * 无公式的计算类科目保持求和（向后兼容）；操作数缺失记 0；有环或单式报错则跳过该节点，不破坏整棵树。
 * externalByDim：跨树操作数（如静态比率引用经营科目），按维度提供 code→值；树内同 code 优先。
 */
export function applyCalcLayer(
  roots: ValueNode[],
  calcFormulas: CalcFormula[],
  dims: string[],
  externalByDim?: Map<string, Record<string, number>>,
): void {
  if (calcFormulas.length === 0) return
  const flat = flattenValueTree(roots)
  const byCode = new Map(flat.map((n) => [n.code, n]))
  const present = calcFormulas.filter((m) => byCode.has(m.code))
  if (present.length === 0) return
  let order: string[]
  try {
    order = topoSortMetrics(present.map((m) => ({ code: m.code, dependsOn: m.dependsOn })))
  } catch {
    return // 依赖有环：跳过计算层，保底不破坏求和结果
  }
  const formulaByCode = new Map(present.map((m) => [m.code, m.formula]))
  // 每个维度维护 code→value 快照，先铺跨树外部值，再以树内值覆盖；随计算推进更新
  const dimValues = new Map<string, Record<string, number>>()
  for (const d of dims) {
    const rec: Record<string, number> = { ...(externalByDim?.get(d) ?? {}) }
    for (const n of flat) rec[n.code] = n.values[d] ?? 0
    dimValues.set(d, rec)
  }
  for (const code of order) {
    const formula = formulaByCode.get(code)
    const node = byCode.get(code)
    if (!formula || !node) continue
    for (const d of dims) {
      const rec = dimValues.get(d) as Record<string, number>
      let v: number
      try {
        v = round2(evaluateFormula(formula, rec))
      } catch {
        v = node.values[d] ?? 0
      }
      node.values[d] = v
      rec[code] = v
    }
  }
}

const EMPTY_OPERATING: Record<string, number> = {
  [OPERATING_DIMS.BUDGET_AMOUNT]: 0,
  [OPERATING_DIMS.ACTUAL_MONTH]: 0,
  [OPERATING_DIMS.SAME_PERIOD_ACTUAL]: 0,
  [OPERATING_DIMS.YTD_ACTUAL]: 0,
  [OPERATING_DIMS.SAME_PERIOD_YTD]: 0,
}
const EMPTY_STATIC: Record<string, number> = {
  [STATIC_DIMS.CURRENT_AMOUNT]: 0,
  [STATIC_DIMS.YEAR_START]: 0,
  [STATIC_DIMS.SAME_PERIOD_AMOUNT]: 0,
  [STATIC_DIMS.LAST_YEAR_START]: 0,
}

function buildTree(subjects: SubjectRow[], leafValues: Map<string, Record<string, number>>, emptyDims: Record<string, number>): ValueNode[] {
  const byCode = new Map<string, ValueNode>()
  const roots: ValueNode[] = []

  for (const s of subjects) {
    byCode.set(s.code, {
      code: s.code, name: s.name, level: s.level, category: s.category,
      dataType: s.dataType, direction: s.direction, isLeaf: s.isLeaf,
      values: { ...emptyDims }, children: [],
    })
  }
  for (const s of subjects) {
    const node = byCode.get(s.code) as ValueNode
    if (s.parentCode && byCode.has(s.parentCode)) {
      byCode.get(s.parentCode)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // 后序：叶子取事实值，父节点 = 子求和
  const dims = Object.keys(emptyDims)
  const aggregate = (node: ValueNode): void => {
    if (node.children.length === 0) {
      const v = leafValues.get(node.code)
      if (v) for (const d of dims) node.values[d] = round2(v[d] ?? 0)
      return
    }
    for (const child of node.children) aggregate(child)
    for (const d of dims) {
      node.values[d] = round2(node.children.reduce((sum, c) => sum + (c.values[d] ?? 0), 0))
    }
  }
  roots.forEach(aggregate)
  return roots
}

export const AggregationService = {
  /** 经营指标聚合树：以原始 ACTUAL_MONTH 为基础，按选定期派生本月/同期/本年累计/同期累计 */
  async buildOperatingTree(companyCodes: string[], period: string): Promise<ValueNode[]> {
    const subjects = await loadSubjects('operating')
    const leafValues = new Map<string, Record<string, number>>()
    const setDim = (acc: string, dim: string, v: number): void => {
      const rec = leafValues.get(acc) ?? { ...EMPTY_OPERATING }
      rec[dim] = v
      leafValues.set(acc, rec)
    }
    if (companyCodes.length > 0) {
      const batchIds = await activeBatchIds('operating')
      if (batchIds.length > 0) {
        const prevPeriod = periodMinusYears(period, 1)
        const fyStart = fiscalYearStartPeriod(period)
        const prevFyStart = fiscalYearStartPeriod(prevPeriod)
        const baseWhere = { companyCode: { in: companyCodes }, batchId: { in: batchIds }, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH }

        // 本月实际 & 同期实际：按单期精确取 ACTUAL_MONTH（当期 / 当期减 1 年）
        const single = await prisma.factOperating.groupBy({
          by: ['accountCode', 'period'],
          where: { ...baseWhere, period: { in: [period, prevPeriod] } },
          _sum: { value: true },
        })
        for (const g of single) {
          const v = Number(g._sum.value ?? 0)
          if (g.period === period) setDim(g.accountCode, OPERATING_DIMS.ACTUAL_MONTH, v)
          else if (g.period === prevPeriod) setDim(g.accountCode, OPERATING_DIMS.SAME_PERIOD_ACTUAL, v)
        }
        // 本年累计：[财年起..当期] 区间求和（YYYY-MM 字典序即时间序）
        const ytd = await prisma.factOperating.groupBy({
          by: ['accountCode'],
          where: { ...baseWhere, period: { gte: fyStart, lte: period } },
          _sum: { value: true },
        })
        for (const g of ytd) setDim(g.accountCode, OPERATING_DIMS.YTD_ACTUAL, Number(g._sum.value ?? 0))
        // 同期累计：[上一财年起..当期减 1 年] 区间求和
        const ytdPrev = await prisma.factOperating.groupBy({
          by: ['accountCode'],
          where: { ...baseWhere, period: { gte: prevFyStart, lte: prevPeriod } },
          _sum: { value: true },
        })
        for (const g of ytdPrev) setDim(g.accountCode, OPERATING_DIMS.SAME_PERIOD_YTD, Number(g._sum.value ?? 0))
      }
      // 预算金额：按当前期所属财年取 active 预算批次（年度预算，无期间维度）汇总注入 BUDGET_AMOUNT
      const budgetBatchIds = await activeBatchIds('budget')
      if (budgetBatchIds.length > 0) {
        const budgetGrouped = await prisma.factBudget.groupBy({
          by: ['accountCode'],
          where: { companyCode: { in: companyCodes }, batchId: { in: budgetBatchIds }, fiscalYear: fiscalYearLabel(period) },
          _sum: { value: true },
        })
        for (const g of budgetGrouped) setDim(g.accountCode, OPERATING_DIMS.BUDGET_AMOUNT, Number(g._sum.value ?? 0))
      }
    }
    const tree = buildTree(subjects, leafValues, EMPTY_OPERATING)
    applyCalcLayer(tree, await loadCalcFormulas('operating'), Object.keys(EMPTY_OPERATING))
    return tree
  },

  /** 静态指标聚合树：以原始快照为基础，按选定期的快照月份派生本期/年初/同期/上年年初 */
  async buildStaticTree(companyCodes: string[], period: string): Promise<ValueNode[]> {
    const subjects = await loadSubjects('static')
    const leafValues = new Map<string, Record<string, number>>()
    const setDim = (acc: string, dim: string, v: number): void => {
      const rec = leafValues.get(acc) ?? { ...EMPTY_STATIC }
      rec[dim] = v
      leafValues.set(acc, rec)
    }
    if (companyCodes.length > 0) {
      const batchIds = await activeBatchIds('static')
      if (batchIds.length > 0) {
        const prev = periodMinusYears(period, 1)
        // 输出维度 → 目标快照月份
        const dimTargets: [string, string][] = [
          [STATIC_DIMS.CURRENT_AMOUNT, period],
          [STATIC_DIMS.YEAR_START, fiscalYearStartPeriod(period)],
          [STATIC_DIMS.SAME_PERIOD_AMOUNT, prev],
          [STATIC_DIMS.LAST_YEAR_START, fiscalYearStartPeriod(prev)],
        ]
        const grouped = await prisma.factStatic.groupBy({
          by: ['accountCode', 'snapshotDate'],
          where: { companyCode: { in: companyCodes }, batchId: { in: batchIds } },
          _sum: { value: true },
        })
        // 按 (accountCode, 月份) 汇总（同月多公司/多快照日期合计）
        const monthSum = new Map<string, number>()
        for (const g of grouped) {
          const d = g.snapshotDate as Date
          const mon = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
          const k = `${g.accountCode}|${mon}`
          monthSum.set(k, (monthSum.get(k) ?? 0) + Number(g._sum.value ?? 0))
        }
        for (const acc of new Set(grouped.map((g) => g.accountCode))) {
          for (const [dim, tPeriod] of dimTargets) {
            const v = monthSum.get(`${acc}|${tPeriod}`)
            if (v !== undefined) setDim(acc, dim, v)
          }
        }
      }
    }
    const tree = buildTree(subjects, leafValues, EMPTY_STATIC)
    const calc = await loadCalcFormulas('static')
    // 跨树比率（如 ROE/ROA 引用经营“壹品慧净利润”）：注入同选定期经营树“本期/同期”值作为外部操作数
    let externalByDim: Map<string, Record<string, number>> | undefined
    const needsExternal = calc.some((m) => m.dependsOn.some((d) => d.startsWith('OP_')))
    if (needsExternal && companyCodes.length > 0) {
      const opFlat = flattenValueTree(await AggregationService.buildOperatingTree(companyCodes, period))
      const current: Record<string, number> = {}
      const same: Record<string, number> = {}
      for (const n of opFlat) {
        current[n.code] = n.values[OPERATING_DIMS.ACTUAL_MONTH] ?? 0
        same[n.code] = n.values[OPERATING_DIMS.SAME_PERIOD_ACTUAL] ?? 0
      }
      externalByDim = new Map([
        [STATIC_DIMS.CURRENT_AMOUNT, current],
        [STATIC_DIMS.SAME_PERIOD_AMOUNT, same],
      ])
    }
    applyCalcLayer(tree, calc, Object.keys(EMPTY_STATIC), externalByDim)
    return tree
  },
}

/** 前序展开树为扁平行 */
export function flattenValueTree(tree: ValueNode[]): ValueNode[] {
  const out: ValueNode[] = []
  const walk = (nodes: ValueNode[]): void => {
    for (const n of nodes) {
      out.push(n)
      if (n.children.length > 0) walk(n.children)
    }
  }
  walk(tree)
  return out
}
