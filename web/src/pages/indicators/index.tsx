import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompanySelect } from '@/components/filters/company-select'
import { PageContainer } from '@/components/layout/page-container'
import { MetricTree, OPERATING_COLUMNS, STATIC_COLUMNS } from '@/components/subject-tree/metric-tree'
import { AnalysisDrawer, type AnalysisTarget } from '@/components/indicators/analysis-drawer'
import { AiOverviewDialog } from '@/components/indicators/ai-overview-panel'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { usePermission } from '@/hooks/usePermission'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { useCompanies, useOperatingIndicators, useStaticIndicators, useAvailablePeriods, type OperatingRow, type StaticRow } from '@/hooks/api-queries'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'
import { exportToExcel } from '@/lib/export'
import { filterTreeKeepSubtree } from '@/lib/subject-tree'
import { sortTreeByLevel, type MetricSortKey } from '@/lib/metric-sort'
import { filterByCategories } from '@/lib/metric-filter'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import type { MetricValue } from '@/lib/metric-values'
import { Download, ChevronsDownUp, ChevronsUpDown, History, Eye, Sparkles, Loader2, Search, X, MoreHorizontal, Rows3, Columns3 } from 'lucide-react'
import type { SubjectNode } from '@/types'

/** 收集含子节点的科目编码（用于全部展开） */
function collectExpandableCodes(nodes: SubjectNode[]): string[] {
  const codes: string[] = []
  for (const node of nodes) {
    if (node.children.length > 0) {
      codes.push(node.code)
      codes.push(...collectExpandableCodes(node.children))
    }
  }
  return codes
}

type Row = OperatingRow | StaticRow

// 列设置面板元数据（复用 metric-tree 列配置，仅取 key/header）
const OPERATING_COLUMN_META = OPERATING_COLUMNS.map((c) => ({ key: c.key, header: c.header }))
const STATIC_COLUMN_META = STATIC_COLUMNS.map((c) => ({ key: c.key, header: c.header }))

/** 将后端嵌套行转为 MetricTree 需要的结构树 + 数值 Map */
function adapt(items: Row[], isOperating: boolean): { nodes: SubjectNode[]; map: Map<string, MetricValue> } {
  const map = new Map<string, MetricValue>()
  const walk = (rows: Row[]): SubjectNode[] =>
    rows.map((r) => {
      if (isOperating) {
        const o = r as OperatingRow
        map.set(o.code, { budget: o.budget, actual: o.actual, samePeriod: o.samePeriod, ytd: o.ytd, samePeriodYtd: o.samePeriodYtd })
      } else {
        const s = r as StaticRow
        // 静态科目映射到统一 MetricValue：本期→actual、同期→samePeriod、年初→ytd、上年年初→samePeriodYtd
        map.set(s.code, { budget: s.yearStart, actual: s.current, samePeriod: s.samePeriod, ytd: s.yearStart, samePeriodYtd: s.lastYearStart })
      }
      return {
        code: r.code, name: r.name, level: r.level, category: r.category,
        dataType: r.dataType as SubjectNode['dataType'],
        valueType: r.valueType,
        children: r.children ? walk(r.children as Row[]) : [],
      }
    })
  return { nodes: walk(items), map }
}

/** 前序展开为 {row, depth} 供导出 */
function flattenForExport(rows: Row[], depth = 0): { row: Row; depth: number }[] {
  const out: { row: Row; depth: number }[] = []
  for (const r of rows) {
    out.push({ row: r, depth })
    if (r.children && r.children.length > 0) out.push(...flattenForExport(r.children as Row[], depth + 1))
  }
  return out
}

/**
 * 财务指标页（经营/静态共用实现）：按科目层级查看指标数据。
 * subjectType 决定数据源（经营指标 / 静态指标）与展示列；
 * 支持主体/期间/去重分类口径筛选、科目搜索、全部展开/折叠、Excel 导出、
 * 单项分析撰写（需单选公司）与 AI 全局预分析。
 */
