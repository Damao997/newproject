import { prisma } from '../lib/prisma'
import { AggregationService, flattenValueTree, resolveCompanyCodes, resolveDashboardCompany } from './AggregationService'
import { BudgetRatioService, splitMonthlyBudget } from './BudgetRatioService'
import { latestOperatingPeriod } from './IndicatorsService'
import { OPERATING_DIMS, CASHFLOW_DIMS } from '../lib/metric-values'
import { fiscalYearStartPeriod, fiscalYearLabel, periodsInRange, formatPeriod, parsePeriod } from '../lib/period'
import type { AuthUserContext } from '../types/express'
import type { ValueNode } from './AggregationService'
import type { Prisma } from '@prisma/client'

/**
 * 首页看板服务：核心 KPI（收入/毛利/净利润/回款）/ 财年趋势 / 应收分布 / 预警。
 * 金额单位：万元。全部经 scope 过滤；多公司自动汇总求和。
 */

type Scope = Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & { dataScopeCodes?: string[] | null }

/** 核心 KPI 卡：本月合计 + 月度/累计预算达成率（%，null=无预算）+ 累计实际 + 同比 */
interface Kpi {
  title: string
  monthActual: number
  monthRate: number | null
  ytdActual: number
  yoy: number
  ytdRate: number | null
  trend: number[]
}

/** 财年趋势行：三个可选指标（收入/毛利/净利润）的 本月合计/上年同期/月度预算 + 回款（供 KPI 迷你图）；null=该月无数据 */
interface Trend {
  period: string
  revenueActual: number | null
  revenueSame: number | null
  revenueBudget: number | null
  revenueYtdActual: number | null
  revenueYtdSame: number | null
  revenueYtdBudget: number | null
  profitActual: number | null
  profitSame: number | null
  profitBudget: number | null
  profitYtdActual: number | null
  profitYtdSame: number | null
  profitYtdBudget: number | null
  netProfitActual: number | null
  netProfitSame: number | null
  netProfitBudget: number | null
  netProfitYtdActual: number | null
  netProfitYtdSame: number | null
  netProfitYtdBudget: number | null
  collectionActual: number | null
}

/** 品类预算达成的单指标组（收入/毛利各一组）：预算为年度总额；monthBudget 为当月预算金额（按占比拆分，无预算 null）；
 * ytdBudget 为预警专用的累计预算（按占比前缀和累计，不参与看板展示，无预算 null） */
interface ProductBudgetMetric {
  budget: number
  monthBudget: number | null
  monthActual: number
  /** 上年同月实际（供合计行同比按 Σ金额重算） */
  monthSame: number
  monthRate: number | null
  monthYoy: number
  ytdActual: number
  /** 上年同期累计（供合计行同比按 Σ金额重算） */
  ytdSame: number
  /** 预警专用：按月度占比累计的预算值（年度总额 × 从年初到当期占比累计；无预算 null），不参与看板展示 */
  ytdBudget: number | null
  /** 累计预算达成率（%，累计实际/年度预算总额，看板展示口径） */
  ytdRate: number | null
  /** 累计预算口径达成率（%，累计实际/累计预算，供预警判断；未配置占比时回退展示口径） */
  ytdCumRate: number | null
  ytdYoy: number
}

/** 品类预算达成行：品类名 + 收入/毛利镜像科目各一组口径值 */
interface ProductBudgetRow {
  category: string
  income: ProductBudgetMetric
  profit: ProductBudgetMetric
}

/** 运营费用分析行：展示指标（映射配置）+ 单组口径值（字段平铺，供前端直接消费） */
interface ExpenseAnalysisRow {
  code: string
  name: string
  budget: number
  monthBudget: number | null
  monthActual: number
  monthSame: number
  monthRate: number | null
  monthYoy: number
  ytdActual: number
  ytdSame: number
  ytdRate: number | null
  ytdYoy: number
}

/** 主体预算达成行：主体（单体公司/汇总主体）+ 收入/毛利/净利润各一组口径值 */
interface SubjectBudgetRow {
  code: string
  name: string
  income: ProductBudgetMetric
  profit: ProductBudgetMetric
  netProfit: ProductBudgetMetric
}

// ===== 壹品慧关键指标表 =====

/** 关键指标表单组口径：月度 8 列 + 年度 6 列（金额单位万元；百分比为百分数值；null=无预算/基数缺失显示「—」） */
export interface KeyMetricsGroup {
  /** 月度预算（占比拆分后的当月值；现金流等无预算行为 null） */
  monthBudget: number | null
  /** 本期实际 */
  monthActual: number
  /** 去年同期 */
  monthSame: number
  /** 同比变动 = 本期实际 - 去年同期 */
  monthChange: number
  /** 同比 %（基数 0 返回 0，与看板既有口径一致） */
  monthYoy: number
  /** 环比变动 = 本期实际 - 上月实际 */
  monthMomChange: number
  /** 环比 % */
  monthMom: number
  /** 月度完成率 % = 本期实际 / 月度预算（无预算 null） */
  monthRate: number | null
  /** 年度预算（现金流等无预算行为 null） */
  annualBudget: number | null
  /** 本年累计（年初至本期） */
  ytdActual: number
  /** 同期累计（上年年初至上年同期） */
  ytdSame: number
  /** 累计同比变动 = 本年累计 - 同期累计 */
  ytdChange: number
  /** 累计同比 % */
  ytdYoy: number
  /** 年度完成率 % = 本年累计 / 年度预算（无预算 null） */
  annualRate: number | null
}

/** 关键指标表行：key=行标识；label=展示名；category=分类列；products=产品明细（仅收入/毛利行，空数组表示无明细） */
export interface KeyMetricsRow {
  key: string
  label: string
  category: string
  products: { name: string; income: KeyMetricsGroup; profit: KeyMetricsGroup }[]
  values: KeyMetricsGroup
}

/** 由原始口径值构造 13 列展示组（纯函数，供 getKeyMetrics 与单测复用） */
export function keyMetricsGroup(v: {
  annualBudget: number | null
  monthBudget: number | null
  actual: number
  prevActual: number
  same: number
  ytd: number
  ytdSame: number
}): KeyMetricsGroup {
  return {
    monthBudget: v.monthBudget,
    monthActual: round2(v.actual),
    monthSame: round2(v.same),
    monthChange: round2(v.actual - v.same),
    monthYoy: changeRate(v.actual, v.same),
    monthMomChange: round2(v.actual - v.prevActual),
    monthMom: changeRate(v.actual, v.prevActual),
    monthRate: v.monthBudget === null || v.monthBudget === 0 ? null : round2((v.actual / v.monthBudget) * 100),
    annualBudget: v.annualBudget === null ? null : round2(v.annualBudget),
    ytdActual: round2(v.ytd),
    ytdSame: round2(v.ytdSame),
    ytdChange: round2(v.ytd - v.ytdSame),
    ytdYoy: changeRate(v.ytd, v.ytdSame),
    annualRate: v.annualBudget === null || v.annualBudget === 0 ? null : round2((v.ytd / v.annualBudget) * 100),
  }
}

/** 看板预警（由 alert 表原始行派生的展示结构） */
export interface DashboardAlert {
  id: string
  severity: 'info' | 'warning' | 'error'
  title: string
  message: string
  createdAt: string
}

/** 备用：按名称查找根节点（主逻辑已改用 category 匹配） */
export function rootByName(tree: ValueNode[], name: string): ValueNode | undefined {
  return tree.find((n) => n.name === name)
}

