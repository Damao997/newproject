import { prisma } from '../lib/prisma'
import { errors, AppError } from '../lib/errors'
import { resolveScope, type DataScope } from '../middleware/scope'
import { currentScope } from '../middleware/scope-context'
import type { AuthUserContext } from '../types/express'
import { OPERATING_DIMS, STATIC_DIMS } from '../lib/metric-values'
import { evaluateFormula, topoSortMetrics } from '../lib/formula'
import { extractCodes, extractOperandRefs, PSEUDO_OPERANDS } from './FormulaRuleService'
import { periodMinusYears, fiscalYearStartPeriod, fiscalYearOpeningSnapshotPeriod, fiscalYearLabel, fiscalYtdDays } from '../lib/period'
import { ReclassifyReversalService } from './ReclassifyReversalService'

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
  valueType: 'amount' | 'quantity' | 'ratio'
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
  valueType: 'amount' | 'quantity' | 'ratio'
  isLeaf: boolean
  dataType: 'data' | 'calc' | 'display'
  orderNo: number
}

function round2(n: number): number {
  return Number(n.toFixed(2))
}

/** 去除重分类影响时的回放统计（透出给上层做前端提示） */
export interface ReclassifyReversalMeta {
  appliedLogs: number
  skippedLogs: number
}

export interface BuildTreeOpts {
  /** 为另一棵树构建外部值时置 true，跳过本树的跨树取数，防止互引递归 */
  skipExternal?: boolean
  /** 去除跨公司重分类影响：按日志快照回放差额叠加，还原重分类前口径（只读模拟） */
  excludeReclassify?: boolean
  /** 回放统计收集器（调用方传入，聚合过程中累加） */
  reclassifyMeta?: ReclassifyReversalMeta
}

/** 将汇总主体编码经 company_aggregation_map 递归展开为其所有单体成员；单体编码原样保留 */
async function expandSummaries(codes: string[]): Promise<string[]> {
  if (codes.length === 0) return []
  const visited = new Set<string>()
  const queue = [...codes]
  const singleCodes = new Set<string>()
  let depth = 0
  while (queue.length > 0 && depth < 20) {
    const batch = queue.splice(0, queue.length)
    const companies = await prisma.company.findMany({ where: { code: { in: batch } }, select: { code: true, entityType: true } })
    const summaryCodes = companies.filter((c) => c.entityType === 'summary').map((c) => c.code)
    for (const c of companies.filter((c) => c.entityType === 'single')) singleCodes.add(c.code)
    if (summaryCodes.length > 0) {
      const maps = await prisma.companyAggregationMap.findMany({ where: { summaryCompanyCode: { in: summaryCodes } }, select: { singleCompanyCode: true } })
      for (const m of maps) {
        if (!visited.has(m.singleCompanyCode)) {
          visited.add(m.singleCompanyCode)
          queue.push(m.singleCompanyCode)
        }
      }
    }
    depth++
  }
  return Array.from(singleCodes)
}

/**
 * 解析当前用户的有效公司编码集合（叠加可选的公司过滤）。
 * 返回值恒为单体编码：汇总主体经映射展开为成员，其自身编码不参与事实表过滤（否则重复计算）。
 * 越权访问显式抛 403（默认拒绝），不再静默返回部分数据 —— 汇总主体按「全有或全无」授权，
 * 避免把「部分成员之和」当作汇总总额呈现。
 */
export async function resolveCompanyCodes(
  authUser: Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & { dataScopeCodes?: string[] | null },
  requestedCompany?: string,
): Promise<string[]> {
  // 请求链路已由 attachScope 解析并缓存范围，直接复用；无上下文（脚本/单测）时按传入用户解析。
  // getCross 会逐个公司调用本函数，避免重复解析带来的 N 倍查询开销。
  const scope = currentScope() ?? (await resolveScope(prisma, authUser))
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
    const requested = await prisma.company.findUnique({ where: { code: requestedCompany }, select: { code: true, entityType: true } })
    if (!requested) throw errors.notFound('公司不存在')
    if (requested.entityType === 'summary') {
      // 汇总主体：成员须被完整授权，否则拒绝（口径不得失真）
      if (scope.type !== 'all' && !(scope.type === 'companies' && scope.summaryCodes.includes(requestedCompany))) {
        throw errors.forbidden('无权访问该汇总主体（成员范围超出数据权限）')
      }
      return expandSummaries([requestedCompany])
    }
    if (scope.type !== 'all' && !base.includes(requestedCompany)) {
      throw errors.forbidden('无权访问该公司数据')
    }
    return [requestedCompany]
  }
  return base
}

