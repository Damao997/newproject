import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { INDICATOR_TABS } from '@/components/layout/module-tabs'
import { MetricTree } from '@/components/subject-tree/metric-tree'
import { AnalysisDrawer, type AnalysisTarget } from '@/components/indicators/analysis-drawer'
import { AiOverviewDialog } from '@/components/indicators/ai-overview-panel'
import { usePermission } from '@/hooks/usePermission'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { useCompanies, useOperatingIndicators, useStaticIndicators, useCashflowIndicators, useAvailablePeriods } from '@/hooks/api-queries'
import { useGlobalCompanyScope } from '@/hooks/use-global-company-scope'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'
import { filterTreeKeepSubtree } from '@/lib/subject-tree'
import { sortTreeByLevel, type MetricSortKey } from '@/lib/metric-sort'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { History, CheckCircle2, TriangleAlert, ArrowLeft } from 'lucide-react'
import type { SubjectNode } from '@/types'
import { IndicatorFilterBar } from './indicator-filter-bar'
import { useIndicatorExport, flattenForExport } from './use-indicator-export'
import { adapt, collectExpandableCodes, buildColumnsFor } from './indicators-adapters'

/**
 * 财务指标页（经营/静态/现金流共用实现）：按科目层级查看指标数据。
 * subjectType 决定数据源（经营指标 / 静态指标 / 现金流量表）与展示列；
 * 公司/期间为全局口径（Header CompanyPill / PeriodPill），支持去重分类口径筛选、科目搜索、
 * 全部展开/折叠、Excel 导出、单项分析撰写（需全局选中单一公司）与 AI 全局预分析。
 * 筛选区/导出逻辑/列与树适配分别拆分至 indicator-filter-bar / use-indicator-export / indicators-adapters。
 */
