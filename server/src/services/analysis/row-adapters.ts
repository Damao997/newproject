import { prisma } from '../../lib/prisma'
import { AggregationService, flattenValueTree, resolveCompanyCodes, type BuildTreeOpts, type ReclassifyReversalMeta, type ValueNode } from '../AggregationService'
import { OPERATING_DIMS } from '../../lib/metric-values'
import { formatPeriod, parsePeriod } from '../../lib/period'
import { loadConfigSource } from './dimension-members'
import {
  actual, attachExpenseMom, budget, keyMetricsGroup, matchExpenseMappings, matchProductCategories,
  metricNodes, monthBudgetOf, productMetric, samePeriod, ytd, ytdBudgetOf,
  type ExpenseAnalysisBase, type KeyMetricsGroup, type ProductBudgetMetric,
} from '../DashboardService'
import type { AnalysisQueryFilters, AnalysisQueryOptions, RowDim } from '../../lib/analysis-query'
import type { RowGroups } from './metric-catalog'

/**
 * 行维度适配器（RowAdapter）：即席分析「行」的生成内核。
 *
 * 设计原则（见 docs/plans/即席分析模块技术方案.md §6）：**复用而非重写**。
 * 每个适配器都直接调用现有子页所用的同一批纯函数（matchProductCategories /
 * matchExpenseMappings / AggregationService.buildOperatingTree），再把结果**投影**为
 * 统一的 { code, name, level, groups } 结构。ProductBudgetMetric → KeyMetricsGroup
 * 采用**直接字段映射**（不重算），保证与旧接口逐字段一致。
 */

function round2(n: number): number {
  return Number(n.toFixed(2))
}

/** 请求方数据范围（与 DashboardService.Scope 同构） */
export interface AdapterScope {
  companyCode: string | null
  scopeValue: string
  dataScopeCodes?: string[] | null
}

export interface AdapterRow {
  code: string
  name: string
  level: number
  isTotal: boolean
  groups: RowGroups
}

export interface AdapterResult {
  /** 指标组顺序（长度 1 表示单组，投影 key 不加前缀） */
  groupNames: string[]
  rows: AdapterRow[]
  totals?: RowGroups
  /** 配置了但未匹配到数据的行标识（对应配置面板的「失效编码」检测） */
  unmatched: string[]
}

export interface AdapterContext {
  scope: AdapterScope
  /** 生效主体展开后的单体编码集合 */
  companyCodes: string[]
  period: string
  /** 当期在财年中的月份索引（0-based） */
  periodIndex: number
  ratios: number[] | null
  consolidationSummaryCode: string | null
  /** 去重分类模拟口径（只读回放） */
  excludeReclassify: boolean
  /** 回放统计收集器（各适配器共享，聚合过程中累加） */
  reclassifyMeta: ReclassifyReversalMeta
  filters: AnalysisQueryFilters
  options: AnalysisQueryOptions
  /** 矩阵模式（v2）：列成员限定的科目集合，聚合树建好后按此收敛（null = 全量） */
  colSubjectFilter?: Set<string> | null
}

/**
 * 按列成员科目集合收敛聚合树（矩阵模式交叉单元取值用）：
 * - 命中节点若为**非叶子**：整枝保留（祖先命中 = 含全部后代，不再对其后代筛选，防重复求和）；
 * - 命中节点若为**叶子**：保留该叶子及其祖先链（祖先 values 重算为其命中后代的聚合）。
 * 注意：聚合树上父节点 values 为后代的聚合值，故枝裁剪后祖先值天然偏小，与「列成员口径」一致。
 */
export function applyColFilter(tree: ValueNode[], filter?: Set<string> | null): ValueNode[] {
  if (!filter || filter.size === 0) return tree
  const keep = (nodes: ValueNode[]): ValueNode[] =>
    nodes.flatMap((n) => {
      if (filter.has(n.code) && n.children.length > 0) return [n] // 非叶子命中：整枝保留
      if (filter.has(n.code) && n.children.length === 0) return [n] // 叶子命中
      const children = keep(n.children)
      if (children.length === 0) return []
      return [{ ...n, children, isLeaf: false }]
    })
  return keep(tree)
}

export type RowAdapter = (ctx: AdapterContext) => Promise<AdapterResult>

/** 统一的建树参数：透传汇总抵消上下文 + 去重分类回放开关与统计收集器 */
function treeOpts(ctx: AdapterContext, consolidationSummaryCode?: string | null): BuildTreeOpts {
  return {
    consolidationSummaryCode: consolidationSummaryCode ?? ctx.consolidationSummaryCode,
    excludeReclassify: ctx.excludeReclassify,
    reclassifyMeta: ctx.reclassifyMeta,
  }
}