function actual(node?: ValueNode): number {
  return node?.values[OPERATING_DIMS.ACTUAL_MONTH] ?? 0
}
function budget(node?: ValueNode): number {
  return node?.values[OPERATING_DIMS.BUDGET_AMOUNT] ?? 0
}
function ytd(node?: ValueNode): number {
  return node?.values[OPERATING_DIMS.YTD_ACTUAL] ?? 0
}
function samePeriod(node?: ValueNode): number {
  return node?.values[OPERATING_DIMS.SAME_PERIOD_ACTUAL] ?? 0
}
function round2(n: number): number {
  return Number(n.toFixed(2))
}
export function changeRate(cur: number, base: number): number {
  const absBase = Math.abs(base)
  if (!absBase) return 0
  const r = (cur - base) / absBase
  return Number.isFinite(r) ? round2(r) : 0
}
/** 预算达成率（%）：divisor=12 表示按月均预算折算月度达成率；预算为 0/缺失返回 null（前端显示 "–"） */
export function rateOf(actualVal: number, budgetVal: number, divisor = 1): number | null {
  if (!budgetVal) return null
  return round2((actualVal / (budgetVal / divisor)) * 100)
}

/**
 * 主体展示排序（主体预算达成卡共用）：配置 sortOrder 升序（未配置排最后）→ 公司 orderNo 升序 → 编码兜底，
 * 保证 sortOrder 相等（如多主体同号/未维护）时顺序完全确定，与配置管理界面一致。
 */
export function orderSubjectsByConfig<T extends { code: string; orderNo: number }>(
  subjects: T[],
  sortOrderByCode: Map<string, number>,
): T[] {
  return [...subjects].sort((a, b) => {
    const so = (sortOrderByCode.get(a.code) ?? Number.MAX_SAFE_INTEGER) - (sortOrderByCode.get(b.code) ?? Number.MAX_SAFE_INTEGER)
    if (so !== 0) return so
    const no = a.orderNo - b.orderNo
    if (no !== 0) return no
    return a.code.localeCompare(b.code)
  })
}

/** 在指定 level0 类别子树内按名称关键字 DFS 查找科目（如「经营指标」下的净利润） */
export function findInCategory(tree: ValueNode[], category: string, keyword: string): ValueNode | undefined {
  const root = tree.find((n) => n.category === category)
  if (!root) return undefined
  const walk = (nodes: ValueNode[]): ValueNode | undefined => {
    for (const n of nodes) {
      if (n.name.includes(keyword)) return n
      const hit = walk(n.children)
      if (hit) return hit
    }
    return undefined
  }
  return root.name.includes(keyword) ? root : walk(root.children)
}

/** 收集子树全部叶子科目编码（供月度预算按类别归集） */
function collectLeafCodes(node?: ValueNode): string[] {
  if (!node) return []
  if (node.isLeaf || node.children.length === 0) return [node.code]
  return node.children.flatMap((c) => collectLeafCodes(c))
}

/** alert 原始行（仅取派生所需字段） */
interface AlertRow {
  id: string
  metricCode: string | null
  periodCode: string | null
  type: string | null
  threshold: Prisma.Decimal | null
  actualValue: Prisma.Decimal | null
  level: string | null
  triggeredAt: Date
}

const ALERT_TITLES: Record<string, string> = {
  budget_exceeded: '预算超支预警',
  overdue_payment: '逾期回款预警',
  inventory_backlog: '库存积压预警',
  anomaly: '数据异常预警',
}

/** 原始 alert 行 → 展示结构：level 归一 severity，type 映射标题，指标/阈值拼提示文案 */
export function mapAlertRow(row: AlertRow): DashboardAlert {
  const level = (row.level ?? '').toLowerCase()
  const severity: DashboardAlert['severity'] =
    level === 'error' || level === 'high' || level === 'critical' ? 'error'
    : level === 'info' || level === 'low' ? 'info'
    : 'warning'
  const parts: string[] = []
  if (row.metricCode) parts.push(`指标 ${row.metricCode}`)
  if (row.periodCode) parts.push(`期间 ${row.periodCode}`)
  if (row.actualValue != null) parts.push(`实际值 ${round2(Number(row.actualValue))}`)
  if (row.threshold != null) parts.push(`阈值 ${round2(Number(row.threshold))}`)
  return {
    id: row.id,
    severity,
    title: ALERT_TITLES[row.type ?? ''] ?? '数据预警',
    message: parts.join('，') || '触发预警规则，请关注相关指标',
    createdAt: row.triggeredAt.toISOString(),
  }
}

/** 预警 scope 过滤条件：未确认 + 归属公司在授权范围内（无归属的全局预警放行） */
export function alertScopeWhere(companyCodes: string[]): Prisma.AlertWhereInput {
  return {
    acknowledged: false,
    OR: [{ businessUnitCode: null }, { businessUnitCode: { in: companyCodes } }],
  }
}