/** ET0001 汇总主体编码（浙江省公司汇总，默认展示口径；无权限时降级到其他授权主体） */
export const ET0001 = 'ET0001'

/** 实际生效主体（含降级标记）：codes 为展开后的单体编码，companyCode 为实际生效主体 */
export interface EffectiveCompany {
  codes: string[]
  companyCode: string | null
  companyName: string | null
  companyType: 'single' | 'summary' | null
  /** 显式请求的主体越权/不存在而被替换 */
  degraded: boolean
}

/** 主体候选行（pickDefaultCompany 的返回载体） */
interface CompanyPick {
  code: string
  name: string
  shortName: string | null
  entityType: string
}

/**
 * 默认主体选择：ET0001 → 首个授权汇总主体 → 首个授权单体（均按 orderNo，与前端主体下拉一致）。
 * 汇总主体集合来自 scope.summaryCodes —— 已按「全有或全无」原则收敛，仅含成员被完整授权的汇总主体。
 */
export async function pickDefaultCompany(scope: DataScope): Promise<CompanyPick | null> {
  if (scope.type === 'none') return null
  const select = { code: true, name: true, shortName: true, entityType: true } as const
  if (scope.type === 'all') {
    const summaries = await prisma.company.findMany({ where: { entityType: 'summary', status: 'active' }, orderBy: { orderNo: 'asc' }, select })
    const singles = await prisma.company.findMany({ where: { entityType: 'single', status: 'active' }, orderBy: { orderNo: 'asc' }, select })
    return summaries.find((s) => s.code === ET0001) ?? summaries[0] ?? singles[0] ?? null
  }
  const summaries = await prisma.company.findMany({ where: { code: { in: scope.summaryCodes }, entityType: 'summary', status: 'active' }, orderBy: { orderNo: 'asc' }, select })
  const et0001 = summaries.find((s) => s.code === ET0001)
  if (et0001) return et0001
  if (summaries[0]) return summaries[0]
  const singles = await prisma.company.findMany({ where: { code: { in: scope.companyCodes }, entityType: 'single', status: 'active' }, orderBy: { orderNo: 'asc' }, select })
  return singles[0] ?? null
}

/**
 * 主体解析（看板/往来分析等默认主体降级共用）：显式请求的主体越权/不存在时优雅降级（不抛 403），
 * 降级顺序 ET0001 → 任一授权汇总主体 → 任一授权单体；无任何授权返回空范围（前端展示空态）。
 * 权限校验与汇总主体展开复用 resolveCompanyCodes（遵循「全有或全无」授权原则，口径不得失真）。
 */
