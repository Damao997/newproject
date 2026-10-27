import { errors } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { resolveDashboardCompany, resolveCompanyCodes } from './AggregationService'
import { BudgetRatioService } from './BudgetRatioService'
import { availablePeriods } from './DashboardService'
import { latestOperatingPeriod } from './IndicatorsService'
import { fiscalYearLabel, fiscalYearStartPeriod, periodsInRange } from '../lib/period'
import { analysisQuerySchema, COL_MEMBER_LIMIT, DEFAULT_FILTERS, DEFAULT_OPTIONS, type RowDim } from '../lib/analysis-query'
import { ROW_ADAPTERS, ROW_DIM_GROUPS, type AdapterContext, type AdapterResult, type AdapterScope } from './analysis/row-adapters'
import { resolveColMembers, type ColMember } from './analysis/col-members'
import {
  columnsFor, isValidMetricForDim, projectRow, DEFAULT_METRICS,
  type MetricColumn,
} from './analysis/metric-catalog'

/**
 * 即席分析查询编排层（见 docs/plans/即席分析模块技术方案.md §3、
 * docs/plans/即席分析-L1L2-阶段方案.md §2.1 矩阵模式）。
 *
 * 流程：校验 spec（zod）→ 校验指标列 → 解析生效主体/期间 → 选行维度适配器 →
 * 按指标字典投影列 → 组装响应。聚合算法全部复用 AggregationService /
 * DashboardService 现有纯函数，本层只做「选择器」。
 *
 * 矩阵模式（colDim 存在）：列成员循环跑同一行适配器
 *   colDim = company            → 换 ctx.companyCodes / consolidationSummaryCode（正交维度逐主体聚合）
 *   colDim = 科目维度            → ctx.colSubjectFilter = 成员科目集（聚合树收敛）
 * 行骨架与 __total 取自全量切片（= v1 单轴结果），保证旧渲染不回退。
 */

export interface AnalysisQueryRow {
  code: string
  name: string
  level: number
  isTotal: boolean
  /** key 与 columns[].key 对齐；null = 不适用/无预算（前端显示「—」）；矩阵模式 = __total */
  values: Record<string, number | null>
  /** 矩阵模式（v2）：列成员编码 → 指标值（含 "__total" 行小计，与 values 相同） */
  cells?: Record<string, Record<string, number | null>>
}

export interface AnalysisQueryResult {
  period: string
  rowDim: RowDim
  colDim?: RowDim
  colMembers?: ColMember[]
  companyCode: string | null
  companyName: string | null
  companyType: 'single' | 'summary' | null
  degraded: boolean
  columns: MetricColumn[]
  rows: AnalysisQueryRow[]
  totals?: { values: Record<string, number | null> }
  meta: { skippedReclassifyLogs: number; unmatchedRows: string[] }
}

