import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryKeys, useAggregationMap, useCompanies, type OperatingResult, type StaticResult, type CashflowResult, type OperatingRow, type StaticRow, type CashflowRow } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import type { MetricValue } from '@/lib/metric-values'

/**
 * 汇总主体成员明细数据 hook：悬浮展示"汇总指标 → 各单体公司数值"的数据源。
 *
 * 数据策略（纯前端，零后端改动）：页面处于汇总主体口径时，对成员清单内的每个单体公司
 * 并行预取与主查询**完全相同**的指标接口（复用 queryKeys 保证缓存互通），挂载即后台拉取、
 * staleTime 5min —— hover 时全部命中缓存，零网络等待（<300ms 响应）。
 *
 * 口径说明：汇总展示值 = Σ成员值 + 汇总抵消调整（后端 consolidationSummaryCode 叠加），
 * 成员之和与汇总值的差额（抵消净额）由浮层组件呈现"汇总抵消调整"行对平。
 */

type IndicatorVariant = 'operating' | 'static' | 'cashflow'

/** 单个成员公司在某科目上的取值 */
export interface MemberValue {
  /** 成员公司编码（EN 开头单体） */
  code: string
  /** 成员公司显示名（跟随全局显示简称开关） */
  name: string
  /** 该科目/类目下的期间维度指标值 */
  value: MetricValue
}

/** 成员取值查询结果：undefined = 成员清单未就绪（不启用）；loading = 树仍在预取 */
export interface MemberBreakdown {
  rows: MemberValue[]
  /** 预取失败成员数（浮层标注提示，不阻塞其余成员展示） */
  failedCount: number
  loading: boolean
}

interface MemberIndex {
  /** 科目编码 → 指标值（字段归一口径与 indicators-adapters.adapt 一致） */
  map: Map<string, MetricValue>
  /** level0 根行（含 children，供类目定位 + 名称子树 DFS，对齐后端 findInCategory 口径） */
  rootRows: MemberRow[]
}

type MemberRow = OperatingRow | StaticRow | CashflowRow

/** 成员树行 → 统一 MetricValue（与 indicators-adapters.adapt 的三分支字段映射保持一致） */
function rowToMetricValue(r: MemberRow, variant: IndicatorVariant): MetricValue {
  if (variant === 'operating') {
    const o = r as OperatingRow
    return { budget: o.budget, actual: o.actual, samePeriod: o.samePeriod, ytd: o.ytd, samePeriodYtd: o.samePeriodYtd }
  }
  if (variant === 'cashflow') {
    const f = r as CashflowRow
    // 现金流：本月→actual、同期→samePeriod、本年累计→ytd、同期累计→samePeriodYtd
    return { budget: 0, actual: f.current, samePeriod: f.samePeriod, ytd: f.ytd, samePeriodYtd: f.samePeriodYtd }
  }
  const s = r as StaticRow
  // 静态：本期→actual、同期→samePeriod、年初→ytd、上年年初→samePeriodYtd
  return { budget: s.yearStart, actual: s.current, samePeriod: s.samePeriod, ytd: s.yearStart, samePeriodYtd: s.lastYearStart }
}

/** 成员树扁平化：递归收集 科目编码→值，并保留 level0 根行（含 children） */
function buildMemberIndex(rows: MemberRow[], variant: IndicatorVariant): MemberIndex {
  const map = new Map<string, MetricValue>()
  const walk = (rs: MemberRow[]) => {
    for (const r of rs) {
      map.set(r.code, rowToMetricValue(r, variant))
      if (r.children && r.children.length > 0) walk(r.children as MemberRow[])
    }
  }
  walk(rows)
  return { map, rootRows: rows }
}

/** 子树内按名称关键字 DFS（includes 命中即返回，先根后子，与后端 findInCategory.walk 一致） */
function findByName(rows: MemberRow[], keyword: string): MemberRow | undefined {
  for (const r of rows) {
    if (r.name.includes(keyword)) return r
    const hit = r.children && r.children.length > 0 ? findByName(r.children as MemberRow[], keyword) : undefined
    if (hit) return hit
  }
  return undefined
}

/**
 * 类目 + 名称关键字定位成员树节点值（导出供单测）。
 * 先按 category 找 level0 根：rootName 缺省取根值；否则复刻后端 DashboardService.findInCategory
 * 口径——根名 includes 关键字优先取根，未命中再在子树内 DFS。
 * 注意「净利润」不是 level0 段名，是「经营成果」段下的一级子科目（壹品慧净利润），必须走子树 DFS。
 */
export function pickMemberRootValue(
  rows: MemberRow[],
  variant: IndicatorVariant,
  category: string,
  rootName?: string,
): MetricValue | undefined {
  const root = rows.find((r) => r.category === category)
  if (!root) return undefined
  if (!rootName || root.name.includes(rootName)) return rowToMetricValue(root, variant)
  const hit = root.children && root.children.length > 0 ? findByName(root.children as MemberRow[], rootName) : undefined
  return hit ? rowToMetricValue(hit, variant) : undefined
}

export interface SummaryMemberValuesOptions {
  /** 指标体系（决定预取端点与字段映射） */
  variant: IndicatorVariant
  /** 选定期（undefined 时后端取最新期，与主查询一致） */
  period?: string
  /** 汇总主体编码；null/undefined → hook 不启用（单体公司/全部公司口径） */
  summaryCode: string | null
  /** 重分类排除开关（仅经营/静态接口有此参数；与指标页主查询保持一致避免口径错位） */
  excludeReclassify?: boolean
}