export async function resolveDashboardCompany(
  scope: Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & { dataScopeCodes?: string[] | null },
  requestedCompany?: string,
): Promise<EffectiveCompany> {
  if (requestedCompany) {
    try {
      const codes = await resolveCompanyCodes(scope, requestedCompany)
      const company = await prisma.company.findUnique({
        where: { code: requestedCompany },
        select: { code: true, name: true, shortName: true, entityType: true },
      })
      return {
        codes,
        companyCode: requestedCompany,
        companyName: company ? (company.shortName ?? company.name) : requestedCompany,
        companyType: company?.entityType === 'summary' ? 'summary' : 'single',
        degraded: false,
      }
    } catch (e) {
      // 越权 403 / 主体不存在 404 → 降级到有权主体；其它异常（如 DB 故障）照常上抛
      if (!(e instanceof AppError)) throw e
    }
  }
  const scopeResolved = currentScope() ?? (await resolveScope(prisma, scope))
  const picked = await pickDefaultCompany(scopeResolved)
  if (!picked) {
    return { codes: [], companyCode: null, companyName: null, companyType: null, degraded: !!requestedCompany }
  }
  const codes = await resolveCompanyCodes(scope, picked.code)
  return {
    codes,
    companyCode: picked.code,
    companyName: picked.shortName ?? picked.name,
    companyType: picked.entityType === 'summary' ? 'summary' : 'single',
    degraded: !!requestedCompany,
  }
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
      direction: true, valueType: true, isLeaf: true, orderNo: true,
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

/** 公式是否含跨维度引用（@维度后缀 或 伪操作数如 DAYS_YTD） */
export function hasCrossDimRefs(formula: string): boolean {
  return extractOperandRefs(formula).some((r) => r.dim !== undefined || PSEUDO_OPERANDS.has(r.code))
}

/** 跨维度公式求值上下文（周转天数类指标） */
export interface CrossDimOptions {
  /** 求值列 →（引用维度码 → 取值来源维度码）；未配置的列不注入复合键（同期列自动平移为去年口径） */
  dimMap: Map<string, Record<string, string>>
  /** 求值列 → 伪操作数值（如 DAYS_YTD=财年累计天数） */
  pseudoByDim: Map<string, Record<string, number>>
  /** 含跨维度引用的公式在这些列置 0（时点列无周转口径） */
  zeroDims: Set<string>
  /** 跨树节点全维度值：code → 维度码 → 值（如静态公式引用经营 YTD 累计） */
  externalAllDims?: Record<string, Record<string, number>>
}

/**
 * 计算层：对含公式的计算类科目按 DAG 拓扑序用公式求值，逐维度覆盖"父=子求和"的默认值。
 * 无公式的计算类科目保持求和（向后兼容）；操作数缺失记 0；有环或单式报错则跳过该节点，不破坏整棵树。
 * externalByDim：跨树操作数（如静态比率引用经营科目），按维度提供 code→值；树内同 code 优先。
 * crossDim：跨维度公式（{CODE@维度}/{DAYS_YTD}）的复合键注入与列语义平移；
 * 注：复合键取自树默认聚合值快照，不随计算层推进更新（跨维度公式应引用数据类/求和类科目）。
 */
export function applyCalcLayer(
  roots: ValueNode[],
  calcFormulas: CalcFormula[],
  dims: string[],
  externalByDim?: Map<string, Record<string, number>>,
  crossDim?: CrossDimOptions,
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
  // 含跨维度引用的公式集合（受 zeroDims 置 0 规则约束）
  const crossDimCodes = new Set(present.filter((m) => hasCrossDimRefs(m.formula)).map((m) => m.code))
  // 每个维度维护 code→value 快照，先铺跨树外部值，再以树内值覆盖；随计算推进更新
  const dimValues = new Map<string, Record<string, number>>()
  for (const d of dims) {
    const rec: Record<string, number> = { ...(externalByDim?.get(d) ?? {}) }
    for (const n of flat) rec[n.code] = n.values[d] ?? 0
    // 跨维度复合键注入（按列语义平移：同期列取去年口径）+ 伪操作数
    const map = crossDim?.dimMap.get(d)
    if (map && crossDimCodes.size > 0) {
      for (const [refDim, srcDim] of Object.entries(map)) {
        for (const n of flat) {
          const v = n.values[srcDim]
          if (v !== undefined) rec[`${n.code}@${refDim}`] = v
        }
        if (crossDim?.externalAllDims) {
          for (const [code, vals] of Object.entries(crossDim.externalAllDims)) {
            const v = vals[srcDim]
            if (v !== undefined) rec[`${code}@${refDim}`] = v
          }
        }
      }
      Object.assign(rec, crossDim?.pseudoByDim.get(d) ?? {})
    }
    dimValues.set(d, rec)
  }
  for (const code of order) {
    const formula = formulaByCode.get(code)
    const node = byCode.get(code)
    if (!formula || !node) continue
    for (const d of dims) {
      const rec = dimValues.get(d) as Record<string, number>
      // 跨维度公式在时点列（年初/上年年初）无业务口径 → 置 0
      if (crossDimCodes.has(code) && crossDim?.zeroDims.has(d)) {
        node.values[d] = 0
        rec[code] = 0
        continue
      }
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
      dataType: s.dataType, direction: s.direction, valueType: s.valueType, isLeaf: s.isLeaf,
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
  /**
   * 经营指标聚合树：以原始 ACTUAL_MONTH 为基础，按选定期派生本月/同期/本年累计/同期累计。
   * @consumedBy buildStaticTree — 静态树跨树比率（如 ROE/ROA）依赖本方法输出的
   *   OPERATING_DIMS.ACTUAL_MONTH 与 OPERATING_DIMS.SAME_PERIOD_ACTUAL 维度值（number，万元，round2）。
   * @param opts.skipExternal 为另一棵树构建外部值时置 true，跳过本树的跨树取数，防止互引递归。
   */
  async buildOperatingTree(companyCodes: string[], period: string, opts?: BuildTreeOpts): Promise<ValueNode[]> {
    const subjects = await loadSubjects('operating')
    const leafValues = new Map<string, Record<string, number>>()
    const setDim = (acc: string, dim: string, v: number): void => {
      const rec = leafValues.get(acc) ?? { ...EMPTY_OPERATING }
      rec[dim] = v
      leafValues.set(acc, rec)
    }
    const addDim = (acc: string, dim: string, dv: number): void => {
      const rec = leafValues.get(acc) ?? { ...EMPTY_OPERATING }
      rec[dim] = round2((rec[dim] ?? 0) + dv)
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
      // 去除重分类影响：按快照回放差额叠加，与上方各维度派生口径一致
      if (opts?.excludeReclassify) {
        const companySet = new Set(companyCodes)
        const prevPeriod = periodMinusYears(period, 1)
        const fyStart = fiscalYearStartPeriod(period)
        const prevFyStart = fiscalYearStartPeriod(prevPeriod)
        const opRes = await ReclassifyReversalService.buildReversalDeltas('operating')
        for (const d of opRes.deltas) {
          if (!companySet.has(d.companyCode) || d.periodDimCode !== OPERATING_DIMS.ACTUAL_MONTH || !d.period) continue
          if (d.period === period) addDim(d.accountCode, OPERATING_DIMS.ACTUAL_MONTH, d.delta)
          if (d.period === prevPeriod) addDim(d.accountCode, OPERATING_DIMS.SAME_PERIOD_ACTUAL, d.delta)
          if (d.period >= fyStart && d.period <= period) addDim(d.accountCode, OPERATING_DIMS.YTD_ACTUAL, d.delta)
          if (d.period >= prevFyStart && d.period <= prevPeriod) addDim(d.accountCode, OPERATING_DIMS.SAME_PERIOD_YTD, d.delta)
        }
        const budgetRes = await ReclassifyReversalService.buildReversalDeltas('budget')
        const fy = fiscalYearLabel(period)
        for (const d of budgetRes.deltas) {
          if (!companySet.has(d.companyCode) || d.fiscalYear !== fy) continue
          addDim(d.accountCode, OPERATING_DIMS.BUDGET_AMOUNT, d.delta)
        }
        if (opts.reclassifyMeta) {
          opts.reclassifyMeta.appliedLogs += opRes.appliedLogs + budgetRes.appliedLogs
          opts.reclassifyMeta.skippedLogs += opRes.skippedLogs + budgetRes.skippedLogs
        }
      }
    }
    const tree = buildTree(subjects, leafValues, EMPTY_OPERATING)
    const calc = await loadCalcFormulas('operating')
    // 跨树依赖（对称方向）：经营计算类科目引用静态科目（ST_ 前缀）时，
    // 构建同选定期静态树，CURRENT_AMOUNT → ACTUAL_MONTH，SAME_PERIOD_AMOUNT → SAME_PERIOD_ACTUAL；
    // 外部树以 skipExternal 构建，避免两树互引时无限递归。
    let externalByDim: Map<string, Record<string, number>> | undefined
    const needsExternal = !opts?.skipExternal && calc.some((m) => m.dependsOn.some((d) => d.startsWith('ST_')))
    if (needsExternal && companyCodes.length > 0) {
      // 外部树透传同一去重分类口径（meta 不透传，避免重复计数）
      const stFlat = flattenValueTree(await AggregationService.buildStaticTree(companyCodes, period, { skipExternal: true, excludeReclassify: opts?.excludeReclassify }))
      const current: Record<string, number> = {}
      const same: Record<string, number> = {}
      for (const n of stFlat) {
        current[n.code] = n.values[STATIC_DIMS.CURRENT_AMOUNT] ?? 0
        same[n.code] = n.values[STATIC_DIMS.SAME_PERIOD_AMOUNT] ?? 0
      }
      externalByDim = new Map([
        [OPERATING_DIMS.ACTUAL_MONTH, current],
        [OPERATING_DIMS.SAME_PERIOD_ACTUAL, same],
      ])
    }
    applyCalcLayer(tree, calc, Object.keys(EMPTY_OPERATING), externalByDim)
    return tree
  },

  /**
   * 静态指标聚合树：以原始快照为基础，按选定期的快照月份派生本期/年初/同期/上年年初。
   * 年初/上年年初取财年起始月前一月（上年期末）快照，与资产负债表日（月末余额）语义对齐。
   * @param opts.skipExternal 为另一棵树构建外部值时置 true，跳过本树的跨树取数，防止互引递归。
   */
  async buildStaticTree(companyCodes: string[], period: string, opts?: BuildTreeOpts): Promise<ValueNode[]> {
    const subjects = await loadSubjects('static')
    const leafValues = new Map<string, Record<string, number>>()
    const setDim = (acc: string, dim: string, v: number): void => {
      const rec = leafValues.get(acc) ?? { ...EMPTY_STATIC }
      rec[dim] = v
      leafValues.set(acc, rec)
    }
    const addDim = (acc: string, dim: string, dv: number): void => {
      const rec = leafValues.get(acc) ?? { ...EMPTY_STATIC }
      rec[dim] = round2((rec[dim] ?? 0) + dv)
      leafValues.set(acc, rec)
    }
    if (companyCodes.length > 0) {
      const batchIds = await activeBatchIds('static')
      if (batchIds.length > 0) {
        const prev = periodMinusYears(period, 1)
        // 年初快照月 = 财年起始月前一月（上年期末余额时点，如 S=4 且 FY2026 → 2026-03）
        const opening = fiscalYearOpeningSnapshotPeriod(period)
        // 输出维度 → 目标快照月份
        const dimTargets: [string, string][] = [
          [STATIC_DIMS.CURRENT_AMOUNT, period],
          [STATIC_DIMS.YEAR_START, opening],
          [STATIC_DIMS.SAME_PERIOD_AMOUNT, prev],
          [STATIC_DIMS.LAST_YEAR_START, periodMinusYears(opening, 1)],
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
        // 去除重分类影响：差额按快照月份匹配四个输出维度叠加
        if (opts?.excludeReclassify) {
          const companySet = new Set(companyCodes)
          const stRes = await ReclassifyReversalService.buildReversalDeltas('static')
          for (const d of stRes.deltas) {
            if (!companySet.has(d.companyCode) || !d.snapshotMonth) continue
            for (const [dim, tPeriod] of dimTargets) {
              if (d.snapshotMonth === tPeriod) addDim(d.accountCode, dim, d.delta)
            }
          }
          if (opts.reclassifyMeta) {
            opts.reclassifyMeta.appliedLogs += stRes.appliedLogs
            opts.reclassifyMeta.skippedLogs += stRes.skippedLogs
          }
        }
      }
    }
    const tree = buildTree(subjects, leafValues, EMPTY_STATIC)
    const calc = await loadCalcFormulas('static')
    /**
     * 跨树依赖契约：当静态计算类科目引用经营科目（OP_ 前缀）时，需调用 buildOperatingTree
     * 获取同选定期经营树，并读取其 ValueNode.values 中的维度键：
     *   - OPERATING_DIMS.ACTUAL_MONTH  → 映射至 STATIC_DIMS.CURRENT_AMOUNT
     *   - OPERATING_DIMS.SAME_PERIOD_ACTUAL → 映射至 STATIC_DIMS.SAME_PERIOD_AMOUNT
     * 数值格式：number（万元），经 round2 处理；缺失时回退为 0。
     */
    let externalByDim: Map<string, Record<string, number>> | undefined
    let externalAllDims: Record<string, Record<string, number>> | undefined
    const needsExternal = !opts?.skipExternal && calc.some((m) => m.dependsOn.some((d) => d.startsWith('OP_')))
    if (needsExternal && companyCodes.length > 0) {
      // 外部树透传同一去重分类口径（meta 不透传，避免重复计数）
      const opFlat = flattenValueTree(await AggregationService.buildOperatingTree(companyCodes, period, { skipExternal: true, excludeReclassify: opts?.excludeReclassify }))
      const current: Record<string, number> = {}
      const same: Record<string, number> = {}
      externalAllDims = {}
      for (const n of opFlat) {
        current[n.code] = n.values[OPERATING_DIMS.ACTUAL_MONTH] ?? 0
        same[n.code] = n.values[OPERATING_DIMS.SAME_PERIOD_ACTUAL] ?? 0
        // 全 5 维快照：供跨维度公式的复合键引用（如 {OP_0201@YTD_ACTUAL}）
        externalAllDims[n.code] = { ...n.values }
      }
      externalByDim = new Map([
        [STATIC_DIMS.CURRENT_AMOUNT, current],
        [STATIC_DIMS.SAME_PERIOD_AMOUNT, same],
      ])
    }
    // 跨维度公式（{CODE@维度}/{DAYS_YTD}，如周转天数）的列语义上下文：
    // 本期列按字面维度取值；同期列平移为去年口径；年初/上年年初两列置 0（时点无周转口径）。
    let crossDim: CrossDimOptions | undefined
    if (calc.some((m) => hasCrossDimRefs(m.formula))) {
      const prevPeriod = periodMinusYears(period, 1)
      const identity: Record<string, string> = {}
      for (const dim of [...Object.values(OPERATING_DIMS), ...Object.values(STATIC_DIMS)]) identity[dim] = dim
      crossDim = {
        dimMap: new Map([
          [STATIC_DIMS.CURRENT_AMOUNT, identity],
          [STATIC_DIMS.SAME_PERIOD_AMOUNT, {
            [STATIC_DIMS.CURRENT_AMOUNT]: STATIC_DIMS.SAME_PERIOD_AMOUNT,
            [STATIC_DIMS.YEAR_START]: STATIC_DIMS.LAST_YEAR_START,
            [OPERATING_DIMS.ACTUAL_MONTH]: OPERATING_DIMS.SAME_PERIOD_ACTUAL,
            [OPERATING_DIMS.YTD_ACTUAL]: OPERATING_DIMS.SAME_PERIOD_YTD,
          }],
        ]),
        pseudoByDim: new Map([
          [STATIC_DIMS.CURRENT_AMOUNT, { DAYS_YTD: fiscalYtdDays(period) }],
          [STATIC_DIMS.SAME_PERIOD_AMOUNT, { DAYS_YTD: fiscalYtdDays(prevPeriod) }],
        ]),
        zeroDims: new Set([STATIC_DIMS.YEAR_START, STATIC_DIMS.LAST_YEAR_START]),
        externalAllDims,
      }
    }
    applyCalcLayer(tree, calc, Object.keys(EMPTY_STATIC), externalByDim, crossDim)
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
