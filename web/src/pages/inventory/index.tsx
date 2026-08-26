import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MonthPicker } from '@/components/ui/month-picker'
import { CompanyMultiSelect } from '@/components/filters/company-select'
import { PageContainer } from '@/components/layout/page-container'
import { FilterBar } from '@/components/layout/filter-bar'
import { FILTER_WIDTH } from '@/components/layout/filter-width'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { useExclusiveCompanyFilter } from '@/hooks/use-exclusive-company-filter'
import { AnalysisDrawer, type AnalysisTarget } from '@/components/indicators/analysis-drawer'
import {
  useAvailablePeriods,
  useCompanies,
  useInventoryDetails,
  useInventoryOverview,
  useSubjectTree,
} from '@/hooks/api-queries'
import { usePermission } from '@/hooks/usePermission'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'
import { cn, formatMoneyWan, getChangeColor, getChangePrefix } from '@/lib/utils'
import { ArrowLeft } from 'lucide-react'
import { CategoryPieCard } from './category-pie-card'
import { CategoryRankCard } from './category-rank-card'
import { CompanyShareCard } from './company-share-card'
import { InventoryTrendCard } from './trend-card'
import { ChangeRate, DetailTable, QueryError } from './detail-table'
import { EMPTY_ROWS, formatDays, type DetailDim, type ViewRow } from './inventory-utils'

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

function StatCard({ title, value, sub, index, loading }: {
  title: string
  value: React.ReactNode
  sub?: React.ReactNode
  index: number
  loading?: boolean
}) {
  return (
    <Card
      className="animate-fade-in border border-border"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <CardHeader className="px-5 pb-1 pt-5 text-center">
        <CardTitle className="text-[14px] font-medium tracking-wide text-black">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4 text-center">
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

export default function InventoryPage() {
  const { can } = usePermission()
  // 吸顶测量：标题区 + 筛选卡高度实时测量，驱动筛选卡吸顶偏移
  const { headerRef, filterRef, headerHeight } = useStickyHeader()
  // 公司多选（空数组 = 全部公司）、期间单选（空串 = 跟随最新期间）、品类钻取与关键词；
  // 查询条件持久化到 pageStateStore（路由切换/刷新后恢复）
  const setInventory = usePageStore((s) => s.setInventory)
  const selectedCompanies = usePageStore((s) => s.inventory.companies)
  const periodFilter = usePageStore((s) => s.inventory.period)
  const categoryCode = usePageStore((s) => s.inventory.categoryCode)
  const detailDim = usePageStore((s) => s.inventory.detailDim)
  const setSelectedCompanies = useCallback((v: string[]) => setInventory({ companies: v }), [setInventory])
  const setPeriodFilter = useCallback((v: string) => setInventory({ period: v }), [setInventory])
  const setDetailDim = useCallback((d: DetailDim) => setInventory({ detailDim: d }), [setInventory])
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
  // 主体互斥业务规则：单体公司与汇总主体不能同时筛选；逻辑与轻提示收敛于共享 hook（防止成员公司双重计数）
    const { handleCompaniesChange, noticeElement } = useExclusiveCompanyFilter({
    companies,
    getPrev: () => usePageStore.getState().inventory.companies,
    setSelected: setSelectedCompanies,
  })
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

  // 「存货」根科目（静态树按名称解析，与后端 resolveInventorySubjects 口径一致），公司级分析主体
  const { data: staticTree } = useSubjectTree('static')
  const inventoryRoot = useMemo(() => staticTree?.find((n) => n.name === '存货') ?? null, [staticTree])

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

  // 从看板存货品类卡深链进入时显示「返回首页」按钮（sessionStorage 标记，点击返回时清除；刷新后仍保留）
  const navigate = useNavigate()
  const [fromDashboard] = useState(() => sessionStorage.getItem('dashboard.fromDashboard') === '1')
  const handleBackToDashboard = useCallback(() => {
    sessionStorage.removeItem('dashboard.fromDashboard')
    navigate('/')
  }, [navigate])

  return (
    <PageContainer
      title={(
        <span className="flex items-center gap-1">
          {fromDashboard && (
            <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8" onClick={handleBackToDashboard} aria-label="返回首页">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          存货管理
        </span>
      )}
      stickyHeader
      headerRef={headerRef}
    >
      <div className="space-y-6">
        {/* 筛选卡：公司多选（单体/汇总互斥）+ 期间单选（财年由顶部导航全局控制，财年月外的月份禁用）；吸顶 */}
        <Card ref={filterRef} className="sticky z-10 rounded-card p-4" style={{ top: headerHeight }}>
        <FilterBar>
          <CompanyMultiSelect
            value={selectedCompanies}
            onChange={handleCompaniesChange}
            selectAllType="entity"
            className={`h-9 ${FILTER_WIDTH.subject}`}
          />
          <MonthPicker
            value={periodFilter}
            onChange={setPeriodFilter}
            availablePeriods={periods}
            allowedPeriods={periods}
            placeholder="最新期间"
            className="h-9 w-full sm:w-[150px]"
          />
          <span className="text-xs text-muted-foreground">金额单位：万元</span>
        </FilterBar>
        {noticeElement}
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
              value={total ? formatMoneyWan(total.current) : '-'}
              sub={total ? <>年初 <span className="font-num">{formatMoneyWan(total.yearStart)}</span></> : undefined}
            />
            <StatCard
              index={1}
              loading={isOverviewLoading}
              title="较年初增减"
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
              value={total ? <ChangeRate current={total.current} base={total.samePeriod} /> : '-'}
              sub={total ? <>同期 <span className="font-num">{formatMoneyWan(total.samePeriod)}</span></> : undefined}
            />
            <StatCard
              index={3}
              loading={isOverviewLoading}
              title="存货周转天数"
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

        {/* 明细表：维度切换/搜索/排序/行选择/导出/单项分析（状态与逻辑在 detail-table 内，主文件仅接数据与回调） */}
        <DetailTable
          detailDim={detailDim}
          setDetailDim={setDetailDim}
          rows={detailRows}
          loading={detailsQuery.isLoading}
          isError={detailsQuery.isError}
          error={detailsQuery.error}
          fetching={detailsQuery.isFetching}
          onRetry={() => detailsQuery.refetch()}
          period={period}
          categoryCode={categoryCode}
          categoryName={activeCategoryName}
          canAnalyze={canAnalyze}
          companyAnalyzeDisabled={!inventoryRoot}
          onAnalyzeCompany={handleAnalyzeCompany}
          onAnalyze={setAnalysisTarget}
        />
      </div>

      {/* 单项分析抽屉（与指标页共用组件） */}
      <AnalysisDrawer open={analysisTarget !== null} target={analysisTarget} onClose={() => setAnalysisTarget(null)} />
    </PageContainer>
  )
}
