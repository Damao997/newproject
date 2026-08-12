import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { MonthPicker } from '@/components/ui/month-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CompanyMultiSelect } from '@/components/filters/company-select'
import { PageContainer } from '@/components/layout/page-container'
import { AnalysisDrawer, type AnalysisTarget } from '@/components/indicators/analysis-drawer'
import {
  useAvailablePeriods,
  useCompanies,
  useInventoryDetails,
  useInventoryOverview,
  useSubjectTree,
  type InventoryDetailRow,
} from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { usePermission } from '@/hooks/usePermission'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'
import { cn, formatMoneyWan, getChangeColor, getChangePrefix } from '@/lib/utils'
import { exportToExcel } from '@/lib/export'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Boxes,
  CalendarClock,
  Download,
  FileText,
  Package,
  RefreshCw,
  Search,
  TrendingUp,
  X,
} from 'lucide-react'
import { CategoryPieCard } from './category-pie-card'
import { CategoryRankCard } from './category-rank-card'
import { CompanyShareCard } from './company-share-card'
import { InventoryTrendCard } from './trend-card'
import { EmptyHint } from './empty-hint'

/**
 * 存货管理页：数据源为静态数据（fact_static 存货品类叶子科目），
 * 按 期间 × 公司 × 品类 聚合展示总览 KPI、品类占比/排名、财年趋势与公司×品类明细；
 * 周转指标直接复用静态树「存货周转天数」，与指标页口径一致。金额单位：万元。
 *
 * 交互增强：饼图/排名图点击钻取品类 → 明细表联动筛选；明细表支持维度切换
 * （按公司汇总/按品类展开/公司×品类明细）、排序、关键词搜索（300ms 防抖持久化）、
 * 合计行、批量勾选与 Excel 导出；按公司汇总行支持公司级「分析」（存货根科目）；
 * 选中单个汇总主体时趋势卡旁展示成员单体公司占比饼图。
 */

/** KPI 图标底色：与看板四色体系一致（图表序列色），按序轮换 */
const KPI_ACCENTS = [
  'bg-chart-1/10 text-chart-1',
  'bg-chart-2/10 text-chart-2',
  'bg-chart-3/10 text-chart-3',
  'bg-chart-5/10 text-chart-5',
]

// ===== 明细表：维度模型与排序 =====

type DetailDim = 'company' | 'category' | 'detail'

/** 明细表统一行模型：三种维度（按公司汇总/按品类展开/公司×品类明细）共用一条流水线 */
interface ViewRow {
  /** 公司: `c:${code}`；品类: `k:${code}`；明细: `${companyCode}-${categoryCode}` */
  key: string
  /** 粘性列展示：公司显示名 / 品类名 / 公司显示名 */
  label: string
  /** 仅公司模式携带，供公司级「分析」取目标公司 */
  company?: { code: string; name: string }
  /** 仅明细模式携带，供行级「分析」取公司×品类上下文 */
  detail?: InventoryDetailRow
  /** 预拼接小写搜索文本：label + 编码 +（明细模式）品类名/编码 */
  searchText: string
  current: number
  yearStart: number
  samePeriod: number
  /** 公司模式用于指标上下文 samePeriodYtd */
  lastYearStart: number
  /** 聚合行按汇总值重算；无口径 NaN */
  yoy: number
}

type SortKey = 'current' | 'yearStart' | 'vsYearStart' | 'samePeriod' | 'yoy'
interface SortState { key: SortKey; dir: 'asc' | 'desc' }

/** 排序取值：较年初/同比为派生比率，分母为 0 无口径返回 NaN（排序时恒置末尾） */
function sortValue(row: ViewRow, key: SortKey): number {
  switch (key) {
    case 'current': return row.current
    case 'yearStart': return row.yearStart
    case 'samePeriod': return row.samePeriod
    case 'vsYearStart': return row.yearStart ? ((row.current - row.yearStart) / row.yearStart) * 100 : Number.NaN
    case 'yoy': return row.samePeriod ? row.yoy : Number.NaN
  }
}

function makeComparator(sort: SortState) {
  return (a: ViewRow, b: ViewRow) => {
    const av = sortValue(a, sort.key)
    const bv = sortValue(b, sort.key)
    const an = !Number.isFinite(av)
    const bn = !Number.isFinite(bv)
    if (an && bn) return 0
    if (an) return 1
    if (bn) return -1
    return sort.dir === 'asc' ? av - bv : bv - av
  }
}

/** 金额两位小数舍入（聚合行显示/导出口径） */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 空明细稳定引用：避免 `?? []` 每次渲染新建数组导致下游 memo 失效 */
const EMPTY_ROWS: InventoryDetailRow[] = []