export function IndicatorPage({ subjectType }: { subjectType: 'operating' | 'static' }) {
  const { can } = usePermission()
  const navigate = useNavigate()
  // 子标签类型由路由入口决定（/indicators/operating | /indicators/static）
  const activeTab = subjectType
  // 查询条件与展开状态持久化到 pageStateStore（路由切换/刷新后恢复）；analysisTarget 为瞬时抽屉状态
  const setIndicators = usePageStore((s) => s.setIndicators)
  const dimFilter = usePageStore((s) => s.indicators.dimFilter)
  const periodFilter = usePageStore((s) => s.indicators.periodFilter)
  const excludeReclassify = usePageStore((s) => s.indicators.excludeReclassify)
  const expandedCodes = usePageStore((s) => s.indicators.expandedCodes)
  const subjectKeyword = usePageStore((s) => s.indicators.subjectKeyword)
  const sortKey = usePageStore((s) => s.indicators.sortKey)
  const sortDirection = usePageStore((s) => s.indicators.sortDirection)
  const categoryFilter = usePageStore((s) => s.indicators.categoryFilter)
  const [analysisTarget, setAnalysisTarget] = useState<AnalysisTarget | null>(null)
  // AI 预分析弹窗开关（数据就绪后令牌递增，由弹窗内自动打开）
  const [overviewOpen, setOverviewOpen] = useState(false)
  // 吸顶筛选区高度：ResizeObserver 实时测量（响应式换行/内容变化），驱动表格容器吸顶偏移与表头固定
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const setDimFilter = useCallback((v: string) => setIndicators({ dimFilter: v }), [setIndicators])
  const setPeriodFilter = useCallback((v: string) => setIndicators({ periodFilter: v }), [setIndicators])
  const setExcludeReclassify = useCallback((v: boolean) => setIndicators({ excludeReclassify: v }), [setIndicators])
  const setSubjectKeyword = useCallback((v: string) => setIndicators({ subjectKeyword: v }), [setIndicators])
  const setSort = useCallback(
    (key: string, direction: 'asc' | 'desc' | null) => setIndicators({ sortKey: key, sortDirection: direction }),
    [setIndicators],
  )
  const setCategoryFilter = useCallback(
    (codes: string[] | null) => setIndicators({ categoryFilter: codes }),
    [setIndicators],
  )
  // 表格密度与隐藏列（持久化到 pageStateStore，刷新保持）
  const density = usePageStore((s) => s.indicators.density)
  const hiddenColumns = usePageStore((s) => s.indicators.hiddenColumns)
  const setDensity = useCallback(
    (v: 'default' | 'dense' | 'compact') => setIndicators({ density: v }),
    [setIndicators],
  )
  const setHiddenColumns = useCallback(
    (cols: string[]) => {
      // 隐藏当前排序列时联动清空排序（避免无表头入口的静默排序）
      const patch: { hiddenColumns: string[]; sortKey?: string | null; sortDirection?: 'asc' | 'desc' | null } = { hiddenColumns: cols }
      const cur = usePageStore.getState().indicators
      if (cur.sortKey && cols.includes(cur.sortKey)) {
        patch.sortKey = null
        patch.sortDirection = null
      }
      setIndicators(patch)
    },
    [setIndicators],
  )
  // 小屏（<lg）搜索框浮层展开态（图标按钮点击切换）
  const [searchOpen, setSearchOpen] = useState(false)
  // 展开集合由持久化数组派生（Set 不可序列化，store 以数组存储）
  const expandedSet = useMemo(() => new Set(expandedCodes), [expandedCodes])
  const setExpandedCodes = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    const prev = new Set(usePageStore.getState().indicators.expandedCodes)
    usePageStore.getState().setIndicators({ expandedCodes: [...updater(prev)] })
  }, [])

  const isOperating = activeTab === 'operating'

  // 隐藏列按当前 tab 列集合过滤（跨 tab 共享 hiddenColumns 的计算层防护：静态页不受经营页隐藏列影响）
  const effectiveHidden = useMemo(() => {
    const cols = isOperating ? OPERATING_COLUMNS : STATIC_COLUMNS
    return hiddenColumns.filter((k) => cols.some((c) => c.key === k))
  }, [hiddenColumns, isOperating])

  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const { data: periodsData } = useAvailablePeriods()
  // 期间候选按全局选中财年过滤
  const periods = useMemo(
    () => filterPeriodsByFiscalYear(periodsData?.periods ?? [], fiscalYear, periodsData?.fiscalStartMonth ?? 1),
    [periodsData, fiscalYear],
  )

  useEffect(() => {
    if (periods.length === 0) return
    // 首次加载（periodFilter 为空）默认选中最新期间；已选期间不存在时回退最新
    if (periodFilter === '' || (!periods.includes(periodFilter) && periodFilter !== 'all')) {
      setPeriodFilter(periods[periods.length - 1])
    }
  }, [periods, periodFilter, setPeriodFilter])

  // 主体维度：company:CODE / summary:CODE → 传对应编码；all → 不传（后端按 scope 汇总）
  const companyCode = dimFilter.startsWith('company:')
    ? dimFilter.slice('company:'.length)
    : dimFilter.startsWith('summary:')
      ? dimFilter.slice('summary:'.length)
      : undefined
  const period = periodFilter === 'all' ? undefined : periodFilter

  const { data: companies } = useCompanies()
  // 公司显示名：跟随全局「显示简称」开关（下拉选项/抽屉标题等所有展示处统一）
  const { getDisplayName } = useCompanyDisplayName()
  // 持久化主体校验：编码已删除/超出数据权限时回退全部主体（候选加载后生效一次，用户手动切换后不再覆盖）
  useEffect(() => {
    if (!companies || companies.length === 0) return
    const valid = new Set(companies.map((c) => c.code))
    const cur = usePageStore.getState().indicators.dimFilter
    if (cur === 'all') return
    const code = cur.startsWith('company:') || cur.startsWith('summary:') ? cur.slice('company:'.length) : undefined
    if (!code || !valid.has(code)) setDimFilter('all')
  }, [companies, setDimFilter])
  // AI 预分析需要两体系数据：当前 tab 的 query 恒挂载，另一体系在触发预分析时按需拉取（静态懒加载）
  const [aiNeedData, setAiNeedData] = useState(false)
  const operatingQuery = useOperatingIndicators(
    { companyCode, period, excludeReclassify: excludeReclassify || undefined },
    { enabled: isOperating || aiNeedData },
  )
  const staticQuery = useStaticIndicators(
    { companyCode, period, excludeReclassify: excludeReclassify || undefined },
    { enabled: !isOperating || aiNeedData },
  )

  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])

  const activeItems = (isOperating ? operatingQuery.data?.items : staticQuery.data?.items) ?? []
  const isLoading = isOperating ? operatingQuery.isLoading : staticQuery.isLoading
  // isFetching：筛选刷新中（已保留旧数据），用于轻量视觉反馈而非整块替换
  const isFetching = isOperating ? operatingQuery.isFetching : staticQuery.isFetching
  // 去重分类口径下无法回溯的记录数（批次已替换/缺快照）
  const skippedReclassifyLogs = (isOperating ? operatingQuery.data?.skippedReclassifyLogs : staticQuery.data?.skippedReclassifyLogs) ?? 0

  const { nodes: activeTree, map: activeValueMap } = useMemo(
    () => adapt(activeItems as Row[], isOperating),
    [activeItems, isOperating],
  )
  const activeExpandable = useMemo(() => collectExpandableCodes(activeTree), [activeTree])

  // 科目关键字过滤：命中节点保留整棵子树 + 祖先链；过滤时强制展开可见路径（清空后恢复用户展开态）
  const visibleTree = useMemo(() => filterTreeKeepSubtree(activeTree, subjectKeyword), [activeTree, subjectKeyword])
  // 分类列筛选：仅经营指标（有分类列）；null = 全部；[] = 无分类（空态）。静态页不受经营页筛选影响
  const categoryFilteredTree = useMemo(
    () => (isOperating ? filterByCategories(visibleTree, categoryFilter) : visibleTree),
    [visibleTree, categoryFilter, isOperating],
  )
  const effectiveExpanded = useMemo(() => {
    if (!subjectKeyword.trim()) return expandedSet
    const next = new Set(expandedSet)
    const collect = (ns: SubjectNode[]) => {
      for (const n of ns) {
        if (n.children.length > 0) {
          next.add(n.code)
          collect(n.children)
        }
      }
    }
    collect(visibleTree)
    return next
  }, [visibleTree, subjectKeyword, expandedSet])

  // 列排序：树内同级排序（经营指标分类根不排序 fromLevel=1 保护分类列分组；静态指标全层级）；
  // sortKey 不属于当前 tab 列集合时不排序（跨 tab 共享排序状态的计算层防护）
  const sortedTree = useMemo(() => {
    if (!sortKey || !sortDirection) return categoryFilteredTree
    const cols = isOperating ? OPERATING_COLUMNS : STATIC_COLUMNS
    if (!cols.some((c) => c.key === sortKey)) return categoryFilteredTree
    return sortTreeByLevel(categoryFilteredTree, activeValueMap, sortKey as MetricSortKey, sortDirection, {
      fromLevel: isOperating ? 1 : 0,
    })
  }, [categoryFilteredTree, activeValueMap, sortKey, sortDirection, isOperating])

  // 数据到达后默认展开 level0 根节点
  useEffect(() => {
    const roots = activeTree.map((n) => n.code)
    if (roots.length > 0) {
      setExpandedCodes((prev) => {
        const next = new Set(prev)
        roots.forEach((c) => next.add(c))
        return next
      })
    }
  }, [activeTree])

  const handleToggle = (code: string) => {
    // 过滤态下展开由 effectiveExpanded 强制托管：折叠操作不写持久化（避免清空关键字后用户展开态丢失）
    if (subjectKeyword.trim()) return
    setExpandedCodes((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  // 是否已全部展开：用于展开/折叠切换按钮的状态判断
  const isAllExpanded = activeExpandable.length > 0 && activeExpandable.every((code) => expandedSet.has(code))

  const toggleExpandAll = () => {
    // 过滤态下同样不写持久化（视觉展开由 effectiveExpanded 托管，按钮已在过滤态禁用，此处兜底）
    if (subjectKeyword.trim()) return
    setExpandedCodes((prev) => {
      if (isAllExpanded) {
        const next = new Set(prev)
        for (const code of activeExpandable) next.delete(code)
        return next
      }
      return new Set([...prev, ...activeExpandable])
    })
  }

  /** 打开单项分析抽屉：需先选中单一公司主体（未选择时按钮已在表格中禁用并提示） */
  const handleAnalyze = (node: SubjectNode) => {
    // 安全兜底：未选单一公司时不打开（正常流程按钮已禁用，此处防类型窄化丢失）
    if (!companyCode) return
    const companyName = getDisplayName(companyCode, entityCompanies.find((c) => c.code === companyCode)?.name ?? companyCode)
    const effectivePeriod = period ?? periods[periods.length - 1] ?? ''
    setAnalysisTarget({
      companyCode,
      companyName,
      subjectCode: node.code,
      subjectName: node.name,
      subjectType: activeTab,
      valueType: node.valueType,
      fiscalYear: effectivePeriod.slice(0, 4),
      period: effectivePeriod,
      metric: activeValueMap.get(node.code),
    })
  }

  /** AI 全局预分析：筛选栏入口按钮触发面板自动生成（令牌递增） */
  const [overviewAutoRun, setOverviewAutoRun] = useState(0)
  // 两体系数据均就绪（对象存在即视为已加载，即使 items 为空）→ 递增令牌触发面板生成
  const bothReady = operatingQuery.data !== undefined && staticQuery.data !== undefined
  // 数据准备中：AI 已触发但另一体系数据仍在拉取（顶部按钮 loading 反馈）
  const overviewPreparing = aiNeedData && !bothReady
  useEffect(() => {
    if (aiNeedData && bothReady) {
      setAiNeedData(false)
      setOverviewAutoRun((n) => n + 1)
    }
  }, [aiNeedData, bothReady])
  // 预分析数据：经营+静态两体系；未加载的另一体系为空数组（触发预分析时按需拉取后自动生成）
  const overviewOperatingRows = useMemo(
    () => flattenForExport((operatingQuery.data?.items ?? []) as Row[]).map(({ row }) => row),
    [operatingQuery.data?.items],
  )
  const overviewStaticRows = useMemo(
    () => flattenForExport((staticQuery.data?.items ?? []) as Row[]).map(({ row }) => row),
    [staticQuery.data?.items],
  )
  const hasOverviewData = overviewOperatingRows.length + overviewStaticRows.length > 0

  /** 重置筛选：恢复默认主体/期间/重分类口径/科目搜索/分类筛选（空状态引导动作） */
  const handleResetFilters = () => {
    setDimFilter('all')
    setPeriodFilter('')
    setExcludeReclassify(false)
    setSubjectKeyword('')
    setCategoryFilter(null)
  }

  const handleExport = async () => {
    const pct = (v: number) => `${v.toFixed(1)}%`
    // 分型导出：比率列乘 100 加 %，数量取整，金额保持数值；同比统一按增长率百分比（后端已按增长率返回）
    const fmtVal = (v: number, vt: string) => (vt === 'ratio' ? `${(v * 100).toFixed(1)}%` : vt === 'quantity' ? Math.round(v) : v)
    const fmtYoy = (v: number) => pct(v)
    const flat = flattenForExport(activeItems as Row[])
    // 去重分类口径导出时文件名标识区分，避免与正式口径混淆
    const scopeSuffix = excludeReclassify ? '_原始口径' : ''
    if (isOperating) {
      const rows = flat.map(({ row, depth }) => {
        const o = row as OperatingRow
        return {
          account: `${'　'.repeat(depth)}${o.name}`,
          budget: fmtVal(o.budget, o.valueType), actual: fmtVal(o.actual, o.valueType), samePeriod: fmtVal(o.samePeriod, o.valueType),
          yoy: fmtYoy(o.yoy), achievement: pct(o.achievement),
          ytd: fmtVal(o.ytd, o.valueType), samePeriodYtd: fmtVal(o.samePeriodYtd, o.valueType), ytdYoy: fmtYoy(o.ytdYoy),
        }
      })
      await exportToExcel({
        filename: `财务指标_经营指标${scopeSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: '经营指标',
        columns: [
          { header: '科目', key: 'account', width: 40 },
          { header: '预算金额(万)', key: 'budget', width: 14 },
          { header: '本月实际(万)', key: 'actual', width: 14 },
          { header: '同期实际(万)', key: 'samePeriod', width: 14 },
          { header: '同比', key: 'yoy', width: 10 },
          { header: '达成率', key: 'achievement', width: 10 },
          { header: '本年累计(万)', key: 'ytd', width: 14 },
          { header: '同期累计(万)', key: 'samePeriodYtd', width: 14 },
          { header: '累计同比', key: 'ytdYoy', width: 10 },
        ],
        rows,
      })
    } else {
      const rows = flat.map(({ row, depth }) => {
        const s = row as StaticRow
        return {
          account: `${'　'.repeat(depth)}${s.name}`,
          actual: fmtVal(s.current, s.valueType), samePeriod: fmtVal(s.samePeriod, s.valueType), yoy: fmtYoy(s.yoy),
        }
      })
      await exportToExcel({
        filename: `财务指标_静态指标${scopeSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: '静态指标',
        columns: [
          { header: '科目', key: 'account', width: 40 },
          { header: '本期金额(万)', key: 'actual', width: 16 },
          { header: '同期金额(万)', key: 'samePeriod', width: 16 },
          { header: '变动率', key: 'yoy', width: 10 },
        ],
        rows,
      })
    }
  }

  return (
    <PageContainer
      title="财务指标"
      className="space-y-3"
      stickyHeader
      headerRef={headerRef}
      actionsFullWidth
      actions={
        // 筛选条响应式：全尺寸单行不横滚，超宽自然换行；控件宽度随断点缩小，极小屏搜索缩为图标浮层
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {/* 左侧：主体维度选择（加宽，保证公司名称完整显示；选项前缀+简称跟随全局开关，触发器仅显名称） */}
          <CompanySelect
            value={dimFilter}
            onChange={setDimFilter}
            valueFormat="prefixed"
            allLabel="全部主体"
            ariaLabel="主体维度"
            className="h-8 w-[120px] shrink-0 border-input/60 bg-page hover:bg-muted/60 min-[800px]:w-[140px] lg:w-[200px] min-[1300px]:w-[250px]"
          />

          {/* 右侧：科目搜索 + 期间 + 重分类 + 操作按钮组（lg 以上靠右对齐） */}
          <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
            {/* 科目列关键字筛选：实时过滤科目树（命中节点保留整棵子树与祖先链） */}
            <div className="relative shrink-0">
              {/* >=600px：完整输入框 */}
              <div className="hidden min-[600px]:block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={subjectKeyword}
                  onChange={(e) => setSubjectKeyword(e.target.value)}
                  placeholder="搜索科目"
                  aria-label="搜索科目"
                  className="h-8 w-[120px] border-input/60 bg-page pl-8 pr-7 text-[13px]"
                />
                {subjectKeyword && (
                  <button
                    type="button"
                    onClick={() => setSubjectKeyword('')}
                    aria-label="清空科目搜索"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {/* <600px：仅图标按钮，点击展开 Popover 浮层输入框（Portal 渲染，不受侧边栏/吸顶层级遮挡） */}
              <div className="min-[600px]:hidden">
                <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="fused"
                      size="sm"
                      className="h-8 w-8 p-0"
                      aria-label={searchOpen ? '收起科目搜索' : '搜索科目'}
                      title="搜索科目"
                    >
                      <Search className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={6} className="w-64 p-1.5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        autoFocus
                        value={subjectKeyword}
                        onChange={(e) => setSubjectKeyword(e.target.value)}
                        placeholder="搜索科目"
                        aria-label="搜索科目"
                        className="h-8 w-full border-input/60 bg-page pl-8 pr-7 text-[13px]"
                      />
                      {subjectKeyword && (
                        <button
                          type="button"
                          onClick={() => {
                            setSubjectKeyword('')
                            setSearchOpen(false)
                          }}
                          aria-label="清空科目搜索"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <Select value={periodFilter} onValueChange={setPeriodFilter}>
              <SelectTrigger className="h-8 w-[100px] shrink-0 border-input/60 bg-page hover:bg-muted/60 min-[800px]:w-[120px] lg:w-[140px] min-[1300px]:w-[160px]" aria-label="期间">
                <SelectValue placeholder="选择期间" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部期间</SelectItem>
                {periods.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div
              className="flex shrink-0 items-center gap-1.5"
              title="按重分类日志快照回溯展示调整前口径，仅供对比查看，不修改数据"
            >
              <Switch id="exclude-reclassify" aria-label="去除重分类影响" checked={excludeReclassify} onCheckedChange={setExcludeReclassify} />
              <Label htmlFor="exclude-reclassify" className="hidden cursor-pointer whitespace-nowrap text-[13px] min-[1300px]:inline">去除重分类影响</Label>
            </div>

            <div className="mx-1 h-5 w-px shrink-0 bg-border/60" aria-hidden="true" />

            {/* 展开/折叠：800px+ 独立显示（<800px 时在下拉内）；过滤态下禁用（展开由 effectiveExpanded 托管，避免污染持久化展开态） */}
            <Button variant="fused" size="sm" onClick={toggleExpandAll} disabled={!!subjectKeyword.trim()} className="hidden shrink-0 min-[800px]:inline-flex">
              {isAllExpanded ? <ChevronsDownUp className="mr-1 h-3.5 w-3.5" /> : <ChevronsUpDown className="mr-1 h-3.5 w-3.5" />}
              {isAllExpanded ? '全部折叠' : '全部展开'}
            </Button>

            {/* 小屏与中屏（<1300px）：AI 预分析 / 查看分析 / 导出 合并为「更多操作」下拉；<800px 时展开/折叠也在下拉内 */}
            <div className="shrink-0 min-[1300px]:hidden">
              <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="fused" size="sm">
                      <MoreHorizontal className="mr-1 h-3.5 w-3.5" /> 更多操作
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    {/* 展开/折叠全部（仅 <800px 在下拉内，800px+ 已独立显示）；过滤态下禁用 */}
                    <DropdownMenuItem onClick={toggleExpandAll} disabled={!!subjectKeyword.trim()} className="min-[800px]:hidden">
                      {isAllExpanded ? <ChevronsDownUp className="mr-2 h-3.5 w-3.5" /> : <ChevronsUpDown className="mr-2 h-3.5 w-3.5" />}
                      {isAllExpanded ? '全部折叠' : '全部展开'}
                    </DropdownMenuItem>
                    {can('reports', 'create') && (
                      <DropdownMenuItem onClick={() => setAiNeedData(true)} disabled={isLoading || !hasOverviewData || overviewPreparing}>
                        {overviewPreparing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
                        {overviewPreparing ? '数据准备中…' : 'AI 预分析'}
                      </DropdownMenuItem>
                    )}
                    {can('reports', 'view') && (
                      <DropdownMenuItem onClick={() => navigate('/reports/analyses')}>
                        <Eye className="mr-2 h-3.5 w-3.5" /> 查看分析
                      </DropdownMenuItem>
                    )}
                    {can('indicators', 'export') && (
                      <DropdownMenuItem onClick={handleExport} disabled={isLoading || activeItems.length === 0}>
                        <Download className="mr-2 h-3.5 w-3.5" /> 导出 Excel
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

            {/* 大屏（>=1300px）：AI 预分析 / 查看分析 / 导出 独立显示（展开/折叠已独立于上方） */}
            <div className="hidden shrink-0 min-[1300px]:flex min-[1300px]:items-center min-[1300px]:gap-2">
              {can('reports', 'create') ? (
                <Button
                  variant="fused"
                  size="sm"
                  onClick={() => setAiNeedData(true)}
                  disabled={isLoading || !hasOverviewData || overviewPreparing}
                >
                  {overviewPreparing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                  {overviewPreparing ? '数据准备中…' : 'AI 预分析'}
                </Button>
              ) : null}
              {can('reports', 'view') ? (
                <Button variant="fused" size="sm" onClick={() => navigate('/reports/analyses')}>
                  <Eye className="mr-1 h-3.5 w-3.5" /> 查看分析
                </Button>
              ) : null}
              {can('indicators', 'export') ? (
                <Button variant="fused" size="sm" onClick={handleExport} disabled={isLoading || activeItems.length === 0}>
                  <Download className="mr-1 h-3.5 w-3.5" /> 导出 Excel
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        }
      >

      {/* AI 全局预分析弹窗（权限控制显示；key 重建保证筛选变化时旧流中止、数据随新筛选；关闭不中断后台生成） */}
      {can('reports', 'create') ? (
        <AiOverviewDialog
          key={`${companyCode ?? 'all'}|${period ?? 'all'}`}
          open={overviewOpen}
          onOpenChange={setOverviewOpen}
          onViewAnalyses={() => navigate('/reports/analyses')}
          slotKey={`${companyCode ?? 'all'}|${period ?? 'all'}`}
          companyCode={companyCode}
          period={period ?? periods[periods.length - 1]}
          operatingRows={overviewOperatingRows}
          staticRows={overviewStaticRows}
          disabled={isLoading}
          autoRunToken={overviewAutoRun}
          onNeedData={() => setAiNeedData(true)}
        />
      ) : null}

      {/* 去重分类模拟口径提示条 */}
      {excludeReclassify && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/[0.08] px-4 py-2 text-sm text-warning-strong">
          <History className="h-4 w-4 shrink-0" />
          <span>
            当前展示的是去除跨公司重分类影响后的模拟口径，不修改任何数据。
            {skippedReclassifyLogs > 0 && `另有 ${skippedReclassifyLogs} 条记录因数据批次已替换无法回溯。`}
          </span>
        </div>
      )}

      {/* 科目树表格卡片：筛选条在页头 actions 吸顶，树区承载于卡片内 */}
      <Card className="animate-fade-in overflow-hidden rounded-card">
        <div className="min-h-[420px] px-4 py-3">
          {/* 表格工具栏：密度切换 + 列设置（状态持久化） */}
          <div className="mb-2 flex items-center justify-end gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="fused" size="sm" className="h-7 gap-1 text-xs">
                  <Rows3 className="h-3.5 w-3.5" /> 密度
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                <DropdownMenuRadioGroup value={density} onValueChange={(v) => setDensity(v as 'default' | 'dense' | 'compact')}>
                  {(
                    [
                      ['default', '标准'],
                      ['dense', '紧凑'],
                      ['compact', '极简'],
                    ] as const
                  ).map(([v, label]) => (
                    <DropdownMenuRadioItem key={v} value={v}>
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="fused" size="sm" className="h-7 gap-1 text-xs">
                  <Columns3 className="h-3.5 w-3.5" /> 列设置
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {(isOperating ? OPERATING_COLUMN_META : STATIC_COLUMN_META).map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={!hiddenColumns.includes(col.key)}
                    onCheckedChange={(checked) => {
                      const next = checked
                        ? hiddenColumns.filter((k) => k !== col.key)
                        : [...hiddenColumns, col.key]
                      setHiddenColumns(next)
                    }}
                  >
                    {col.header}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {isLoading ? (
            /* 加载骨架：保持表格占位高度，避免内容区塌陷再撑回导致跳动 */
            <div className="py-3">
              <div className="flex gap-3">
                {Array.from({ length: isOperating ? 10 : 5 }).map((_, c) => (
                  <Skeleton key={c} className="h-11 flex-1" />
                ))}
              </div>
              {Array.from({ length: 6 }).map((_, r) => (
                <div key={r} className="mt-2 flex gap-3">
                  {Array.from({ length: isOperating ? 10 : 5 }).map((_, c) => (
                    <Skeleton key={c} className="h-10 flex-1" />
                  ))}
                </div>
              ))}
            </div>
          ) : activeTree.length === 0 ? (
            /* 空状态：引导调整筛选或一键重置 */
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">当前筛选无数据</p>
              <p className="mt-1 text-xs text-muted-foreground/70">请调整主体维度或期间后重试。</p>
              <Button variant="fused" size="sm" className="mt-3" onClick={handleResetFilters}>
                重置筛选
              </Button>
            </div>
          ) : (
            <div className={cn('transition-opacity duration-200', isFetching && 'opacity-60')}>
              <MetricTree
                nodes={sortedTree}
                categoryCandidates={visibleTree}
                valueMap={activeValueMap}
                variant={activeTab}
                categoryColumn={isOperating}
                expandedCodes={effectiveExpanded}
                onToggle={handleToggle}
                onAnalyze={can('reports', 'create') ? handleAnalyze : undefined}
                analyzeDisabled={!companyCode}
                analyzeHint="请先在「主体维度」选择单一公司，再对该公司的科目撰写单项分析"
                stickyHeaderTop={headerHeight}
                emptyText={subjectKeyword.trim() ? '未找到匹配科目' : undefined}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSortChange={setSort}
                categoryFilter={categoryFilter}
                onCategoryFilterChange={setCategoryFilter}
                density={density}
                hiddenColumns={effectiveHidden}
              />
            </div>
          )}
        </div>
      </Card>

      {/* 单项分析抽屉 */}
      <AnalysisDrawer open={analysisTarget !== null} target={analysisTarget} onClose={() => setAnalysisTarget(null)} />
    </PageContainer>
  )
}