/** active 经营批次内的可用期间（升序；多批次按期间共存，汇总全部 active 批次） */
async function availablePeriods(): Promise<string[]> {
  const batches = await prisma.importBatch.findMany({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
  if (batches.length === 0) return []
  const rows = await prisma.factOperating.findMany({
    where: { batchId: { in: batches.map((b) => b.id) } },
    distinct: ['period'],
    orderBy: { period: 'asc' },
    select: { period: true },
  })
  return rows.map((r) => r.period)
}

/** 并行构建各期间聚合树（避免串行 N+1），供趋势与选定期 KPI 复用；汇总主体查询链路透传抵消上下文 */
async function buildTrees(companyCodes: string[], periods: string[], consolidationSummaryCode?: string | null): Promise<Map<string, ValueNode[]>> {
  const trees = await Promise.all(periods.map((p) => AggregationService.buildOperatingTree(companyCodes, p, { consolidationSummaryCode })))
  return new Map(periods.map((p, i) => [p, trees[i]]))
}

/** 四个核心指标的节点定位：收入/毛利/回款按 category，净利润在「经营指标」子树内按名称 */
function metricNodes(tree: ValueNode[]): { revenue?: ValueNode; profit?: ValueNode; netProfit?: ValueNode; collection?: ValueNode } {
  return {
    revenue: tree.find((n) => n.category === '壹品慧收入'),
    profit: tree.find((n) => n.category === '壹品慧毛利'),
    netProfit: findInCategory(tree, '经营成果', '净利润'),
    collection: tree.find((n) => n.category === '壹品慧回款'),
  }
}

const PERIOD_RE = /^\d{4}-\d{2}$/

/**
 * 月度预算序列：active 预算批次内按 (科目, 期间) 求和，再按指标叶子码集合归集为 期间→合计。
 * 预算行无月度粒度（period 非 YYYY-MM）时：配置了完整占比（ratios 12 项）返回全 null
 * （交由 fallbackBudgetSeries 按占比拆分），否则回退 年度合计/12 均摊；完全无预算返回全 null。
 */
export function monthlyBudgetSeries(
  rows: { accountCode: string; period: string; value: number }[],
  leafCodes: string[],
  months: string[],
  ratios?: number[] | null,
): (number | null)[] {
  const codeSet = new Set(leafCodes)
  const mine = rows.filter((r) => codeSet.has(r.accountCode))
  if (mine.length === 0) return months.map(() => null)
  const monthly = new Map<string, number>()
  let annual = 0
  let hasMonthly = false
  for (const r of mine) {
    annual += r.value
    if (PERIOD_RE.test(r.period)) {
      hasMonthly = true
      monthly.set(r.period, (monthly.get(r.period) ?? 0) + r.value)
    }
  }
  if (hasMonthly) return months.map((m) => (monthly.has(m) ? round2(monthly.get(m)!) : null))
  if (ratios && ratios.length === 12) return months.map(() => null)
  return annual ? months.map(() => round2(annual / 12)) : months.map(() => null)
}

/**
 * 指标年度预算总额：优先按叶子预算行求和（含月度粒度归集）；无匹配行（计算类指标如毛利）
 * 时回退树节点 BUDGET_AMOUNT（公式层 收入-成本 重算值），保证预算序列始终有来源。
 */
export function budgetAnnualTotal(node: ValueNode | undefined, budgetRows: { accountCode: string; value: number }[], leafCodes: string[]): number {
  const codeSet = new Set(leafCodes)
  // 以「是否存在叶子预算行」判断而非合计值：叶子预算真为 0（合法导入）时不得回退公式重算值
  const leafRows = budgetRows.filter((r) => codeSet.has(r.accountCode))
  if (leafRows.length > 0) return round2(leafRows.reduce((s, r) => s + r.value, 0))
  return round2(budget(node))
}

/**
 * 预算序列兜底（月度口径）：叶子归集结果为全 null（无直导预算行）时按树预算总额拆分——
 * 配置了月度占比（ratios，完整 12 项）时按占比拆分（末月余差保证 Σ=总额），否则年度/12 均摊；
 * 无预算返回原全 null（不伪造）。
 */
export function fallbackBudgetSeries(series: (number | null)[], annualTotal: number, months: string[], ratios?: number[] | null): (number | null)[] {
  if (series.some((v) => v !== null)) return series
  if (!annualTotal) return series
  return splitMonthlyBudget(annualTotal, ratios ?? null, months)
}

/**
 * 累计预算序列：预算无累计粒度，由月度预算序列逐月累加得到（配置占比时即年度总额 × 从年初到当期占比累计，
 * 未配置时按均摊比例累计，月度粒度行按行值累加）；monthlyBudget 缺失/全 null（无预算）时回退年度总额水平线
 * （与品类预算表旧"累计=年度预算"口径一致）；年度总额为 0（无预算）时返回全 null。
 */
export function ytdBudgetSeries(annualTotal: number, months: string[], monthlyBudget?: (number | null)[]): (number | null)[] {
  if (!annualTotal) return months.map(() => null)
  if (monthlyBudget && monthlyBudget.some((v) => v !== null)) {
    // 逐月累加：null 月（无该月预算行）维持此前累计值不中断，保证累计线连续
    let acc = 0
    return monthlyBudget.map((v) => {
      if (v !== null) acc += v
      return round2(acc)
    })
  }
  return months.map(() => round2(annualTotal))
}

async function budgetRowsOf(companyCodes: string[], fiscalYear: string): Promise<{ accountCode: string; period: string; value: number }[]> {
  if (companyCodes.length === 0) return []
  const batches = await prisma.importBatch.findMany({ where: { dataType: 'budget', lifecycleStatus: 'active' }, select: { id: true } })
  if (batches.length === 0) return []
  const grouped = await prisma.factBudget.groupBy({
    by: ['accountCode', 'period'],
    where: { batchId: { in: batches.map((b) => b.id) }, companyCode: { in: companyCodes }, fiscalYear },
    _sum: { value: true },
  })
  return grouped.map((g) => ({ accountCode: g.accountCode, period: g.period, value: Number(g._sum.value ?? 0) }))
}

/** 单指标组口径取值：本月/累计预算达成率 + 单月/累计同比；节点缺失时全 0/null。
 * monthBudget 传入（含 null=当月无预算）时月度预算与达成率按该值计算（占比拆分后的当月预算），
 * 未传（undefined）回退年度/12 折算（monthBudget = budget/12，保持旧口径）；
 * ytdBudget 传入（含 null=当期无累计预算）时累计预算口径达成率 ytdCumRate 按该值计算（占比前缀和累计，供预警判断），
 * 未传（undefined）时 ytdCumRate 回退展示口径；ytdRate 恒为累计实际/年度预算总额（看板展示口径，与占比无关）。 */
export function productMetric(node?: ValueNode, monthBudget?: number | null, ytdBudget?: number | null): ProductBudgetMetric {
  return {
    budget: round2(budget(node)),
    monthBudget: monthBudget === undefined ? round2(budget(node) / 12) : (monthBudget || null),
    monthActual: round2(actual(node)),
    monthSame: round2(samePeriod(node)),
    monthRate: monthBudget === undefined ? rateOf(actual(node), budget(node), 12) : rateOf(actual(node), monthBudget ?? 0),
    monthYoy: changeRate(actual(node), samePeriod(node)),
    ytdActual: round2(ytd(node)),
    ytdSame: round2(node?.values[OPERATING_DIMS.SAME_PERIOD_YTD] ?? 0),
    ytdBudget: ytdBudget === undefined ? round2(budget(node)) : (ytdBudget || null),
    ytdRate: rateOf(ytd(node), budget(node)),
    ytdCumRate: ytdBudget === undefined ? rateOf(ytd(node), budget(node)) : rateOf(ytd(node), ytdBudget ?? 0),
    ytdYoy: changeRate(ytd(node), node?.values[OPERATING_DIMS.SAME_PERIOD_YTD] ?? 0),
  }
}

/** 品类配置的匹配载体（由 product_category 表派生） */
export interface ProductCategoryMatch {
  code: string
  name: string
  subjectKeyword: string
}

/** 品类 × 科目树匹配结果：rows 供看板展示；covered/uncovered 供科目树变化检测 */
export interface ProductCategoryMatchResult {
  rows: ProductBudgetRow[]
  covered: { name: string; subjects: string[] }[]
  uncovered: string[]
}

/** 由 values 构造仅参与口径取值的节点（productMetric 只读 values） */
function nodeOf(values: Record<string, number>): ValueNode {
  return {
    code: '', name: '', level: 0, category: '', dataType: 'data', direction: 'debit',
    valueType: 'amount', isLeaf: true, values, children: [],
  }
}

/** 毛利镜像科目名：收入名末尾/括号前（如"（不含净水及服务）"）的"收入"→"毛利" */
export function profitMirrorName(name: string): string {
  return name.replace(/收入(?=$|（)/, '毛利')
}

/** 映射行输入（expense_subject_mapping 行子集，供 matchExpenseMappings） */
export interface ExpenseMappingRow {
  code: string
  name: string
  subjectCodes: string[]
}

/**
 * 运营费用映射 × 科目树匹配：每条映射按其科目编码集合在各节点 values 上求和，
 * 生成单组口径值（productMetric：预算/本月/累计/同期/使用率/同比）；缺失编码静默跳过；
 * ratios/monthIndex 传入时月度预算与使用率按占比拆分后的当月预算计算（未传保持年度/12 折算）；
 * 金额与预算全为 0 的映射行不展示（无导入数据/无预算）。
 */
export function matchExpenseMappings(mappings: ExpenseMappingRow[], tree: ValueNode[], ratios?: number[] | null, monthIndex?: number): ExpenseAnalysisRow[] {
  const byCode = new Map(flattenValueTree(tree).map((n) => [n.code, n]))
  const sumValues = (codes: string[]): Record<string, number> => {
    const acc: Record<string, number> = {}
    for (const c of codes) {
      const n = byCode.get(c)
      if (!n) continue
      for (const [dim, v] of Object.entries(n.values)) acc[dim] = round2((acc[dim] ?? 0) + (v ?? 0))
    }
    return acc
  }
  // 月度预算：按占比拆分后的当月预算（ratios/monthIndex 缺失回退 undefined，调用方保持年度/12 折算）；
  // 累计预算：按占比前缀和累计（ratios 缺失回退均摊累计，口径与月度拆分一致）
  const monthBudgetOf = (values: Record<string, number>): number | null | undefined => {
    if (!ratios || monthIndex === undefined || monthIndex < 0 || monthIndex >= ratios.length) return undefined
    const annual = values[OPERATING_DIMS.BUDGET_AMOUNT] ?? 0
    return annual ? round2((annual * ratios[monthIndex]) / 100) : 0
  }
  const rows: ExpenseAnalysisRow[] = []
  for (const m of mappings) {
    const values = sumValues(m.subjectCodes)
    const metric = productMetric(nodeOf(values), monthBudgetOf(values), ytdBudgetOf(values[OPERATING_DIMS.BUDGET_AMOUNT] ?? 0, ratios ?? null, monthIndex ?? -1))
    const hasData = metric.budget !== 0 || metric.monthActual !== 0 || metric.ytdActual !== 0
    if (hasData) rows.push({ code: m.code, name: m.name, ...metric })
  }
  return rows
}

/**
 * 品类 × 科目树匹配：按关键词命中收入类别节点（可多个，各维度求和；汇总节点值=子级求和），
 * 毛利按镜像名（profitMirrorName，"XX收入"→"XX毛利"）在毛利类别中取值求和。
 * ratios/monthIndex 传入时月度达成率按占比拆分后的当月预算计算（未传保持年度/12 折算）。
 * uncovered = 收入类别 level>=1 且自身与祖先均未被任何品类匹配的节点
 * （已配置品类节点的后代叶子视为已覆盖，仅提示真正未配置的业务线，如新增业务线）。
 */
export function matchProductCategories(
  categories: ProductCategoryMatch[],
  incomeRoots: ValueNode[],
  profitByName: Map<string, ValueNode>,
  ratios?: number[] | null,
  monthIndex?: number,
): ProductCategoryMatchResult {
  const matchedNames = new Set<string>()
  const rows: ProductBudgetRow[] = []
  const covered: { name: string; subjects: string[] }[] = []
  const allNodes: ValueNode[] = []
  const walkAll = (nodes: ValueNode[]): void => {
    for (const n of nodes) {
      allNodes.push(n)
      walkAll(n.children)
    }
  }
  walkAll(incomeRoots)
  const sumValues = (nodes: ValueNode[]): Record<string, number> => {
    const acc: Record<string, number> = {}
    for (const n of nodes) {
      for (const [dim, v] of Object.entries(n.values)) acc[dim] = round2((acc[dim] ?? 0) + (v ?? 0))
    }
    return acc
  }
  // 月度预算：按占比拆分后的当月预算（ratios/monthIndex 缺失回退 undefined，调用方保持年度/12 折算）；
  // 累计预算：按占比前缀和累计（ratios 缺失回退均摊累计，口径与月度拆分一致）
  const monthBudgetOf = (nodes: ValueNode[]): number | null | undefined => {
    if (!ratios || monthIndex === undefined || monthIndex < 0 || monthIndex >= ratios.length) return undefined
    const annual = nodes.reduce((s, n) => s + (n.values[OPERATING_DIMS.BUDGET_AMOUNT] ?? 0), 0)
    return annual ? round2((annual * ratios[monthIndex]) / 100) : 0
  }
  const ytdBudgetOfNodes = (nodes: ValueNode[]): number | null | undefined => {
    const annual = nodes.reduce((s, n) => s + (n.values[OPERATING_DIMS.BUDGET_AMOUNT] ?? 0), 0)
    return ytdBudgetOf(annual, ratios ?? null, monthIndex ?? -1)
  }
  for (const cat of categories) {
    const hits = allNodes.filter((n) => n.name.includes(cat.subjectKeyword))
    for (const h of hits) matchedNames.add(h.name)
    const income = productMetric(hits.length > 0 ? nodeOf(sumValues(hits)) : undefined, monthBudgetOf(hits), ytdBudgetOfNodes(hits))
    const profitHits = hits
      .map((h) => profitByName.get(profitMirrorName(h.name)))
      .filter((n): n is ValueNode => !!n)
    const profit = productMetric(profitHits.length > 0 ? nodeOf(sumValues(profitHits)) : undefined, monthBudgetOf(profitHits), ytdBudgetOfNodes(profitHits))
    const row: ProductBudgetRow = { category: cat.name, income, profit }
    // 金额与预算全为 0 的品类不展示（无导入数据/无预算）
    const hasData = row.income.monthActual !== 0 || row.income.ytdActual !== 0 || row.income.budget !== 0
      || row.profit.monthActual !== 0 || row.profit.ytdActual !== 0 || row.profit.budget !== 0
    if (hasData) rows.push(row)
    covered.push({ name: cat.name, subjects: hits.map((h) => h.name) })
  }
  // 未覆盖传播：自身或任一祖先被品类关键词命中则视为已覆盖（叶子科目随业务线一并覆盖）
  const uncovered: string[] = []
  const walk = (nodes: ValueNode[], ancestorMatched: boolean): void => {
    for (const n of nodes) {
      const selfMatched = matchedNames.has(n.name)
      if (n.level >= 1 && !selfMatched && !ancestorMatched) uncovered.push(n.name)
      walk(n.children, ancestorMatched || selfMatched)
    }
  }
  walk(incomeRoots, false)
  return { rows, covered, uncovered }
}

/** 月度预算（按占比拆分后的当月值）：ratios 缺失/期间不在占比范围回退 undefined（调用方保持年度/12 现行为） */
export function monthBudgetOf(node: ValueNode | undefined, ratios: number[] | null, monthIndex: number): number | null | undefined {
  if (!ratios || monthIndex < 0 || monthIndex >= ratios.length) return undefined
  return node ? round2((budget(node) * ratios[monthIndex]) / 100) : undefined
}

/** 累计预算（截至当前月）：配置占比时按年度总额 × 从年初到当期占比前缀和累计；
 * ratios 缺失/越界回退均摊累计（年度总额 × (monthIndex+1)/12，与"月度=年度/12"拆分一致）；
 * monthIndex < 0 返回 undefined（调用方保持旧口径）；年度总额为 0 返回 0（productMetric 归一为 null） */
export function ytdBudgetOf(annual: number, ratios: number[] | null, monthIndex: number): number | null | undefined {
  if (monthIndex < 0) return undefined
  if (!annual) return 0
  if (ratios && monthIndex < ratios.length) {
    let sum = 0
    for (let i = 0; i <= monthIndex; i++) sum += ratios[i]
    return round2((annual * sum) / 100)
  }
  return round2((annual * (monthIndex + 1)) / 12)
}

/**
 * 构建看板核心数据：4 张 KPI 卡 + 当期所属财年 12 个月的趋势行；汇总主体查询链路透传抵消上下文。
 * 预算月度口径：预算行无月度粒度（period 非 YYYY-MM）时按月度占比拆分（未配置财年回退年度/12 均摊）。
 */
async function buildDashboardData(companyCodes: string[], period: string, available: string[], consolidationSummaryCode?: string | null): Promise<{ kpiData: Kpi[]; trendData: Trend[] }> {
  const fyStart = fiscalYearStartPeriod(period)
  const { year, month } = parsePeriod(fyStart)
  const fyMonths = periodsInRange(fyStart, formatPeriod(year, month + 11))
  const dataMonths = fyMonths.filter((m) => available.includes(m))
  const treeByPeriod = await buildTrees(companyCodes, dataMonths.includes(period) ? dataMonths : [...dataMonths, period], consolidationSummaryCode)
  const tree = treeByPeriod.get(period) ?? []
  const nodes = metricNodes(tree)

  // 预算：按财年一次取数，三个图表指标各自按叶子码归集；
  // 计算类指标（毛利等）无直导预算行时回退树预算总额（公式层重算值），
  // 月度口径按占比拆分（无配置财年 /12 均摊）、累计按年度总额
  const fyLabel = fiscalYearLabel(period)
  const [budgetRows, ratios] = await Promise.all([
    budgetRowsOf(companyCodes, fyLabel),
    BudgetRatioService.budgetRatiosOf(fyLabel),
  ])
  const revenueLeafCodes = collectLeafCodes(nodes.revenue)
  const profitLeafCodes = collectLeafCodes(nodes.profit)
  const netProfitLeafCodes = collectLeafCodes(nodes.netProfit)
  const revenueAnnual = budgetAnnualTotal(nodes.revenue, budgetRows, revenueLeafCodes)
  const profitAnnual = budgetAnnualTotal(nodes.profit, budgetRows, profitLeafCodes)
  const netProfitAnnual = budgetAnnualTotal(nodes.netProfit, budgetRows, netProfitLeafCodes)
  const revenueBudget = fallbackBudgetSeries(monthlyBudgetSeries(budgetRows, revenueLeafCodes, fyMonths, ratios), revenueAnnual, fyMonths, ratios)
  const profitBudget = fallbackBudgetSeries(monthlyBudgetSeries(budgetRows, profitLeafCodes, fyMonths, ratios), profitAnnual, fyMonths, ratios)
  const netProfitBudget = fallbackBudgetSeries(monthlyBudgetSeries(budgetRows, netProfitLeafCodes, fyMonths, ratios), netProfitAnnual, fyMonths, ratios)
  // 累计预算线（看板展示）：预算无累计粒度，独立生成为年度总额水平线（展示口径，不按占比累计）；
  // 按占比累计的预警口径由 ytdBudgetOf 在品类/主体/运营费用接口中单独计算
  const revenueYtdBudget = ytdBudgetSeries(revenueAnnual, fyMonths)
  const profitYtdBudget = ytdBudgetSeries(profitAnnual, fyMonths)
  const netProfitYtdBudget = ytdBudgetSeries(netProfitAnnual, fyMonths)

  const trendData: Trend[] = fyMonths.map((m, i) => {
    const t = treeByPeriod.get(m)
    const n = t ? metricNodes(t) : undefined
    return {
      period: m,
      revenueActual: n ? round2(actual(n.revenue)) : null,
      revenueSame: n ? round2(samePeriod(n.revenue)) : null,
      revenueBudget: revenueBudget[i],
      revenueYtdActual: n ? round2(ytd(n.revenue)) : null,
      revenueYtdSame: n ? round2(n.revenue?.values[OPERATING_DIMS.SAME_PERIOD_YTD] ?? 0) : null,
      revenueYtdBudget: revenueYtdBudget[i],
      profitActual: n ? round2(actual(n.profit)) : null,
      profitSame: n ? round2(samePeriod(n.profit)) : null,
      profitBudget: profitBudget[i],
      profitYtdActual: n ? round2(ytd(n.profit)) : null,
      profitYtdSame: n ? round2(n.profit?.values[OPERATING_DIMS.SAME_PERIOD_YTD] ?? 0) : null,
      profitYtdBudget: profitYtdBudget[i],
      netProfitActual: n ? round2(actual(n.netProfit)) : null,
      netProfitSame: n ? round2(samePeriod(n.netProfit)) : null,
      netProfitBudget: netProfitBudget[i],
      netProfitYtdActual: n ? round2(ytd(n.netProfit)) : null,
      netProfitYtdSame: n ? round2(n.netProfit?.values[OPERATING_DIMS.SAME_PERIOD_YTD] ?? 0) : null,
      netProfitYtdBudget: netProfitYtdBudget[i],
      collectionActual: n ? round2(actual(n.collection)) : null,
    }
  })

  // 当前期在财年序列中的索引（趋势行月度预算 = 最终口径：有月度粒度行用行值，否则占比拆分或 /12）
  const periodIdx = fyMonths.indexOf(period)
  const monthBudgetOfTrend = (field: 'revenueBudget' | 'profitBudget' | 'netProfitBudget'): number | null | undefined =>
    periodIdx >= 0 ? trendData[periodIdx][field] : undefined

  // monthRate 按当月预算计算（与趋势图月度预算线同口径），ytdRate 按年度总额计算（与累计预算线同口径），无预算为 null
  const kpiOf = (title: string, node: ValueNode | undefined, key: 'revenueActual' | 'profitActual' | 'netProfitActual' | 'collectionActual', monthBudget?: number | null): Kpi => ({
    title,
    monthActual: round2(actual(node)),
    monthRate: monthBudget === undefined ? rateOf(actual(node), budget(node), 12) : rateOf(actual(node), monthBudget ?? 0),
    ytdActual: round2(ytd(node)),
    yoy: changeRate(actual(node), samePeriod(node)),
    ytdRate: rateOf(ytd(node), budget(node)),
    trend: trendData.map((t) => t[key] ?? 0),
  })

  const kpiData: Kpi[] = [
    kpiOf('收入', nodes.revenue, 'revenueActual', monthBudgetOfTrend('revenueBudget')),
    kpiOf('毛利', nodes.profit, 'profitActual', monthBudgetOfTrend('profitBudget')),
    kpiOf('净利润', nodes.netProfit, 'netProfitActual', monthBudgetOfTrend('netProfitBudget')),
    kpiOf('回款', nodes.collection, 'collectionActual'),
  ]
  return { kpiData, trendData }
}

/** 未确认预警（按已解析的公司范围过滤） */
async function unacknowledgedAlerts(companyCodes: string[]): Promise<DashboardAlert[]> {
  if (companyCodes.length === 0) return []
  const rows = await prisma.alert.findMany({
    where: alertScopeWhere(companyCodes),
    orderBy: { triggeredAt: 'desc' },
    take: 20,
  })
  return rows.map(mapAlertRow)
}

const AR_TYPE = '应收账款'

export const DashboardService = {
  async getOverview(scope: Scope, params: { period?: string; companyCode?: string } = {}): Promise<{
    kpiData: Kpi[]
    trendData: Trend[]
    alerts: DashboardAlert[]
    lastUpdatedAt: string
    period: string
    availablePeriods: string[]
    companyCode: string | null
    companyName: string | null
    companyType: 'single' | 'summary' | null
    degraded: boolean
  }> {
    // companyCode 支持单体/汇总主体：resolveDashboardCompany 内做展开与越权降级（不抛 403）
    const [eff, periods] = await Promise.all([resolveDashboardCompany(scope, params.companyCode), availablePeriods()])
    // 选定期仅接受可用期间内的值，缺省取最新期
    const period = (params.period && periods.includes(params.period) ? params.period : periods[periods.length - 1]) ?? (await latestOperatingPeriod())
    const subject = { companyCode: eff.companyCode, companyName: eff.companyName, companyType: eff.companyType, degraded: eff.degraded }
    // 无任何数据权限：返回空数据（前端展示空态），而非全 0 卡片
    if (eff.codes.length === 0) {
      return { kpiData: [], trendData: [], alerts: [], lastUpdatedAt: new Date().toISOString(), period, availablePeriods: periods, ...subject }
    }
    const { kpiData, trendData } = await buildDashboardData(eff.codes, period, periods, eff.companyType === 'summary' ? eff.companyCode : null)

    const [alerts, lastBatch] = await Promise.all([
      unacknowledgedAlerts(eff.codes),
      prisma.importBatch.findFirst({ where: { lifecycleStatus: 'active' }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    ])

    return { kpiData, trendData, alerts, lastUpdatedAt: (lastBatch?.updatedAt ?? new Date()).toISOString(), period, availablePeriods: periods, ...subject }
  },

  async getDrill(scope: Scope, params: { companyCode?: string; period?: string }): Promise<{
    kpiData: Kpi[]
    trendData: Trend[]
    companyCode: string | null
    companyName: string | null
    companyType: 'single' | 'summary' | null
    degraded: boolean
  }> {
    const [eff, periods] = await Promise.all([resolveDashboardCompany(scope, params.companyCode), availablePeriods()])
    const period = params.period || periods[periods.length - 1] || (await latestOperatingPeriod())
    if (eff.codes.length === 0) {
      return { kpiData: [], trendData: [], companyCode: null, companyName: null, companyType: null, degraded: eff.degraded }
    }
    const { kpiData, trendData } = await buildDashboardData(eff.codes, period, periods, eff.companyType === 'summary' ? eff.companyCode : null)
    return { kpiData, trendData, companyCode: eff.companyCode, companyName: eff.companyName, companyType: eff.companyType, degraded: eff.degraded }
  },

  /** 最新期所属财年的趋势（months 传入时截取末尾 N 个月） */
  async getTrend(scope: Scope, params: { months?: number }): Promise<Trend[]> {
    const [companyCodes, periods] = await Promise.all([resolveCompanyCodes(scope), availablePeriods()])
    const period = periods[periods.length - 1] ?? (await latestOperatingPeriod())
    const { trendData } = await buildDashboardData(companyCodes, period, periods)
    return params.months && params.months > 0 ? trendData.slice(-params.months) : trendData
  },

  /**
   * 品类预算达成表（单期间）：按品类配置（product_category，关键词匹配收入科目节点）聚合，
   * 毛利列取名称镜像科目（"XX收入"→"XX毛利"，公式层已计算）；未配置的科目不展示。
   * 月度/累计、月度预算/年度预算两对口径由前端按模式组合展示（后端一次返回全字段）。
   */
  async getProductBudget(scope: Scope, params: { period?: string; companyCode?: string } = {}): Promise<{
    period: string
    rows: ProductBudgetRow[]
    companyCode: string | null
    companyName: string | null
    companyType: 'single' | 'summary' | null
    degraded: boolean
  }> {
    // 越权主体自动降级到有权主体（与 getOverview 同源策略）
    const [eff, periods] = await Promise.all([resolveDashboardCompany(scope, params.companyCode), availablePeriods()])
    const period = (params.period && periods.includes(params.period) ? params.period : periods[periods.length - 1]) ?? (await latestOperatingPeriod())
    if (eff.codes.length === 0) {
      return { period, rows: [], companyCode: null, companyName: null, companyType: null, degraded: eff.degraded }
    }
    const [tree, categories, ratios] = await Promise.all([
      AggregationService.buildOperatingTree(eff.codes, period, { consolidationSummaryCode: eff.companyType === 'summary' ? eff.companyCode : null }),
      prisma.productCategory.findMany({
        where: { status: 'active' },
        orderBy: { sortOrder: 'asc' },
        select: { code: true, name: true, subjectKeyword: true },
      }),
      BudgetRatioService.budgetRatiosOf(fiscalYearLabel(period)),
    ])
    const flat = flattenValueTree(tree)
    const incomeRoots = tree.filter((n) => n.category === '壹品慧收入')
    const profitByName = new Map(flat.filter((n) => n.category === '壹品慧毛利').map((n) => [n.name, n]))
    // 当前期在财年中的月份索引（月度达成率按占比拆分后的当月预算计算）
    const monthIndex = periodsInRange(fiscalYearStartPeriod(period), period).length - 1
    const { rows } = matchProductCategories(categories, incomeRoots, profitByName, ratios, monthIndex)
    return { period, rows, companyCode: eff.companyCode, companyName: eff.companyName, companyType: eff.companyType, degraded: eff.degraded }
  },

  /**
   * 运营费用分析表（单期间）：按映射配置（expense_subject_mapping，科目编码集合）聚合
   * 费用 > 壹品慧费用 > 运营费用 子树科目，每行 = 展示指标 + 单组口径值（月度/累计预算达成与同比）。
   * 未配置/失效编码静默跳过；金额与预算全为 0 的映射行不展示。预警按费用类红绿灯由前端渲染。
   */
  async getExpenseAnalysis(scope: Scope, params: { period?: string; companyCode?: string } = {}): Promise<{
    period: string
    rows: ExpenseAnalysisRow[]
    companyCode: string | null
    companyName: string | null
    companyType: 'single' | 'summary' | null
    degraded: boolean
  }> {
    // 越权主体自动降级到有权主体（与 getOverview 同源策略）
    const [eff, periods] = await Promise.all([resolveDashboardCompany(scope, params.companyCode), availablePeriods()])
    const period = (params.period && periods.includes(params.period) ? params.period : periods[periods.length - 1]) ?? (await latestOperatingPeriod())
    if (eff.codes.length === 0) {
      return { period, rows: [], companyCode: null, companyName: null, companyType: null, degraded: eff.degraded }
    }
    const [tree, mappings, ratios] = await Promise.all([
      AggregationService.buildOperatingTree(eff.codes, period, { consolidationSummaryCode: eff.companyType === 'summary' ? eff.companyCode : null }),
      prisma.expenseSubjectMapping.findMany({
        where: { status: 'active', deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      }),
      BudgetRatioService.budgetRatiosOf(fiscalYearLabel(period)),
    ])
    // 当前期在财年中的月份索引（月度预算/使用率按占比拆分后的当月预算计算）
    const monthIndex = periodsInRange(fiscalYearStartPeriod(period), period).length - 1
    const rows = matchExpenseMappings(mappings, tree, ratios, monthIndex)
    return { period, rows, companyCode: eff.companyCode, companyName: eff.companyName, companyType: eff.companyType, degraded: eff.degraded }
  },

  /**
   * 壹品慧关键指标表（单期间）：损益板块（收入/毛利合计 + 产品明细/毛利、运营费用、财务费用、净利润）
   * + 现金流板块（自由现金流/经营性/投资性/筹资性现金净流量）的统一口径行。
   * - 收入/毛利合计与财务费用/净利润取经营树节点；产品明细按关键指标产品配置（key_metrics_product，
   *   关键词匹配收入科目 + 毛利镜像）聚合；运营费用按费用映射编码集合汇总单行；
   * - 现金流板块行取现金流树根节点（自由现金流为公式科目 CF04 = 经营活动 - 投资流出）；
   * - 环比（上月实际）由上期经营/现金流树同节点取数；月度预算按占比拆分，年度预算为全年总额；
   * - 现金流板块预算：年度预算取现金流预算维度（经「年度预算」模板导入，仅流入/流出层直填，净额类由公式推导），
   *   无预算导入时 monthBudget/annualBudget/annualRate 为 null（前端显示「—」）。
   */
  async getKeyMetrics(scope: Scope, params: { period?: string; companyCode?: string } = {}): Promise<{
    period: string
    rows: KeyMetricsRow[]
    companyCode: string | null
    companyName: string | null
    companyType: 'single' | 'summary' | null
    degraded: boolean
  }> {
    const [eff, periods] = await Promise.all([resolveDashboardCompany(scope, params.companyCode), availablePeriods()])
    const period = (params.period && periods.includes(params.period) ? params.period : periods[periods.length - 1]) ?? (await latestOperatingPeriod())
    if (eff.codes.length === 0) {
      return { period, rows: [], companyCode: null, companyName: null, companyType: null, degraded: eff.degraded }
    }
    const consolidationSummaryCode = eff.companyType === 'summary' ? eff.companyCode : null
    // 环比基数：上期（当前期前推一月）经营/现金流树同节点取本月实际
    const prevPeriod = formatPeriod(parsePeriod(period).year, parsePeriod(period).month - 1)
    const [tree, prevTree, cashflowTree, prevCashflowTree, products, mappings, ratios] = await Promise.all([
      AggregationService.buildOperatingTree(eff.codes, period, { consolidationSummaryCode }),
      AggregationService.buildOperatingTree(eff.codes, prevPeriod, { consolidationSummaryCode }),
      AggregationService.buildCashflowTree(eff.codes, period, { consolidationSummaryCode }),
      AggregationService.buildCashflowTree(eff.codes, prevPeriod, { consolidationSummaryCode }),
      prisma.keyMetricsProduct.findMany({ where: { status: 'active' }, orderBy: { sortOrder: 'asc' } }),
      prisma.expenseSubjectMapping.findMany({ where: { status: 'active', deletedAt: null }, orderBy: { sortOrder: 'asc' } }),
      BudgetRatioService.budgetRatiosOf(fiscalYearLabel(period)),
    ])
    // 当前期在财年中的月份索引（月度预算按占比拆分）
    const monthIndex = periodsInRange(fiscalYearStartPeriod(period), period).length - 1

    // 经营树节点口径组：月度预算占比拆分（未配置占比回退年度/12，与品类预算口径一致）
    const opGroup = (node?: ValueNode, prevNode?: ValueNode): KeyMetricsGroup => {
      const mb = monthBudgetOf(node, ratios, monthIndex)
      return keyMetricsGroup({
        annualBudget: budget(node),
        monthBudget: mb === undefined ? round2(budget(node) / 12) : mb,
        actual: actual(node),
        prevActual: actual(prevNode),
        same: samePeriod(node),
        ytd: ytd(node),
        ytdSame: node?.values[OPERATING_DIMS.SAME_PERIOD_YTD] ?? 0,
      })
    }

    // 现金流节点口径组：年度预算取现金流预算维度（无预算保持 null → 前端「—」）；月度预算按占比拆分（缺失回退年度/12）
    const cashflowGroup = (node?: ValueNode, prevNode?: ValueNode): KeyMetricsGroup => {
      const annual = node?.values[CASHFLOW_DIMS.BUDGET_AMOUNT] ?? 0
      const mb = ratios && monthIndex >= 0 && monthIndex < ratios.length && annual
        ? round2((annual * ratios[monthIndex]) / 100)
        : undefined
      return keyMetricsGroup({
        annualBudget: annual ? round2(annual) : null,
        monthBudget: annual ? (mb === undefined ? round2(annual / 12) : mb) : null,
        actual: node?.values[CASHFLOW_DIMS.ACTUAL_MONTH] ?? 0,
        prevActual: prevNode?.values[CASHFLOW_DIMS.ACTUAL_MONTH] ?? 0,
        same: node?.values[CASHFLOW_DIMS.SAME_PERIOD_ACTUAL] ?? 0,
        ytd: node?.values[CASHFLOW_DIMS.YTD_ACTUAL] ?? 0,
        ytdSame: node?.values[CASHFLOW_DIMS.SAME_PERIOD_YTD] ?? 0,
      })
    }

    // 产品明细（当期 + 上期）：上期仅取环比基数（金额/预算全 0 行会被过滤，按名称对齐防错位）
    const profitByName = new Map(flattenValueTree(tree).filter((n) => n.category === '壹品慧毛利').map((n) => [n.name, n]))
    const prevProfitByName = new Map(flattenValueTree(prevTree).filter((n) => n.category === '壹品慧毛利').map((n) => [n.name, n]))
    const incomeRoots = tree.filter((n) => n.category === '壹品慧收入')
    const prevIncomeRoots = prevTree.filter((n) => n.category === '壹品慧收入')
    const { rows: productRows } = matchProductCategories(products, incomeRoots, profitByName, ratios, monthIndex)
    const { rows: prevProductRows } = matchProductCategories(products, prevIncomeRoots, prevProfitByName)
    const prevByCategory = new Map(prevProductRows.map((r) => [r.category, r]))
    const detailOf = (m: ProductBudgetMetric, prev?: ProductBudgetMetric): KeyMetricsGroup => keyMetricsGroup({
      annualBudget: m.budget,
      monthBudget: m.monthBudget,
      actual: m.monthActual,
      prevActual: prev?.monthActual ?? 0,
      same: m.monthSame,
      ytd: m.ytdActual,
      ytdSame: m.ytdSame,
    })
    const productDetails = () => productRows.map((r) => {
      const prev = prevByCategory.get(r.category)
      return {
        name: r.category,
        income: detailOf(r.income, prev?.income),
        profit: detailOf(r.profit, prev?.profit),
      }
    })

    // 运营费用合计行：费用映射全部编码求和（当期 + 上期）
    const expenseRows = matchExpenseMappings(mappings, tree, ratios, monthIndex)
    const prevExpenseRows = matchExpenseMappings(mappings, prevTree)
    const expenseGroup = (): KeyMetricsGroup => {
      const sum = (pick: (r: typeof expenseRows[number]) => number) => round2(expenseRows.reduce((s, r) => s + pick(r), 0))
      const sumPrev = (pick: (r: typeof prevExpenseRows[number]) => number) => round2(prevExpenseRows.reduce((s, r) => s + pick(r), 0))
      return keyMetricsGroup({
        annualBudget: sum((r) => r.budget),
        monthBudget: expenseRows.some((r) => r.monthBudget !== null) ? round2(expenseRows.reduce((s, r) => s + (r.monthBudget ?? 0), 0)) : null,
        actual: sum((r) => r.monthActual),
        prevActual: sumPrev((r) => r.monthActual),
        same: sum((r) => r.monthSame),
        ytd: sum((r) => r.ytdActual),
        ytdSame: sum((r) => r.ytdSame),
      })
    }

    const nodes = metricNodes(tree)
    const prevNodes = metricNodes(prevTree)
    const finance = findInCategory(tree, '壹品慧费用', '财务费用')
    const prevFinance = findInCategory(prevTree, '壹品慧费用', '财务费用')
    const cfOf = (name: string, t: ValueNode[]): ValueNode | undefined => t.find((n) => n.name === name)
    const CASHFLOW_ROWS: { key: string; label: string; name: string }[] = [
      { key: 'fcf', label: '自由现金流', name: '自由现金流' },
      { key: 'operating', label: '经营性现金净流量', name: '经营活动产生的现金流量' },
      { key: 'investing', label: '投资性现金净流量', name: '投资活动产生的现金流量' },
      { key: 'financing', label: '筹资性现金净流量', name: '筹资活动产生的现金流量' },
    ]

    const rows: KeyMetricsRow[] = [
      { key: 'income', label: '收入', category: '收入', products: productDetails(), values: opGroup(nodes.revenue, prevNodes.revenue) },
      { key: 'profit', label: '毛利', category: '毛利', products: productDetails(), values: opGroup(nodes.profit, prevNodes.profit) },
      { key: 'expense', label: '运营费用', category: '运营费用', products: [], values: expenseGroup() },
      { key: 'finance', label: '财务费用', category: '财务费用', products: [], values: opGroup(finance, prevFinance) },
      { key: 'netProfit', label: '净利润', category: '净利润', products: [], values: opGroup(nodes.netProfit, prevNodes.netProfit) },
      ...CASHFLOW_ROWS.map((c) => ({
        key: c.key,
        label: c.label,
        category: '现金流量',
        products: [],
        values: cashflowGroup(cfOf(c.name, cashflowTree), cfOf(c.name, prevCashflowTree)),
      })),
    ]
    return { period, rows, companyCode: eff.companyCode, companyName: eff.companyName, companyType: eff.companyType, degraded: eff.degraded }
  },

  /**
   * 主体预算达成表（单期间）：按 mode 列出配置的全部单体公司或汇总主体；传入 companyCode 时
   * 仅返回该主体一行（单体=自身，汇总=成员合并口径），供看板与顶部主体筛选同步。
   * 展示主体来自主体展示配置（subject_budget_config，管理员维护），越权主体 403/跳过。
   */
  async getSubjectBudget(scope: Scope, params: { period?: string; mode?: 'single' | 'summary'; companyCode?: string } = {}): Promise<{ period: string; mode: 'single' | 'summary'; rows: SubjectBudgetRow[] }> {
    const [companyCodes, periods] = await Promise.all([resolveCompanyCodes(scope), availablePeriods()])
    if (companyCodes.length === 0) {
      const period = (params.period && periods.includes(params.period) ? params.period : periods[periods.length - 1]) ?? (await latestOperatingPeriod())
      return { period, mode: params.mode === 'summary' ? 'summary' : 'single', rows: [] }
    }
    const mode: 'single' | 'summary' = params.mode === 'summary' ? 'summary' : 'single'
    const period = (params.period && periods.includes(params.period) ? params.period : periods[periods.length - 1]) ?? (await latestOperatingPeriod())
    // 月度达成率口径：按财年月度占比拆分后的当月预算（无配置回退 undefined，保持年度/12 折算）；
    // 累计预算口径：按占比前缀和累计（无配置回退均摊累计，与月度拆分一致）
    const [ratios] = await Promise.all([BudgetRatioService.budgetRatiosOf(fiscalYearLabel(period))])
    const monthIndex = periodsInRange(fiscalYearStartPeriod(period), period).length - 1
    // 指定主体：汇总主体展开为成员明细（每成员一行，供公司分析展示）；单体公司返回自身一行；
    // 越权主体自动降级到有权主体（不抛 403）
    if (params.companyCode) {
      const eff = await resolveDashboardCompany(scope, params.companyCode)
      if (eff.codes.length === 0 || eff.companyCode === null) {
        return { period, mode, rows: [] }
      }
      if (eff.companyType === 'summary') {
        // 汇总主体：eff.codes 即展开后的成员单体，逐成员构建；
        // 成员排序：已配置的主体按配置 sortOrder，未配置按公司 orderNo 兜底
        const [members, memberConfigs] = await Promise.all([
          prisma.company.findMany({
            where: { code: { in: eff.codes }, status: 'active' },
            select: { code: true, name: true, shortName: true, orderNo: true },
          }),
          prisma.subjectBudgetConfig.findMany({
            where: { companyCode: { in: eff.codes } },
            select: { companyCode: true, sortOrder: true },
          }),
        ])
        const memberOrder = new Map(memberConfigs.map((c) => [c.companyCode, c.sortOrder]))
        const orderedMembers = orderSubjectsByConfig(members, memberOrder)
        const rows = (await Promise.all(orderedMembers.map(async (m): Promise<SubjectBudgetRow | null> => {
          const tree = await AggregationService.buildOperatingTree([m.code], period)
          const nodes = metricNodes(tree)
          const row: SubjectBudgetRow = {
            code: m.code,
            name: m.shortName ?? m.name,
            income: productMetric(nodes.revenue, monthBudgetOf(nodes.revenue, ratios, monthIndex), ytdBudgetOf(budget(nodes.revenue), ratios, monthIndex)),
            profit: productMetric(nodes.profit, monthBudgetOf(nodes.profit, ratios, monthIndex), ytdBudgetOf(budget(nodes.profit), ratios, monthIndex)),
            netProfit: productMetric(nodes.netProfit, monthBudgetOf(nodes.netProfit, ratios, monthIndex), ytdBudgetOf(budget(nodes.netProfit), ratios, monthIndex)),
          }
          const hasData = row.income.monthActual !== 0 || row.income.ytdActual !== 0 || row.income.budget !== 0
            || row.profit.monthActual !== 0 || row.profit.ytdActual !== 0 || row.profit.budget !== 0
            || row.netProfit.monthActual !== 0 || row.netProfit.ytdActual !== 0 || row.netProfit.budget !== 0
          return hasData ? row : null
        }))).filter((r): r is SubjectBudgetRow => r !== null)
        return { period, mode, rows }
      }
      // 单体公司：直接返回该主体一行
      const tree = await AggregationService.buildOperatingTree(eff.codes, period)
      const nodes = metricNodes(tree)
      return {
        period,
        mode,
        rows: [{
          code: eff.companyCode,
          name: eff.companyName ?? eff.companyCode,
          income: productMetric(nodes.revenue, monthBudgetOf(nodes.revenue, ratios, monthIndex), ytdBudgetOf(budget(nodes.revenue), ratios, monthIndex)),
          profit: productMetric(nodes.profit, monthBudgetOf(nodes.profit, ratios, monthIndex), ytdBudgetOf(budget(nodes.profit), ratios, monthIndex)),
          netProfit: productMetric(nodes.netProfit, monthBudgetOf(nodes.netProfit, ratios, monthIndex), ytdBudgetOf(budget(nodes.netProfit), ratios, monthIndex)),
        }],
      }
    }
    // 展示主体来自主体展示配置（subject_budget_config，管理员维护）：仅 active 且类型匹配的主体
    const configs = await prisma.subjectBudgetConfig.findMany({
      where: { status: 'active' },
      orderBy: { sortOrder: 'asc' },
      select: { companyCode: true },
    })
    const subjects = await prisma.company.findMany({
      where: { code: { in: configs.map((c) => c.companyCode) }, entityType: mode === 'summary' ? 'summary' : 'single', status: 'active' },
      select: { code: true, name: true, shortName: true, entityType: true },
    })
    // 按配置 sortOrder 排序（company.findMany 无序，按配置顺序重排）
    const order = new Map(configs.map((c, i) => [c.companyCode, i]))
    subjects.sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0))
    // 逐主体构建树（并行）：汇总主体经映射展开为成员；越权主体跳过（部分授权时只展示有权主体）
    const rows = (await Promise.all(subjects.map(async (s): Promise<SubjectBudgetRow | null> => {
      let codes: string[]
      try {
        codes = await resolveCompanyCodes(scope, s.code)
      } catch {
        return null
      }
      const tree = await AggregationService.buildOperatingTree(codes, period, { consolidationSummaryCode: s.entityType === 'summary' ? s.code : null })
      const nodes = metricNodes(tree)
      const row: SubjectBudgetRow = {
        code: s.code,
        name: s.shortName ?? s.name,
        income: productMetric(nodes.revenue, monthBudgetOf(nodes.revenue, ratios, monthIndex), ytdBudgetOf(budget(nodes.revenue), ratios, monthIndex)),
        profit: productMetric(nodes.profit, monthBudgetOf(nodes.profit, ratios, monthIndex), ytdBudgetOf(budget(nodes.profit), ratios, monthIndex)),
        netProfit: productMetric(nodes.netProfit, monthBudgetOf(nodes.netProfit, ratios, monthIndex), ytdBudgetOf(budget(nodes.netProfit), ratios, monthIndex)),
      }
      const hasData = row.income.monthActual !== 0 || row.income.ytdActual !== 0 || row.income.budget !== 0
        || row.profit.monthActual !== 0 || row.profit.ytdActual !== 0 || row.profit.budget !== 0
        || row.netProfit.monthActual !== 0 || row.netProfit.ytdActual !== 0 || row.netProfit.budget !== 0
      return hasData ? row : null
    }))).filter((r): r is SubjectBudgetRow => r !== null)
    return { period, mode, rows }
  },

  /**
   * 应收账款按主体分布（横向柱状图数据源）：指定期间的应收期末余额合计。
   * companyCode 传入（单体/汇总主体）时先经 scope 展开：单体返回自身一行，汇总主体返回其成员公司各行；
   * 未传时按全部授权单体逐行（跟随看板全局筛选，mode 参数保留兼容）。
   * 口径与往来总览一致（时点数，单期过滤）。
   */
  async getReceivables(scope: Scope, params: { period?: string; mode?: 'single' | 'summary'; companyCode?: string } = {}): Promise<{ period: string | null; rows: { code: string; name: string; balance: number }[] }> {
    const companyCodes = params.companyCode ? await resolveCompanyCodes(scope, params.companyCode) : await resolveCompanyCodes(scope)
    if (companyCodes.length === 0 || !params.period) return { period: params.period ?? null, rows: [] }

    const grouped = await prisma.transactionDetail.groupBy({
      by: ['companyCode'],
      where: { transactionType: AR_TYPE, period: params.period, companyCode: { in: companyCodes } },
      _sum: { closingBalance: true },
    })
    // 往来明细为元单位，看板统一折算为万元
    const balanceByCompany = new Map(grouped.map((g) => [g.companyCode, round2(Number(g._sum.closingBalance ?? 0) / 10000)]))
    if (balanceByCompany.size === 0) return { period: params.period, rows: [] }

    if (params.mode === 'summary') {
      // 汇总口径：成员余额聚合到各汇总主体（一个单体可归属多个汇总主体，各柱独立成立）
      const [maps, summaries] = await Promise.all([
        prisma.companyAggregationMap.findMany({ select: { summaryCompanyCode: true, singleCompanyCode: true } }),
        prisma.company.findMany({ where: { entityType: 'summary', status: 'active' }, select: { code: true, name: true, shortName: true } }),
      ])
      const rows = summaries
        .map((s) => {
          const members = maps.filter((m) => m.summaryCompanyCode === s.code).map((m) => m.singleCompanyCode)
          const balance = round2(members.reduce((sum, c) => sum + (balanceByCompany.get(c) ?? 0), 0))
          return { code: s.code, name: s.shortName ?? s.name, balance }
        })
        .filter((r) => r.balance !== 0)
        .sort((a, b) => b.balance - a.balance)
      return { period: params.period, rows }
    }

    const companies = await prisma.company.findMany({
      where: { code: { in: [...balanceByCompany.keys()] } },
      select: { code: true, name: true, shortName: true },
    })
    const nameOf = new Map(companies.map((c) => [c.code, c.shortName ?? c.name]))
    const rows = [...balanceByCompany.entries()]
      .map(([code, balance]) => ({ code, name: nameOf.get(code) ?? code, balance }))
      .filter((r) => r.balance !== 0)
      .sort((a, b) => b.balance - a.balance)
    return { period: params.period, rows }
  },

  async getAlerts(scope: Scope): Promise<DashboardAlert[]> {
    const companyCodes = await resolveCompanyCodes(scope)
    return unacknowledgedAlerts(companyCodes)
  },
}