/** 数值列导出定义（较年初/同比以带符号百分比文本导出，无口径 '-'） */
const NUMERIC_EXPORT_COLUMNS = [
  { header: '本期金额(万)', key: 'current', width: 14 },
  { header: '年初金额(万)', key: 'yearStart', width: 14 },
  { header: '较年初', key: 'vsYearStart', width: 10 },
  { header: '同期金额(万)', key: 'samePeriod', width: 14 },
  { header: '同比', key: 'yoy', width: 10 },
]

/** 各维度导出列（首列=维度标识列；明细模式为公司+品类两列） */
function exportColumns(dim: DetailDim) {
  if (dim === 'detail') {
    return [
      { header: '公司', key: 'company', width: 24 },
      { header: '品类', key: 'category', width: 18 },
      ...NUMERIC_EXPORT_COLUMNS,
    ]
  }
  return [
    { header: dim === 'company' ? '公司' : '品类', key: 'label', width: dim === 'company' ? 24 : 18 },
    ...NUMERIC_EXPORT_COLUMNS,
  ]
}

/** 各维度：卡片标题 / 空态标题与提示 / 可访问区域名 / 搜索无匹配提示 */
const DIM_TITLES: Record<DetailDim, string> = {
  company: '库存金额汇总 · 按公司',
  category: '库存金额汇总 · 按品类',
  detail: '公司 × 品类明细',
}
const DIM_EMPTY_TITLES: Record<DetailDim, string> = {
  company: '暂无公司数据',
  category: '暂无品类数据',
  detail: '暂无存货数据',
}
const DIM_EMPTY_HINTS: Record<DetailDim, string> = {
  company: '当前公司/期间无存货数据，请调整筛选条件',
  category: '当前公司/期间无存货品类数据，请调整筛选条件',
  detail: '当前公司/期间无存货品类数据，请调整筛选条件',
}
const DIM_REGION_LABELS: Record<DetailDim, string> = {
  company: '库存金额汇总（按公司）',
  category: '库存金额汇总（按品类）',
  detail: '公司×品类明细',
}
const DIM_SEARCH_EMPTY_HINTS: Record<DetailDim, string> = {
  company: '未找到匹配的公司，请调整品类钻取、搜索关键词',
  category: '未找到匹配的品类，请调整品类钻取、搜索关键词',
  detail: '未找到匹配的公司或品类，请调整品类钻取、搜索关键词',
}

const DEFAULT_SUMMARY_CODE = 'ET0001'

/** 默认筛选主体：ET0001 → 首个汇总主体 → 首个单体 → null（与往来总览页同款实现，保持两页行为一致） */
function useDefaultCompanyCode(): string | null {
  const { data: companies } = useCompanies()
  return useMemo(() => {
    const list = companies ?? []
    const et0001 = list.find((c) => c.code === DEFAULT_SUMMARY_CODE)
    if (et0001) return et0001.code
    const summary = list.find((c) => c.type === 'summary')
    if (summary) return summary.code
    const entity = list.find((c) => c.type === 'entity')
    return entity?.code ?? null
  }, [companies])
}