// ===== 口径映射（纯函数，供契约对照测试直接断言） =====

/** 科目节点 → 单组口径（与 getProductMetrics.groupOf 同构：prevActual 恒 0，本维度不取上期树） */
export function groupOfNode(node: ValueNode | undefined, ratios: number[] | null, periodIndex: number): KeyMetricsGroup {
  const annual = budget(node)
  const mb = monthBudgetOf(node, ratios, periodIndex)
  return keyMetricsGroup({
    annualBudget: annual,
    monthBudget: mb === undefined ? round2(annual / 12) : mb,
    ytdBudget: ytdBudgetOf(annual, ratios, periodIndex),
    actual: actual(node),
    prevActual: 0,
    same: samePeriod(node),
    ytd: ytd(node),
    ytdSame: node?.values[OPERATING_DIMS.SAME_PERIOD_YTD] ?? 0,
  })
}

/** ProductBudgetMetric → KeyMetricsGroup：**直接字段映射**（不重算，保证与旧接口逐字段一致） */
export function groupOfProductMetric(m: ProductBudgetMetric): KeyMetricsGroup {
  return {
    monthBudget: m.monthBudget,
    monthActual: m.monthActual,
    monthSame: m.monthSame,
    monthChange: round2(m.monthActual - m.monthSame),
    monthYoy: m.monthYoy,
    // 品类/产品维度不取上期树，与 getProductMetrics 一致（prevActual 恒 0）
    monthMomChange: m.monthActual,
    monthMom: 0,
    monthRate: m.monthRate,
    annualBudget: m.budget,
    ytdBudget: m.ytdBudget,
    ytdActual: m.ytdActual,
    ytdSame: m.ytdSame,
    ytdChange: round2(m.ytdActual - m.ytdSame),
    ytdYoy: m.ytdYoy,
    annualRate: m.ytdRate,
  }
}

/** 运营费用行 → KeyMetricsGroup：直接字段映射（含环比，来自 attachExpenseMom） */
export function groupOfExpenseRow(r: ExpenseAnalysisBase & { monthPrev: number; monthMom: number }): KeyMetricsGroup {
  return {
    monthBudget: r.monthBudget,
    monthActual: r.monthActual,
    monthSame: r.monthSame,
    monthChange: round2(r.monthActual - r.monthSame),
    monthYoy: r.monthYoy,
    monthMomChange: round2(r.monthActual - r.monthPrev),
    monthMom: r.monthMom,
    monthRate: r.monthRate,
    annualBudget: r.budget,
    ytdBudget: r.ytdBudget,
    ytdActual: r.ytdActual,
    ytdSame: r.ytdSame,
    ytdChange: round2(r.ytdActual - r.ytdSame),
    ytdYoy: r.ytdYoy,
    annualRate: r.ytdRate,
  }
}

// ===== 适配器实现 =====

/** 品类 / 产品：同一套匹配逻辑，仅配置维度不同（product_category / key_metrics_product）。
 *  配置源经 loadConfigSource 读取（L2/T31 成员表驱动，空表/未覆盖时回退配置表）。 */
async function productLikeAdapter(ctx: AdapterContext, source: 'category' | 'product'): Promise<AdapterResult> {
  const [rawTree, configs] = await Promise.all([
    AggregationService.buildOperatingTree(ctx.companyCodes, ctx.period, treeOpts(ctx)),
    loadConfigSource(source),
  ])
  const tree = applyColFilter(rawTree, ctx.colSubjectFilter)
  const profitByName = new Map(flattenValueTree(tree).filter((n) => n.category === '壹品慧毛利').map((n) => [n.name, n]))
  const incomeRoots = tree.filter((n) => n.category === '壹品慧收入')
  const { rows, covered } = matchProductCategories(configs, incomeRoots, profitByName, ctx.ratios, ctx.periodIndex, ctx.options.includeEmptyRows)
  const codeByName = new Map(configs.map((c) => [c.name, c.code]))
  const selected = ctx.filters.rowCodes.length > 0 ? new Set(ctx.filters.rowCodes) : null
  const kw = ctx.filters.keyword
  const out = rows
    .filter((r) => {
      const code = codeByName.get(r.category) ?? ''
      if (selected && !selected.has(code)) return false
      if (kw && !r.category.includes(kw)) return false
      return true
    })
    .map((r) => ({
      code: codeByName.get(r.category) ?? '',
      name: r.category,
      level: 0,
      isTotal: false,
      groups: { income: groupOfProductMetric(r.income), profit: groupOfProductMetric(r.profit) },
    }))
  const nodes = metricNodes(tree)
  const coveredMap = new Map(covered.map((c) => [c.name, c.subjects]))
  return {
    groupNames: ['income', 'profit'],
    rows: out,
    totals: {
      income: groupOfNode(nodes.revenue, ctx.ratios, ctx.periodIndex),
      profit: groupOfNode(nodes.profit, ctx.ratios, ctx.periodIndex),
    },
    // 配置了但未命中任何收入科目（关键词失效 / 显式编码不存在）
    unmatched: configs.filter((c) => (coveredMap.get(c.name)?.length ?? 0) === 0).map((c) => c.code),
  }
}