export function IndicatorPage({ subjectType, description }: { subjectType: 'operating' | 'static' | 'cashflow'; description?: React.ReactNode }) {
  const { can } = usePermission()
  const navigate = useNavigate()
  // 从看板 KPI/关键指标表明细钻取进入时显示「返回看板」按钮（sessionStorage 标记，点击返回时清除；刷新后仍保留）
  const [fromDashboardKpi] = useState(() => sessionStorage.getItem('dashboard.fromDashboard') === '1')
  const handleBackToDashboard = useCallback(() => {
    sessionStorage.removeItem('dashboard.fromDashboard')
    navigate('/dashboard/analysis/key-metrics')
  }, [navigate])
  // 子标签类型由路由入口决定（/indicators/operating | /indicators/static）
  const activeTab = subjectType
  // 视图状态持久化到 pageStateStore（路由切换/刷新后恢复）；analysisTarget 为瞬时抽屉状态
  // 公司/期间全局口径读 periodStore（Header 唯一入口），pageStateStore 的 dimFilter/periodFilter 停止读取（类型定义保留）
  const setIndicators = usePageStore((s) => s.setIndicators)
  const excludeReclassify = usePageStore((s) => s.indicators.excludeReclassify)
  const expandedCodes = usePageStore((s) => s.indicators.expandedCodes)
  const subjectKeyword = usePageStore((s) => s.indicators.subjectKeyword)
  const sortKey = usePageStore((s) => s.indicators.sortKey)
  const sortDirection = usePageStore((s) => s.indicators.sortDirection)
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
  const setExcludeReclassify = useCallback((v: boolean) => setIndicators({ excludeReclassify: v }), [setIndicators])
  const setSubjectKeyword = useCallback((v: string) => setIndicators({ subjectKeyword: v }), [setIndicators])
  const setSort = useCallback((key: string, direction: 'asc' | 'desc' | null) => setIndicators({ sortKey: key, sortDirection: direction }), [setIndicators])
  // 表格密度与隐藏列（持久化到 pageStateStore，刷新保持）
  const density = usePageStore((s) => s.indicators.density)
  const setDensity = useCallback((v: 'default' | 'dense' | 'compact') => setIndicators({ density: v }), [setIndicators])
  // 展开集合由持久化数组派生（Set 不可序列化，store 以数组存储）
  const expandedSet = useMemo(() => new Set(expandedCodes), [expandedCodes])
  const setExpandedCodes = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    const prev = new Set(usePageStore.getState().indicators.expandedCodes)
    usePageStore.getState().setIndicators({ expandedCodes: [...updater(prev)] })
  }, [])

  const isOperating = activeTab === 'operating'
  const isCashflow = activeTab === 'cashflow'

  // 隐藏列按 tab 分区（经营/静态/现金流独立存储，天然隔离同名列 key）
  const hiddenColumns = usePageStore((s) => (isOperating ? s.indicators.hiddenOperatingColumns : isCashflow ? s.indicators.hiddenCashflowColumns : s.indicators.hiddenStaticColumns))
  const setHiddenColumns = useCallback(
    (cols: string[]) => {
      // 隐藏当前排序列时联动清空排序（避免无表头入口的静默排序）
      const patch: Record<string, unknown> = isOperating ? { hiddenOperatingColumns: cols } : isCashflow ? { hiddenCashflowColumns: cols } : { hiddenStaticColumns: cols }
      const cur = usePageStore.getState().indicators
      if (cur.sortKey && cols.includes(cur.sortKey)) { patch.sortKey = null; patch.sortDirection = null }
      setIndicators(patch as Parameters<typeof setIndicators>[0])
    },
    [isOperating, isCashflow, setIndicators],
  )

  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const { data: periodsData } = useAvailablePeriods()
  // 期间候选按全局选中财年过滤（供分析抽屉/AI 面板在全局未选月份时回退最新期）
  const periods = useMemo(
    () => filterPeriodsByFiscalYear(periodsData?.periods ?? [], fiscalYear, periodsData?.fiscalStartMonth ?? 1),
    [periodsData, fiscalYear],
  )

  // 公司/期间全局口径（Header CompanyPill / PeriodPill 唯一入口）：
  // 指标接口公司参数为单公司形态（FilterParams.companyCode?: string），全局选中多家公司时
  // 由 useGlobalCompanyScope 取第一个并 antd message 提示降级；未选（null/[]）→ undefined（后端按 scope 汇总）
  const { companyCode } = useGlobalCompanyScope('财务指标')
  // 全局期间：null（仅选财年未选月份）→ undefined（后端取最新期）
  const globalPeriod = usePeriodStore((s) => s.period)
  const period = globalPeriod ?? undefined

  const { data: companies } = useCompanies()
  // 公司显示名：跟随全局「显示简称」开关（抽屉标题等所有展示处统一）
  const { getDisplayName } = useCompanyDisplayName()
  // AI 预分析需要两体系数据：当前 tab 的 query 恒挂载，另一体系在触发预分析时按需拉取（静态懒加载）
  const [aiNeedData, setAiNeedData] = useState(false)
  const operatingQuery = useOperatingIndicators({ companyCode, period, excludeReclassify: excludeReclassify || undefined }, { enabled: isOperating || aiNeedData })
  const staticQuery = useStaticIndicators({ companyCode, period, excludeReclassify: excludeReclassify || undefined }, { enabled: !isOperating || aiNeedData })
  const cashflowQuery = useCashflowIndicators({ companyCode, period }, { enabled: isCashflow })

  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])

  const activeItems = (isOperating ? operatingQuery.data?.items : isCashflow ? cashflowQuery.data?.items : staticQuery.data?.items) ?? []
  const isLoading = isOperating ? operatingQuery.isLoading : isCashflow ? cashflowQuery.isLoading : staticQuery.isLoading
  // isFetching：筛选刷新中（已保留旧数据），用于轻量视觉反馈而非整块替换
  const isFetching = isOperating ? operatingQuery.isFetching : isCashflow ? cashflowQuery.isFetching : staticQuery.isFetching
  // 去重分类口径下无法回溯的记录数（批次已替换/缺快照；现金流无重分类口径）
  const skippedReclassifyLogs = (isOperating ? operatingQuery.data?.skippedReclassifyLogs : staticQuery.data?.skippedReclassifyLogs) ?? 0

  const { nodes: activeTree, map: activeValueMap } = useMemo(() => adapt(activeItems, activeTab), [activeItems, activeTab])
  const activeExpandable = useMemo(() => collectExpandableCodes(activeTree), [activeTree])

  // 科目关键字过滤：命中节点保留整棵子树 + 祖先链；过滤时强制展开可见路径（清空后恢复用户展开态）
  const visibleTree = useMemo(() => filterTreeKeepSubtree(activeTree, subjectKeyword), [activeTree, subjectKeyword])
  const effectiveExpanded = useMemo(() => {
    if (!subjectKeyword.trim()) return expandedSet
    const next = new Set(expandedSet)
    const collect = (ns: SubjectNode[]) => {
      for (const n of ns) {
        if (n.children.length > 0) { next.add(n.code); collect(n.children) }
      }
    }
    collect(visibleTree)
    return next
  }, [visibleTree, subjectKeyword, expandedSet])

  // 列排序：树内同级排序（全层级，含 level0 根；分类列已移除，无需保护分组列）
  // sortKey 不属于当前 tab 列集合时不排序（跨 tab 共享排序状态的计算层防护）
  const sortedTree = useMemo(() => {
    if (!sortKey || !sortDirection) return visibleTree
    if (!buildColumnsFor(activeTab).some((c) => c.key === sortKey)) return visibleTree
    return sortTreeByLevel(visibleTree, activeValueMap, sortKey as MetricSortKey, sortDirection, { fromLevel: 0 })
  }, [visibleTree, activeValueMap, sortKey, sortDirection, activeTab])

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

  /** 打开单项分析抽屉：需先在全局公司筛选选中单一公司（未选择时按钮已在表格中禁用并提示） */
  const handleAnalyze = (node: SubjectNode) => {
    // 安全兜底：未选单一公司时不打开（正常流程按钮已禁用，此处防类型窄化丢失）
    if (!companyCode) return
    const companyName = getDisplayName(companyCode, entityCompanies.find((c) => c.code === companyCode)?.name ?? companyCode)
    const effectivePeriod = period ?? periods[periods.length - 1] ?? ''
    setAnalysisTarget({
      companyCode, companyName, subjectCode: node.code, subjectName: node.name, subjectType: activeTab,
      valueType: node.valueType, fiscalYear: effectivePeriod.slice(0, 4), period: effectivePeriod,
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
  const overviewOperatingRows = useMemo(() => flattenForExport(operatingQuery.data?.items ?? []).map(({ row }) => row), [operatingQuery.data?.items])
  const overviewStaticRows = useMemo(() => flattenForExport(staticQuery.data?.items ?? []).map(({ row }) => row), [staticQuery.data?.items])
  const hasOverviewData = overviewOperatingRows.length + overviewStaticRows.length > 0

  /** 重置筛选：恢复默认重分类口径/科目搜索（公司/期间为全局口径，由 Header 管理，不属页面重置范围） */
  const handleResetFilters = () => { setExcludeReclassify(false); setSubjectKeyword('') }

  // 导出：loading + 结果反馈（exporting/exportMsg/exportErr 与 handleExport 全链路迁入 use-indicator-export）
  const { exporting, exportMsg, exportErr, handleExport } = useIndicatorExport({
    subjectType: activeTab,
    getRows: () => activeItems,
    getHiddenColumns: () => hiddenColumns,
    getFilenameScope: () => (excludeReclassify ? '_原始口径' : ''),
  })

  return (
    <PageContainer
      title={(
        <span className="flex items-center gap-1">
          {fromDashboardKpi && (
            <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8" onClick={handleBackToDashboard} aria-label="返回看板">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          财务指标
        </span>
      )}
      className="flex h-[calc(100dvh-104px)] flex-col space-y-3 lg:h-[calc(100dvh-112px)]"
      // 视口撑满布局：main 可视高 = 100dvh - Header(h-14=56px)；减去 main 的 pt-6(24px) 与 pb-6(24px) 即页面可用高
      // （lg 断点 pb-8=32px → 112px）。页面内容恒一屏、main 不出现全局滚动条，表格高度由 flex 链撑满。
      // 104/112 必须与 main-layout.tsx 的 Header 高与 pt/pb 同步（改布局时需同步更新）
      description={description}
      stickyHeader
      headerRef={headerRef}
      actionsFullWidth
      actions={
        <IndicatorFilterBar
          subjectType={activeTab}
          excludeReclassify={excludeReclassify} onExcludeReclassifyChange={setExcludeReclassify}
          subjectKeyword={subjectKeyword} onSubjectKeywordChange={setSubjectKeyword}
          isAllExpanded={isAllExpanded} onToggleExpandAll={toggleExpandAll}
          density={density} onDensityChange={setDensity}
          hiddenColumns={hiddenColumns} onHiddenColumnsChange={setHiddenColumns}
          canCreateReports={can('reports', 'create')} canViewReports={can('reports', 'view')} canExport={can('indicators', 'export')}
          aiPreparing={overviewPreparing} aiDisabled={isLoading || !hasOverviewData || overviewPreparing}
          onAiPreAnalyze={() => setAiNeedData(true)} onViewAnalyses={() => navigate('/reports/analyses')}
          exporting={exporting} exportDisabled={isLoading || activeItems.length === 0 || exporting} onExport={handleExport}
        />
      }
    >

      {/* 页内 Tab：经营指标 / 静态指标（路由驱动，切换即导航到子页） */}
      <SubPageTabs items={INDICATOR_TABS} />

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

      {/* 导出结果提示条（瞬时反馈，保持直到下次导出；成功/失败分色） */}
      {exportMsg && (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/[0.08] px-4 py-2 text-sm text-success-strong">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {exportMsg}
        </div>
      )}
      {exportErr && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/[0.06] px-4 py-2 text-sm text-destructive">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {exportErr}
        </div>
      )}

      {/* 科目树表格卡片：flex-1 min-h-0 撑满剩余高度，MetricTree 滚动容器内部滚动、页面不滚动
         勿加 overflow-hidden：会截断 MetricTree 内部容器的 sticky 吸顶链 */}
      <Card className="flex min-h-0 flex-1 flex-col animate-fade-in rounded-card">
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
          {isLoading ? (
            /* 加载骨架：保持表格占位高度，避免内容区塌陷再撑回导致跳动 */
            <div className="py-3">
              <div className="flex gap-3">
                {Array.from({ length: isOperating ? 10 : isCashflow ? 7 : 5 }).map((_, c) => (
                  <Skeleton key={c} className="h-11 flex-1" />
                ))}
              </div>
              {Array.from({ length: 6 }).map((_, r) => (
                <div key={r} className="mt-2 flex gap-3">
                  {Array.from({ length: isOperating ? 10 : isCashflow ? 7 : 5 }).map((_, c) => (
                    <Skeleton key={c} className="h-10 flex-1" />
                  ))}
                </div>
              ))}
            </div>
          ) : activeTree.length === 0 ? (
            /* 空状态：引导调整筛选或一键重置 */
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">当前筛选无数据</p>
              <p className="mt-1 text-xs text-muted-foreground/70">请调整顶部公司/期间筛选后重试。</p>
              <Button variant="fused" size="sm" className="mt-3" onClick={handleResetFilters}>
                重置筛选
              </Button>
            </div>
          ) : (
            <div className={cn('flex min-h-0 flex-1 flex-col transition-opacity duration-200', isFetching && 'opacity-60')}>
              <MetricTree
                nodes={sortedTree}
                valueMap={activeValueMap}
                variant={activeTab}
                expandedCodes={effectiveExpanded}
                onToggle={handleToggle}
                onAnalyze={can('reports', 'create') ? handleAnalyze : undefined}
                analyzeDisabled={!companyCode}
                analyzeHint="请先在顶部公司筛选中选择单一公司，再对该公司的科目撰写单项分析"
                stickyHeaderTop={headerHeight}
                emptyText={subjectKeyword.trim() ? '未找到匹配科目' : undefined}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSortChange={setSort}
                density={density}
                hiddenColumns={hiddenColumns}
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