function StatCard({ title, icon: Icon, value, sub, index, loading }: {
  title: string
  icon: React.ElementType
  value: React.ReactNode
  sub?: React.ReactNode
  index: number
  loading?: boolean
}) {
  return (
    <Card
      className="animate-fade-in border border-border shadow-sm"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-5 pb-1 pt-5">
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground">{title}</CardTitle>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', KPI_ACCENTS[index % KPI_ACCENTS.length])}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        {loading ? (
          <div>
            <div className="skeleton h-8 w-24 rounded" />
            <div className="skeleton mt-2.5 h-4 w-16 rounded" />
          </div>
        ) : (
          <>
            <div className="font-num text-2xl font-bold leading-tight tracking-tight text-foreground">{value}</div>
            {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** 变动率徽标：红涨绿跌（国内财报习惯），分母为 0 显示 '-'，变动为 0 也显示 '-' */
function ChangeRate({ current, base }: { current: number; base: number }) {
  if (!base) return <span className="font-num text-muted-foreground">-</span>
  const rate = ((current - base) / base) * 100
  return (
    <span className={cn('font-num', getChangeColor(rate))}>
      {rate === 0 ? '-' : `${getChangePrefix(rate)}${Math.abs(rate).toFixed(1)}%`}
    </span>
  )
}

/** 周转天数展示：无口径（0）显示 '-' */
function formatDays(v: number): string {
  return v > 0 ? `${v.toFixed(1)} 天` : '-'
}

/** 查询失败提示 + 重试（overview/details 共用，模式同趋势卡） */
function QueryError({ message, onRetry, fetching }: { message?: string; onRetry: () => void; fetching?: boolean }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card">
      <p className="text-sm text-destructive">{message || '数据加载失败'}</p>
      <Button variant="outline" size="sm" disabled={fetching} onClick={onRetry}>
        <RefreshCw className="mr-1 h-3.5 w-3.5" />
        重试
      </Button>
    </div>
  )
}

/** 可排序表头：点击循环 无→降序→升序，aria-sort 供读屏识别 */
function SortableTh({ label, sortKey, sort, onSort }: {
  label: string
  sortKey: SortKey
  sort: SortState | null
  onSort: (key: SortKey) => void
}) {
  const active = sort?.key === sortKey
  const dir = active ? sort!.dir : 'desc'
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-2 py-2 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-0.5 transition-colors hover:text-primary"
      >
        {label}
        {active
          ? (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
          : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  )
}

export default function InventoryPage() {
  const { can } = usePermission()
  // 公司多选（空数组 = 全部公司）、期间单选（空串 = 跟随最新期间）、品类钻取与关键词；
  // 查询条件持久化到 pageStateStore（路由切换/刷新后恢复）
  const setInventory = usePageStore((s) => s.setInventory)
  const selectedCompanies = usePageStore((s) => s.inventory.companies)
  const periodFilter = usePageStore((s) => s.inventory.period)
  const categoryCode = usePageStore((s) => s.inventory.categoryCode)
  const storeKeyword = usePageStore((s) => s.inventory.keyword)
  const detailDim = usePageStore((s) => s.inventory.detailDim)
  const setSelectedCompanies = useCallback((v: string[]) => setInventory({ companies: v }), [setInventory])
  const setPeriodFilter = useCallback((v: string) => setInventory({ period: v }), [setInventory])
  const [analysisTarget, setAnalysisTarget] = useState<AnalysisTarget | null>(null)

  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const { data: periodsData } = useAvailablePeriods()
  // 期间候选按全局选中财年过滤
  const periods = useMemo(
    () => filterPeriodsByFiscalYear(periodsData?.periods ?? [], fiscalYear, periodsData?.fiscalStartMonth ?? 1),
    [periodsData, fiscalYear],
  )

  useEffect(() => {
    if (periods.length === 0) return
    // 首次加载默认选中最新期间；已选期间随财年切换失效时回退最新
    if (periodFilter === '' || !periods.includes(periodFilter)) {
      setPeriodFilter(periods[periods.length - 1])
    }
  }, [periods, periodFilter, setPeriodFilter])

  const period = periodFilter || periods[periods.length - 1]

  // 持久化公司多选校验：编码已删除/越权时过滤，全部失效则回退默认主体（候选加载后生效，用户手动切换后不再覆盖）
  const { data: companies } = useCompanies()
  const defaultCode = useDefaultCompanyCode()
  // 主体互斥业务规则：单体公司与汇总主体不能同时筛选；新增勾选某一类时自动取消另一类并提示（防止成员公司双重计数）
  const handleCompaniesChange = useCallback((next: string[]) => {
    const prev = usePageStore.getState().inventory.companies
    const typeOf = (code: string) => companies?.find((c) => c.code === code)?.type
    const added = next.filter((c) => !prev.includes(c))
    if (added.length > 0) {
      const addedType = typeOf(added[added.length - 1])
      if (addedType === 'entity' && next.some((c) => typeOf(c) === 'summary')) {
        window.alert('单体公司与汇总主体不能同时筛选，已自动取消已选汇总主体。')
        setSelectedCompanies(next.filter((c) => typeOf(c) !== 'summary'))
        return
      }
      if (addedType === 'summary' && next.some((c) => typeOf(c) === 'entity')) {
        window.alert('单体公司与汇总主体不能同时筛选，已自动取消已选单体公司。')
        setSelectedCompanies(next.filter((c) => typeOf(c) !== 'entity'))
        return
      }
    }
    setSelectedCompanies(next)
  }, [companies, setSelectedCompanies])
  useEffect(() => {
    if (!companies || companies.length === 0) return
    const valid = new Set(companies.map((c) => c.code))
    const cur = usePageStore.getState().inventory.companies
    if (cur.length === 0) return
    const filtered = cur.filter((c) => valid.has(c))
    if (filtered.length > 0) {
      if (filtered.length !== cur.length) setSelectedCompanies(filtered)
    } else if (defaultCode) {
      setSelectedCompanies([defaultCode])
    }
  }, [companies, defaultCode, setSelectedCompanies])

  // 成员公司占比饼图显示条件：恰好选中一个汇总主体时展示（单体/全部公司/多汇总不展示）
  const showCompanyShare = useMemo(() => {
    if (selectedCompanies.length !== 1 || !companies) return false
    return companies.find((c) => c.code === selectedCompanies[0])?.type === 'summary'
  }, [selectedCompanies, companies])

  // 看板深链：/inventory?companies=A,B&period=YYYY-MM 挂载时写入 store 后清理 URL，
  // 越权/失效值由上方校验与期间回退逻辑兜底；仅处理一次，避免刷新重复覆盖手动筛选
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkApplied = useRef(false)
  useEffect(() => {
    if (deepLinkApplied.current) return
    const companiesParam = searchParams.get('companies')
    const periodParam = searchParams.get('period')
    if (!companiesParam && !periodParam) return
    deepLinkApplied.current = true
    if (companiesParam) setSelectedCompanies(companiesParam.split(',').map((s) => s.trim()).filter(Boolean))
    if (periodParam) setPeriodFilter(periodParam)
    // 仅删除已消费的深链参数，保留 URL 上其他 query（避免 setSearchParams({}) 误清）
    const next = new URLSearchParams(searchParams)
    next.delete('companies')
    next.delete('period')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSelectedCompanies, setPeriodFilter, setSearchParams])

  const overviewQuery = useInventoryOverview({ period, companyCodes: selectedCompanies })
  const detailsQuery = useInventoryDetails({ period, companyCodes: selectedCompanies })
  const overview = overviewQuery.data
  const detailRows = detailsQuery.data?.rows ?? EMPTY_ROWS

  const { getDisplayName } = useCompanyDisplayName()

  // 「存货」根科目（静态树按名称解析，与后端 resolveInventorySubjects 口径一致），公司级分析主体
  const { data: staticTree } = useSubjectTree('static')
  const inventoryRoot = useMemo(() => staticTree?.find((n) => n.name === '存货') ?? null, [staticTree])

  // ===== 关键词搜索：输入 300ms 防抖后写入持久化 store =====
  const [keywordInput, setKeywordInput] = useState(storeKeyword)
  useEffect(() => { setKeywordInput(storeKeyword) }, [storeKeyword])
  useEffect(() => {
    const t = setTimeout(() => {
      const next = keywordInput.trim()
      if (next !== usePageStore.getState().inventory.keyword) setInventory({ keyword: next })
    }, 300)
    return () => clearTimeout(t)
  }, [keywordInput, setInventory])

  // ===== 图表 → 明细表品类钻取：再次点击同品类取消 =====
  const handleCategoryClick = useCallback((code: string) => {
    const cur = usePageStore.getState().inventory.categoryCode
    setInventory({ categoryCode: cur === code ? '' : code })
  }, [setInventory])

  const activeCategoryName = useMemo(() => {
    if (!categoryCode) return ''
    return overview?.categories.find((c) => c.code === categoryCode)?.name
      ?? detailRows.find((r) => r.categoryCode === categoryCode)?.categoryName
      ?? categoryCode
  }, [categoryCode, overview, detailRows])

  // ===== 明细表：按维度聚合（品类钻取先于聚合，三模式一致生效） → 搜索/排序 → 合计 =====
  const [sort, setSort] = useState<SortState | null>(null)
  const cycleSort = useCallback((key: SortKey) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 'desc' }
      if (s.dir === 'desc') return { key, dir: 'asc' }
      return null
    })
  }, [])

  const viewRows = useMemo<ViewRow[]>(() => {
    const base = categoryCode ? detailRows.filter((r) => r.categoryCode === categoryCode) : detailRows
    if (detailDim === 'company') {
      const by = new Map<string, { name: string; current: number; yearStart: number; samePeriod: number; lastYearStart: number }>()
      for (const r of base) {
        const acc = by.get(r.companyCode) ?? { name: r.companyName, current: 0, yearStart: 0, samePeriod: 0, lastYearStart: 0 }
        acc.current += r.current
        acc.yearStart += r.yearStart
        acc.samePeriod += r.samePeriod
        acc.lastYearStart += r.lastYearStart
        by.set(r.companyCode, acc)
      }
      return [...by.entries()].map(([code, v]) => {
        const current = round2(v.current)
        const yearStart = round2(v.yearStart)
        const samePeriod = round2(v.samePeriod)
        const lastYearStart = round2(v.lastYearStart)
        const displayName = getDisplayName(code, v.name)
        return {
          key: `c:${code}`,
          label: displayName,
          company: { code, name: v.name },
          searchText: `${displayName} ${code}`.toLowerCase(),
          current, yearStart, samePeriod, lastYearStart,
          yoy: samePeriod ? ((current - samePeriod) / samePeriod) * 100 : Number.NaN,
        }
      })
    }
    if (detailDim === 'category') {
      const by = new Map<string, { name: string; current: number; yearStart: number; samePeriod: number; lastYearStart: number }>()
      for (const r of base) {
        const acc = by.get(r.categoryCode) ?? { name: r.categoryName, current: 0, yearStart: 0, samePeriod: 0, lastYearStart: 0 }
        acc.current += r.current
        acc.yearStart += r.yearStart
        acc.samePeriod += r.samePeriod
        acc.lastYearStart += r.lastYearStart
        by.set(r.categoryCode, acc)
      }
      return [...by.entries()].map(([code, v]) => {
        const current = round2(v.current)
        const yearStart = round2(v.yearStart)
        const samePeriod = round2(v.samePeriod)
        const lastYearStart = round2(v.lastYearStart)
        return {
          key: `k:${code}`,
          label: v.name,
          searchText: `${v.name} ${code}`.toLowerCase(),
          current, yearStart, samePeriod, lastYearStart,
          yoy: samePeriod ? ((current - samePeriod) / samePeriod) * 100 : Number.NaN,
        }
      })
    }
    return base.map((r) => {
      const displayName = getDisplayName(r.companyCode, r.companyName)
      return {
        key: `${r.companyCode}-${r.categoryCode}`,
        label: displayName,
        detail: r,
        searchText: `${displayName} ${r.companyCode} ${r.companyName} ${r.categoryName} ${r.categoryCode}`.toLowerCase(),
        current: r.current, yearStart: r.yearStart, samePeriod: r.samePeriod, lastYearStart: r.lastYearStart, yoy: r.yoy,
      }
    })
  }, [detailRows, detailDim, categoryCode, getDisplayName])

  const visibleRows = useMemo(() => {
    const kw = storeKeyword.trim().toLowerCase()
    let rows = viewRows
    if (kw) rows = rows.filter((r) => r.searchText.includes(kw))
    if (sort) rows = [...rows].sort(makeComparator(sort))
    return rows
  }, [viewRows, storeKeyword, sort])

  const totals = useMemo(() => {
    const sum = (pick: (r: ViewRow) => number) => visibleRows.reduce((s, r) => s + pick(r), 0)
    return { current: sum((r) => r.current), yearStart: sum((r) => r.yearStart), samePeriod: sum((r) => r.samePeriod) }
  }, [visibleRows])

  // ===== 批量勾选与导出（页面只读，批量操作仅覆盖导出；维度切换时清空选择，避免跨模式脏键） =====
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => { setSelected(new Set()) }, [detailDim])
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.key))
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visibleRows.map((r) => r.key)))
  const toggleOne = (k: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })
  const selectedRows = useMemo(() => visibleRows.filter((r) => selected.has(r.key)), [visibleRows, selected])

  const [exporting, setExporting] = useState(false)
  const doExport = async (rows: ViewRow[], tag = '') => {
    if (rows.length === 0) return
    setExporting(true)
    try {
      const dimLabel = detailDim === 'company' ? '公司汇总' : detailDim === 'category' ? '品类展开' : '明细'
      const sheetName = detailDim === 'company' ? '按公司汇总' : detailDim === 'category' ? '按品类展开' : '公司×品类明细'
      await exportToExcel({
        filename: `存货_${dimLabel}${tag}_${period ?? ''}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName,
        columns: exportColumns(detailDim),
        rows: rows.map((r) => {
          const base = {
            current: r.current,
            yearStart: r.yearStart,
            vsYearStart: r.yearStart ? `${(((r.current - r.yearStart) / r.yearStart) * 100).toFixed(1)}%` : '-',
            samePeriod: r.samePeriod,
            yoy: r.samePeriod ? `${r.yoy >= 0 ? '+' : ''}${r.yoy.toFixed(1)}%` : '-',
          }
          if (detailDim === 'detail') {
            const d = r.detail
            return {
              company: d ? getDisplayName(d.companyCode, d.companyName) : r.label,
              category: d?.categoryName ?? '',
              ...base,
            }
          }
          return { label: r.label, ...base }
        }),
      })
    } finally {
      setExporting(false)
    }
  }

  /** 打开行级单项分析抽屉（公司×品类明细模式）：品类为静态科目，指标上下文映射与指标页静态口径一致 */
  const handleAnalyze = (row: ViewRow) => {
    const d = row.detail
    if (!period || !d) return
    setAnalysisTarget({
      companyCode: d.companyCode,
      companyName: d.companyName,
      subjectCode: d.categoryCode,
      subjectName: d.categoryName,
      subjectType: 'static',
      valueType: 'amount',
      // 库存分析不依赖全年预算：抽屉不展示预算/达成率，metricContext 不含 budget/achievement
      showBudget: false,
      fiscalYear: period.slice(0, 4),
      period,
      // 静态科目 → MetricValue：本期→actual、同期→samePeriod、年初→budget/ytd、上年年初→samePeriodYtd（budget/ytd 槽为年初金额占位，非预算数据）
      metric: { budget: d.yearStart, actual: d.current, samePeriod: d.samePeriod, ytd: d.yearStart, samePeriodYtd: d.lastYearStart },
    })
  }

  /** 打开公司级单项分析抽屉（按公司汇总模式）：分析主体为该公司「存货」根科目，指标上下文=公司跨品类汇总值 */
  const handleAnalyzeCompany = (row: ViewRow) => {
    if (!period || !row.company || !inventoryRoot) return
    setAnalysisTarget({
      companyCode: row.company.code,
      companyName: row.company.name,
      subjectCode: inventoryRoot.code,
      subjectName: inventoryRoot.name,
      subjectType: 'static',
      valueType: 'amount',
      // 库存分析不依赖全年预算：抽屉不展示预算/达成率，metricContext 不含 budget/achievement
      showBudget: false,
      fiscalYear: period.slice(0, 4),
      period,
      // 静态科目 → MetricValue：本期→actual、同期→samePeriod、年初→budget/ytd、上年年初→samePeriodYtd（budget/ytd 槽为年初金额占位，非预算数据）
      metric: { budget: row.yearStart, actual: row.current, samePeriod: row.samePeriod, ytd: row.yearStart, samePeriodYtd: row.lastYearStart },
    })
  }

  const canAnalyze = can('reports', 'create')
  const total = overview?.total
  const isOverviewLoading = overviewQuery.isLoading
  const turnover = overview?.turnoverDays
  const turnoverDelta = turnover ? turnover.current - turnover.samePeriod : 0

  return (
    <PageContainer
      title="存货管理"
      description="库存总览、品类占比、周转指标、趋势分析（数据源：静态数据存货品类）"
    >
      <div className="space-y-6">
        {/* 筛选卡：公司多选（单体/汇总互斥）+ 期间单选（财年由顶部导航全局控制，财年月外的月份禁用） */}
        <Card className="rounded-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <CompanyMultiSelect value={selectedCompanies} onChange={handleCompaniesChange} selectAllType="entity" />
          <MonthPicker
            value={periodFilter}
            onChange={setPeriodFilter}
            availablePeriods={periods}
            allowedPeriods={periods}
            placeholder="最新期间"
            className="w-full sm:w-[150px]"
          />
          <span className="text-xs text-muted-foreground">金额单位：万元 · 单体公司与汇总主体不可同时筛选 · 期间仅作用于卡片与明细，趋势图展示财年全月序列</span>
        </div>
        </Card>

        {/* KPI 卡行：失败时整体降级为错误提示 */}
        {overviewQuery.isError ? (
          <QueryError
            message={overviewQuery.error instanceof Error ? overviewQuery.error.message : undefined}
            onRetry={() => overviewQuery.refetch()}
            fetching={overviewQuery.isFetching}
          />
        ) : (
          <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4 transition-opacity duration-200', overviewQuery.isFetching && 'opacity-60')}>
            <StatCard
              index={0}
              loading={isOverviewLoading}
              title="存货总额（本期）"
              icon={Package}
              value={total ? formatMoneyWan(total.current) : '-'}
              sub={total ? <>年初 <span className="font-num">{formatMoneyWan(total.yearStart)}</span></> : undefined}
            />
            <StatCard
              index={1}
              loading={isOverviewLoading}
              title="较年初增减"
              icon={Boxes}
              value={
                total ? (
                  <span className={getChangeColor(total.current - total.yearStart)}>
                    {getChangePrefix(total.current - total.yearStart)}{formatMoneyWan(Math.abs(total.current - total.yearStart))}
                  </span>
                ) : '-'
              }
              sub={total ? <>增减率 <ChangeRate current={total.current} base={total.yearStart} /></> : undefined}
            />
            <StatCard
              index={2}
              loading={isOverviewLoading}
              title="同比增减率"
              icon={TrendingUp}
              value={total ? <ChangeRate current={total.current} base={total.samePeriod} /> : '-'}
              sub={total ? <>同期 <span className="font-num">{formatMoneyWan(total.samePeriod)}</span></> : undefined}
            />
            <StatCard
              index={3}
              loading={isOverviewLoading}
              title="存货周转天数"
              icon={CalendarClock}
              value={overview ? formatDays(overview.turnoverDays.current) : '-'}
              sub={turnover ? (
                <>
                  同期 <span className="font-num">{formatDays(turnover.samePeriod)}</span>
                  {turnover.samePeriod > 0 && (
                    <span className={cn('ml-1 font-num', getChangeColor(turnoverDelta))}>
                      {getChangePrefix(turnoverDelta)}{Math.abs(turnoverDelta).toFixed(1)} 天
                    </span>
                  )}
                </>
              ) : undefined}
            />
          </div>
        )}

        {/* 图表区：品类占比饼图 + 品类排名（点击钻取品类 → 明细表联动） */}
        <div className={cn('grid gap-6 lg:grid-cols-2 transition-opacity duration-200', overviewQuery.isFetching && 'opacity-60')}>
          <CategoryPieCard categories={overview?.categories ?? []} loading={isOverviewLoading} onCategoryClick={handleCategoryClick} />
          <CategoryRankCard categories={overview?.categories ?? []} loading={isOverviewLoading} onCategoryClick={handleCategoryClick} />
        </div>

        {/* 财年月度趋势（公司多选联动，财年跟随顶部导航）；选中单个汇总主体时旁挂成员公司占比饼图 */}
        {showCompanyShare ? (
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <InventoryTrendCard companyCodes={selectedCompanies} fiscalYear={fiscalYear} />
            </div>
            <div className="lg:col-span-2">
              <CompanyShareCard rows={detailRows} loading={detailsQuery.isLoading} />
            </div>
          </div>
        ) : (
          <InventoryTrendCard companyCodes={selectedCompanies} fiscalYear={fiscalYear} />
        )}

        {/* 控制层：明细表工具条（维度切换 / 搜索 / 导出 / 选中操作，筛选卡） */}
        <Card className="rounded-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={detailDim} onValueChange={(v) => setInventory({ detailDim: v as DetailDim })}>
            <SelectTrigger className="h-8 w-[140px]" aria-label="明细表维度切换">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="company">按公司汇总</SelectItem>
              <SelectItem value="category">按品类展开</SelectItem>
              <SelectItem value="detail">公司×品类明细</SelectItem>
            </SelectContent>
          </Select>
          {selected.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">已选 <span className="font-num">{selected.size}</span> 行</span>
              <Button variant="outline" size="sm" disabled={exporting || selectedRows.length === 0} onClick={() => doExport(selectedRows, '_选中')}>
                <Download className="mr-1 h-3.5 w-3.5" />
                导出选中
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>取消选择</Button>
            </>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              placeholder="搜索公司 / 品类"
              aria-label="搜索公司或品类"
              className="h-8 w-full pl-8 sm:w-[200px]"
            />
          </div>
          <Button variant="outline" size="sm" disabled={exporting || detailsQuery.isLoading || visibleRows.length === 0} onClick={() => doExport(visibleRows)}>
            <Download className="mr-1 h-3.5 w-3.5" />
            导出 Excel
          </Button>
        </div>
        </Card>

        {/* 展示层：明细表（表格卡） */}
        <Card className="animate-fade-in overflow-hidden rounded-card">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Boxes className="h-4 w-4" />
              {DIM_TITLES[detailDim]}
              <span className="ml-1 text-xs font-normal text-muted-foreground">{period ?? ''} · 共 {visibleRows.length} 行</span>
            </h3>
            {categoryCode && (
              <span className="flex items-center gap-1">
                <Badge variant="secondary">品类：{activeCategoryName}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  aria-label="清除品类筛选"
                  onClick={() => setInventory({ categoryCode: '' })}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </span>
            )}
          </div>
          <div>
            {detailsQuery.isLoading ? (
              <div className="space-y-2 py-2" aria-label="加载中">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="skeleton h-8 w-full rounded" />
                ))}
              </div>
            ) : detailsQuery.isError ? (
              <QueryError
                message={detailsQuery.error instanceof Error ? detailsQuery.error.message : undefined}
                onRetry={() => detailsQuery.refetch()}
                fetching={detailsQuery.isFetching}
              />
            ) : detailRows.length === 0 ? (
              <EmptyHint
                icon={Package}
                title={DIM_EMPTY_TITLES[detailDim]}
                hint={DIM_EMPTY_HINTS[detailDim]}
                className="py-12"
              />
            ) : visibleRows.length === 0 ? (
              <EmptyHint
                icon={Search}
                title="无匹配结果"
                hint={DIM_SEARCH_EMPTY_HINTS[detailDim]}
                className="py-12"
              />
            ) : (
              <div
                role="region"
                aria-label={DIM_REGION_LABELS[detailDim]}
                tabIndex={0}
                className={cn('max-h-[520px] overflow-auto transition-opacity duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', detailsQuery.isFetching && 'opacity-60')}
              >
                <table className="w-full min-w-[880px] text-sm">
                  <thead className="sticky top-0 z-[2] bg-card">
                    <tr className="border-b bg-muted/50 text-center text-black">
                      <th className="sticky left-0 z-[3] w-9 bg-card px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label="全选当前筛选结果"
                          className="h-3.5 w-3.5 cursor-pointer accent-primary"
                          checked={allVisibleSelected}
                          onChange={toggleAll}
                        />
                      </th>
                      <th className="sticky left-9 z-[3] whitespace-nowrap bg-card px-2 py-2 font-medium">
                        {detailDim === 'category' ? '品类' : '公司'}
                      </th>
                      {detailDim === 'detail' && <th className="px-2 py-2 font-medium">品类</th>}
                      <SortableTh label="本期金额" sortKey="current" sort={sort} onSort={cycleSort} />
                      <SortableTh label="年初金额" sortKey="yearStart" sort={sort} onSort={cycleSort} />
                      <SortableTh label="较年初" sortKey="vsYearStart" sort={sort} onSort={cycleSort} />
                      <SortableTh label="同期金额" sortKey="samePeriod" sort={sort} onSort={cycleSort} />
                      <SortableTh label="同比" sortKey="yoy" sort={sort} onSort={cycleSort} />
                      {canAnalyze && detailDim !== 'category' && <th className="px-2 py-2 font-medium">操作</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.key} className="group border-b last:border-0 hover:bg-muted/50">
                        <td className="sticky left-0 z-[1] w-9 bg-card px-2 py-2 text-center transition-colors group-hover:bg-muted">
                          <input
                            type="checkbox"
                            aria-label={`选择 ${row.label}`}
                            className="h-3.5 w-3.5 cursor-pointer accent-primary"
                            checked={selected.has(row.key)}
                            onChange={() => toggleOne(row.key)}
                          />
                        </td>
                        <td className="sticky left-9 z-[1] max-w-[180px] truncate bg-card px-2 py-2 text-xs transition-colors group-hover:bg-muted" title={row.label}>
                          {row.label}
                        </td>
                        {detailDim === 'detail' && <td className="px-2 py-2">{row.detail?.categoryName}</td>}
                        <td className="px-2 py-2 text-right font-num">{formatMoneyWan(row.current)}</td>
                        <td className="px-2 py-2 text-right font-num">{formatMoneyWan(row.yearStart)}</td>
                        <td className="px-2 py-2 text-right"><ChangeRate current={row.current} base={row.yearStart} /></td>
                        <td className="px-2 py-2 text-right font-num">{formatMoneyWan(row.samePeriod)}</td>
                        <td className="px-2 py-2 text-right">
                          {row.samePeriod ? (
                            <span className={cn('font-num', getChangeColor(row.yoy))}>{row.yoy === 0 ? '-' : `${getChangePrefix(row.yoy)}${Math.abs(row.yoy).toFixed(1)}%`}</span>
                          ) : (
                            <span className="font-num text-muted-foreground">-</span>
                          )}
                        </td>
                        {canAnalyze && detailDim !== 'category' && (
                          <td className="px-2 py-2 text-center">
                            {detailDim === 'company' ? (
                              // 按公司汇总：公司级分析（存货根科目）；静态树未就绪时禁用
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={!inventoryRoot} onClick={() => handleAnalyzeCompany(row)}>
                                <FileText className="mr-1 h-3.5 w-3.5" />
                                分析
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleAnalyze(row)}>
                                <FileText className="mr-1 h-3.5 w-3.5" />
                                分析
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="sticky bottom-0 z-[2] border-t bg-secondary font-medium">
                      <td className="sticky left-0 z-[3] w-9 bg-secondary px-2 py-2" />
                      <td className="sticky left-9 z-[3] whitespace-nowrap bg-secondary px-2 py-2 text-xs">
                        {detailDim === 'detail' ? '合计' : `合计（${visibleRows.length} 行）`}
                      </td>
                      {detailDim === 'detail' && <td className="px-2 py-2 text-xs text-muted-foreground">{visibleRows.length} 行</td>}
                      <td className="px-2 py-2 text-right font-num">{formatMoneyWan(totals.current)}</td>
                      <td className="px-2 py-2 text-right font-num">{formatMoneyWan(totals.yearStart)}</td>
                      <td className="px-2 py-2 text-right"><ChangeRate current={totals.current} base={totals.yearStart} /></td>
                      <td className="px-2 py-2 text-right font-num">{formatMoneyWan(totals.samePeriod)}</td>
                      <td className="px-2 py-2 text-right"><ChangeRate current={totals.current} base={totals.samePeriod} /></td>
                      {canAnalyze && detailDim !== 'category' && <td className="px-2 py-2" />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* 单项分析抽屉（与指标页共用组件） */}
      <AnalysisDrawer open={analysisTarget !== null} target={analysisTarget} onClose={() => setAnalysisTarget(null)} />
    </PageContainer>
  )
}