/** 运营费用：费用映射（expense_subject_mapping，科目编码集合）聚合 + 上期树取环比。
 *  配置源经 loadConfigSource 读取（L2/T31 成员表驱动，空表/未覆盖时回退配置表）。 */
async function expenseAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  const prevPeriod = formatPeriod(parsePeriod(ctx.period).year, parsePeriod(ctx.period).month - 1)
  const [rawTree, rawPrevTree, configs] = await Promise.all([
    AggregationService.buildOperatingTree(ctx.companyCodes, ctx.period, treeOpts(ctx)),
    AggregationService.buildOperatingTree(ctx.companyCodes, prevPeriod, treeOpts(ctx)),
    loadConfigSource('expense'),
  ])
  const tree = applyColFilter(rawTree, ctx.colSubjectFilter)
  const prevTree = applyColFilter(rawPrevTree, ctx.colSubjectFilter)
  const withMom = attachExpenseMom(
    matchExpenseMappings(configs, tree, ctx.ratios, ctx.periodIndex),
    matchExpenseMappings(configs, prevTree),
  )
  const selected = ctx.filters.rowCodes.length > 0 ? new Set(ctx.filters.rowCodes) : null
  const kw = ctx.filters.keyword
  const rows = withMom
    .filter((r) => (selected ? selected.has(r.code) : true) && (!kw || r.name.includes(kw)))
    .map((r) => ({ code: r.code, name: r.name, level: 0, isTotal: false, groups: { value: groupOfExpenseRow(r) } }))

  // 合计：全部映射科目「并集」求和（同一科目被多条映射覆盖时不得重复相加，与 getKeyMetrics 运营费用合计行口径一致）
  const codes = [...new Set(configs.flatMap((m) => m.subjectCodes))]
  const byCode = new Map(flattenValueTree(tree).map((n) => [n.code, n]))
  const sum: Record<string, number> = {}
  for (const c of codes) {
    const n = byCode.get(c)
    if (!n) continue
    for (const [dim, v] of Object.entries(n.values)) sum[dim] = round2((sum[dim] ?? 0) + (v ?? 0))
  }
  const annual = sum[OPERATING_DIMS.BUDGET_AMOUNT] ?? 0
  const mb = monthBudgetOf({ values: sum } as ValueNode, ctx.ratios, ctx.periodIndex)
  const totals: RowGroups = {
    value: keyMetricsGroup({
      annualBudget: annual,
      monthBudget: mb === undefined ? (annual === 0 ? null : round2(annual / 12)) : mb,
      ytdBudget: annual === 0 ? null : (ytdBudgetOf(annual, ctx.ratios, ctx.periodIndex) ?? null),
      actual: sum[OPERATING_DIMS.ACTUAL_MONTH] ?? 0,
      prevActual: 0,
      same: sum[OPERATING_DIMS.SAME_PERIOD_ACTUAL] ?? 0,
      ytd: sum[OPERATING_DIMS.YTD_ACTUAL] ?? 0,
      ytdSame: sum[OPERATING_DIMS.SAME_PERIOD_YTD] ?? 0,
    }),
  }
  return {
    groupNames: ['value'],
    rows,
    totals,
    // 映射配置引用了科目树中不存在的编码（科目改名/停用/删除）
    unmatched: [...new Set(configs.flatMap((m) => m.subjectCodes))].filter((c) => !byCode.has(c)),
  }
}