export const AnalysisQueryService = {
  async query(scope: AdapterScope, input: unknown): Promise<AnalysisQueryResult> {
    const parsed = analysisQuerySchema.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw errors.badRequest(issue ? `${issue.path.join('.') || 'body'}：${issue.message}` : '请求参数校验失败')
    }
    const spec = parsed.data
    const rowDim = spec.rowDim
    const colDim = spec.colDim
    const groupNames = ROW_DIM_GROUPS[rowDim]
    const filters = spec.filters ?? DEFAULT_FILTERS
    const options = spec.options ?? DEFAULT_OPTIONS

    // 指标列校验：非法 key 直接 400，不静默忽略（否则前端拿到的列与请求不符且无提示）
    const metricKeys = spec.metrics ?? DEFAULT_METRICS[rowDim]
    if (metricKeys.length === 0) throw errors.badRequest('metrics 不能为空数组')
    const invalid = metricKeys.filter((k) => !isValidMetricForDim(k, groupNames))
    if (invalid.length > 0) throw errors.badRequest(`不支持的指标：${invalid.join(', ')}`)

    // 生效主体（越权自动降级，与现有看板同源策略）+ 可用期间
    const [eff, periods] = await Promise.all([resolveDashboardCompany(scope, spec.companyCode), availablePeriods()])
    if (spec.period && !periods.includes(spec.period)) throw errors.badRequest(`期间 ${spec.period} 不在可用期间内`)
    const period = spec.period ?? periods[periods.length - 1] ?? (await latestOperatingPeriod())

    // 去重分类回放统计收集器（各适配器共享，聚合过程中累加）
    const reclassifyMeta = { appliedLogs: 0, skippedLogs: 0 }
    const baseCtx = {
      scope,
      companyCodes: eff.codes,
      period,
      periodIndex: periodsInRange(fiscalYearStartPeriod(period), period).length - 1,
      ratios: await BudgetRatioService.budgetRatiosOf(fiscalYearLabel(period)),
      consolidationSummaryCode: eff.companyType === 'summary' ? eff.companyCode : null,
      excludeReclassify: filters.excludeReclassify,
      reclassifyMeta,
      filters,
      options,
    }

    // 列成员解析（colCodes 过滤 → 上限校验）
    let colMembers: ColMember[] = []
    if (colDim) {
      colMembers = await resolveColMembers(colDim)
      if (spec.colCodes.length > 0) {
        const wanted = new Set(spec.colCodes)
        colMembers = colMembers.filter((m) => wanted.has(m.code))
      }
      if (colMembers.length === 0) throw errors.badRequest('列维度无可用成员（请检查配置或 colCodes）')
      if (colMembers.length > COL_MEMBER_LIMIT) throw errors.badRequest(`列成员数 ${colMembers.length} 超过上限 ${COL_MEMBER_LIMIT}`)
    }

    const columns = columnsFor(metricKeys, groupNames)

    // 无任何数据权限：返回空结果（前端展示空态），而非全 0 行或报错
    const runSlice = async (ctx: AdapterContext): Promise<AdapterResult> => eff.codes.length === 0
      ? { groupNames, rows: [], unmatched: [] }
      : await ROW_ADAPTERS[rowDim](ctx)

    const full = await runSlice(baseCtx)
    const totals = options.includeTotals ? full.totals : undefined
    const projectFull = (groups: AdapterResult['rows'][number]['groups']) =>
      projectRow(groups, metricKeys, groupNames, totals)

    if (!colDim) {
      // v1 单轴形态（无 cells 字段）
      return {
        period,
        rowDim,
        companyCode: eff.companyCode,
        companyName: eff.companyName,
        companyType: eff.companyType,
        degraded: eff.degraded,
        columns,
        rows: full.rows.map((r) => ({ code: r.code, name: r.name, level: r.level, isTotal: r.isTotal, values: projectFull(r.groups) })),
        ...(totals ? { totals: { values: projectFull(totals) } } : {}),
        meta: { skippedReclassifyLogs: reclassifyMeta.skippedLogs, unmatchedRows: full.unmatched },
      }
    }

    // 矩阵模式：列成员循环跑行适配器，按 code 回填到行骨架
    const cellsByRow = new Map<string, Record<string, Record<string, number | null>>>()
    for (const row of full.rows) cellsByRow.set(row.code, {})

    for (const member of colMembers) {
      let memberCtx: AdapterContext
      if (colDim === 'company') {
        // 正交维度：换成员主体（越权成员由 resolveCompanyCodes 抛错 → 跳过该列）
        let memberCodes: string[]
        try {
          memberCodes = await resolveCompanyCodes(scope, member.code)
        } catch { continue }
        const company = await prisma.company.findUnique({
          where: { code: member.code }, select: { entityType: true },
        })
        memberCtx = {
          ...baseCtx,
          companyCodes: memberCodes,
          consolidationSummaryCode: company?.entityType === 'summary' ? member.code : null,
        }
      } else {
        // 科目维度：聚合树按成员科目集收敛
        memberCtx = { ...baseCtx, colSubjectFilter: new Set(member.subjectCodes) }
      }
      const slice = await runSlice(memberCtx)
      for (const r of slice.rows) {
        const cell = cellsByRow.get(r.code)
        if (cell) cell[member.code] = projectFull(r.groups)
      }
    }

    const rows: AnalysisQueryRow[] = full.rows.map((r) => {
      const cells = cellsByRow.get(r.code) ?? {}
      const totalValues = projectFull(r.groups)
      return {
        code: r.code,
        name: r.name,
        level: r.level,
        isTotal: r.isTotal,
        values: totalValues,
        cells: { ...cells, __total: totalValues },
      }
    })

    return {
      period,
      rowDim,
      colDim,
      colMembers,
      companyCode: eff.companyCode,
      companyName: eff.companyName,
      companyType: eff.companyType,
      degraded: eff.degraded,
      columns,
      rows,
      ...(totals ? { totals: { values: projectFull(totals) } } : {}),
      meta: { skippedReclassifyLogs: reclassifyMeta.skippedLogs, unmatchedRows: full.unmatched },
    }
  },
}