export interface SummaryMemberValuesResult {
  /** 成员公司清单（按公司 orderNo 升序，无 orderNo 按编码兜底） */
  members: { code: string; name: string }[]
  /** 按科目编码取各成员值；undefined = 成员清单未就绪 / 任一成员树仍在加载 */
  getMemberValues(subjectCode: string): MemberBreakdown | undefined
  /** 按 level0 类目定位各成员值；rootName 提供时在类目子树内按名称关键字 DFS（与后端 metricNodes/findInCategory 同口径） */
  getMemberRoots(category: string, rootName?: string): MemberBreakdown | undefined
  /** 全部成员树预取完成（无失败） */
  ready: boolean
  /** 是否启用（汇总主体且已配置成员映射）——调用方据此决定是否渲染悬浮 */
  enabled: boolean
}

export function useSummaryMemberValues(opts: SummaryMemberValuesOptions): SummaryMemberValuesResult {
  const { variant, period, summaryCode, excludeReclassify } = opts

  // 成员清单：汇总映射（后端已按 summaryCode 过滤）→ 去重；显示名跟随全局简称开关
  const { data: maps, isLoading: mapsLoading } = useAggregationMap(summaryCode)
  const { displayNameMap } = useCompanyDisplayName()
  const { data: companies } = useCompanies()

  const members = useMemo(() => {
    if (!summaryCode) return []
    const seen = new Set<string>()
    const list: { code: string; name: string }[] = []
    for (const m of maps ?? []) {
      if (m.summaryCompanyCode !== summaryCode || seen.has(m.singleCompanyCode)) continue
      seen.add(m.singleCompanyCode)
      list.push({ code: m.singleCompanyCode, name: displayNameMap.get(m.singleCompanyCode) ?? m.singleCompanyName })
    }
    // 与主体展示顺序对齐：按公司 orderNo 升序（无配置按编码兜底）
    const orderByCode = new Map((companies ?? []).map((c) => [c.code, c.orderNo ?? Number.MAX_SAFE_INTEGER]))
    list.sort((a, b) => (orderByCode.get(a.code) ?? 0) - (orderByCode.get(b.code) ?? 0) || a.code.localeCompare(b.code))
    return list
  }, [maps, summaryCode, displayNameMap, companies])

  // 成员树并行预取：与指标页主查询同 key 同参（缓存互通），挂载即后台拉取
  const queries = useQueries({
    queries: useMemo(
      () =>
        members.map((m) => {
          if (variant === 'operating') {
            const params = { companyCode: m.code, period, excludeReclassify: excludeReclassify || undefined }
            return {
              queryKey: queryKeys.indicatorsOperating(params),
              queryFn: () => api.getOperatingIndicators(params as never) as unknown as Promise<OperatingResult>,
              staleTime: 5 * 60 * 1000,
            }
          }
          if (variant === 'cashflow') {
            const params = { companyCode: m.code, period }
            return {
              queryKey: queryKeys.indicatorsCashflow(params),
              queryFn: () => api.getCashflowIndicators(params as never) as unknown as Promise<CashflowResult>,
              staleTime: 5 * 60 * 1000,
            }
          }
          const params = { companyCode: m.code, period, excludeReclassify: excludeReclassify || undefined }
          return {
            queryKey: queryKeys.indicatorsStatic(params),
            queryFn: () => api.getStaticIndicators(params as never) as unknown as Promise<StaticResult>,
            staleTime: 5 * 60 * 1000,
          }
        }),
      [members, variant, period, excludeReclassify],
    ),
  })

  // 每成员索引：成功 → 建索引；失败 → 标记；加载中 → undefined
  const indexes = useMemo(
    () =>
      queries.map((q, i) => {
        const data = q.data as OperatingResult | StaticResult | CashflowResult | undefined
        return {
          member: members[i],
          index: data ? buildMemberIndex((data.items ?? []) as MemberRow[], variant) : null,
          isLoading: q.isLoading,
          isError: q.isError,
        }
      }),
    [queries, members, variant],
  )

  const enabled = !mapsLoading && members.length > 0
  const anyLoading = mapsLoading || indexes.some((x) => x.isLoading)
  const allSettled = !mapsLoading && indexes.length > 0 && indexes.every((x) => !x.isLoading)
  const failedCount = indexes.filter((x) => x.isError).length
  const ready = allSettled && failedCount === 0

  const collect = (pick: (idx: MemberIndex) => MetricValue | undefined): MemberBreakdown | undefined => {
    if (mapsLoading || members.length === 0) return undefined
    if (anyLoading) return { rows: [], failedCount: 0, loading: true }
    const rows: MemberValue[] = []
    let failed = 0
    for (const x of indexes) {
      const v = x.index ? pick(x.index) : undefined
      if (!x.index || !v) {
        failed += 1
        continue
      }
      rows.push({ code: x.member.code, name: x.member.name, value: v })
    }
    return { rows, failedCount: failed, loading: false }
  }

  const getMemberValues = (subjectCode: string): MemberBreakdown | undefined =>
    collect((idx) => idx.map.get(subjectCode))

  const getMemberRoots = (category: string, rootName?: string): MemberBreakdown | undefined =>
    collect((idx) => pickMemberRootValue(idx.rootRows, variant, category, rootName))

  return { members, getMemberValues, getMemberRoots, ready, enabled }
}