/** 科目：遍历科目树按 level / keyword / rowCodes 过滤后逐节点投影（无合计行——各顶层类别语义不同，相加无意义） */
async function subjectAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  const rawTree = await AggregationService.buildOperatingTree(ctx.companyCodes, ctx.period, treeOpts(ctx))
  const tree = applyColFilter(rawTree, ctx.colSubjectFilter)
  const selected = ctx.filters.rowCodes.length > 0 ? new Set(ctx.filters.rowCodes) : null
  const kw = ctx.filters.keyword
  const rows = flattenValueTree(tree)
    .filter((n) => {
      if (ctx.options.level !== null && n.level !== ctx.options.level) return false
      if (selected && !selected.has(n.code)) return false
      if (kw && !n.name.includes(kw)) return false
      return true
    })
    .map((n) => ({ code: n.code, name: n.name, level: n.level, isTotal: false, groups: { value: groupOfNode(n, ctx.ratios, ctx.periodIndex) } }))
  return { groupNames: ['value'], rows, unmatched: [] }
}

/** 主体：展示主体来自主体展示配置（subject_budget_config）；逐主体建树（汇总主体传抵消上下文） */
async function companyAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  const configs = ctx.filters.rowCodes.length > 0
    ? ctx.filters.rowCodes.map((code) => ({ companyCode: code }))
    : await prisma.subjectBudgetConfig.findMany({ where: { status: 'active' }, orderBy: { sortOrder: 'asc' }, select: { companyCode: true } })
  const wanted = configs.map((c) => c.companyCode)
  const companies = await prisma.company.findMany({
    where: { code: { in: wanted }, status: 'active' },
    select: { code: true, name: true, shortName: true, entityType: true },
  })
  const byCode = new Map(companies.map((c) => [c.code, c]))
  const rows: AdapterRow[] = []
  const unmatched: string[] = []
  for (const code of wanted) {
    const company = byCode.get(code)
    if (!company) { unmatched.push(code); continue }
    let memberCodes: string[]
    try {
      // 越权主体跳过（部分授权时只展示有权主体），与 getSubjectBudget 一致
      memberCodes = await resolveCompanyCodes(ctx.scope, code)
    } catch { unmatched.push(code); continue }
    const tree = applyColFilter(
      await AggregationService.buildOperatingTree(memberCodes, ctx.period, treeOpts(ctx, company.entityType === 'summary' ? code : null)),
      ctx.colSubjectFilter,
    )
    const nodes = metricNodes(tree)
    const metricOf = (n?: ValueNode): ProductBudgetMetric =>
      productMetric(n, monthBudgetOf(n, ctx.ratios, ctx.periodIndex), ytdBudgetOf(budget(n), ctx.ratios, ctx.periodIndex))
    const income = metricOf(nodes.revenue)
    const profit = metricOf(nodes.profit)
    const netProfit = metricOf(nodes.netProfit)
    const hasData = income.monthActual !== 0 || income.ytdActual !== 0 || income.budget !== 0
      || profit.monthActual !== 0 || profit.ytdActual !== 0 || profit.budget !== 0
      || netProfit.monthActual !== 0 || netProfit.ytdActual !== 0 || netProfit.budget !== 0
    if (!hasData && !ctx.options.includeEmptyRows) continue
    rows.push({
      code,
      name: company.shortName ?? company.name,
      level: 0,
      isTotal: false,
      groups: {
        income: groupOfProductMetric(income),
        profit: groupOfProductMetric(profit),
        netProfit: groupOfProductMetric(netProfit),
      },
    })
  }
  const scopeTree = applyColFilter(
    await AggregationService.buildOperatingTree(ctx.companyCodes, ctx.period, treeOpts(ctx)),
    ctx.colSubjectFilter,
  )
  const scopeNodes = metricNodes(scopeTree)
  return {
    groupNames: ['income', 'profit', 'netProfit'],
    rows,
    totals: {
      income: groupOfNode(scopeNodes.revenue, ctx.ratios, ctx.periodIndex),
      profit: groupOfNode(scopeNodes.profit, ctx.ratios, ctx.periodIndex),
      netProfit: groupOfNode(scopeNodes.netProfit, ctx.ratios, ctx.periodIndex),
    },
    unmatched,
  }
}

/** 行维度 → 适配器 */
export const ROW_ADAPTERS: Record<RowDim, RowAdapter> = {
  product: (ctx) => productLikeAdapter(ctx, 'product'),
  category: (ctx) => productLikeAdapter(ctx, 'category'),
  expense: expenseAdapter,
  subject: subjectAdapter,
  company: companyAdapter,
}

/** 行维度 → 指标组顺序（决定列前缀；长度 1 表示单组，key 不加前缀） */
export const ROW_DIM_GROUPS: Record<RowDim, string[]> = {
  product: ['income', 'profit'],
  category: ['income', 'profit'],
  expense: ['value'],
  subject: ['value'],
  company: ['income', 'profit', 'netProfit'],
}
