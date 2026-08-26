import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { KpiCard } from '@/components/charts/kpi-card'
import { type TrendMetric, type TrendMode } from '@/components/charts/trend-metrics'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { KpiGridSkeleton, ChartSkeleton, ListSkeleton } from '@/components/ui/skeleton-blocks'
import { DashboardFilterBar } from '@/components/filters/dashboard-filter-bar'
import { useDashboardOverview } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { useDashboardFilters } from '@/hooks/useDashboardFilters'
import { TrendSection } from './trend-section'
import { ReceivablesCard } from './receivables-card'
import { InventoryPieCard } from './inventory-pie-card'
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react'

export default function DashboardPage() {
  // 吸顶测量：标题区高度实时测量（标题区含 actions 筛选控件，吸顶时筛选随标题区固定）
  const { headerRef } = useStickyHeader()
  // 查询条件与图表指标持久化到 pageStateStore（路由切换/刷新后恢复）；期间+主体维度与经营分析子页共享
  const setDashboard = usePageStore((s) => s.setDashboard)
  const setIndicators = usePageStore((s) => s.setIndicators)
  const trendMetric = usePageStore((s) => s.dashboard.trendMetric) as TrendMetric
  const trendMode = usePageStore((s) => s.dashboard.trendMode) as TrendMode
  const setTrendMetric = useCallback((v: TrendMetric) => setDashboard({ trendMetric: v }), [setDashboard])
  const setTrendMode = useCallback((v: TrendMode) => setDashboard({ trendMode: v }), [setDashboard])
  const navigate = useNavigate()
  // 共享看板筛选（主体 all/company:/summary: 三态 + 期间）：自动对齐与口径解析均内置于 hook
  const { dimFilter, setDimFilter, selectedPeriod, setSelectedPeriod, periodOptions, companyCode, currentSubjectName } =
    useDashboardFilters()

  // 真实后端数据（React Query），加载期展示骨架屏
  const { data, isLoading, isError, isFetching, refetch } = useDashboardOverview({
    period: selectedPeriod || periodOptions[periodOptions.length - 1],
    companyCode,
  })
  const kpiData = data?.kpiData ?? []
  const trendData = data?.trendData ?? []
  const currentPeriod = selectedPeriod || data?.period || periodOptions[periodOptions.length - 1] || ''
  // keepPreviousData 下期间/主体切换的后台刷新态（非首屏加载）
  const isRefreshing = isFetching && !isLoading
  const isEmpty = !isLoading && !isError && kpiData.length === 0

  // 后端降级（请求主体越权/不存在而被替换）时同步实际生效主体，防止下拉空白
  useEffect(() => {
    if (data?.degraded && data.companyCode) {
      setDimFilter(`${data.companyType === 'summary' ? 'summary' : 'company'}:${data.companyCode}`)
    }
  }, [data?.degraded, data?.companyCode, data?.companyType, setDimFilter])

  // 点击 KPI 卡片：同步看板当前筛选（主体+期间）到指标页并记录返回标记后跳转，保证指标页初始视图与看板上下文一致
  const handleKpiClick = useCallback(() => {
    const patch: { dimFilter?: string; periodFilter?: string } = {}
    // 主体：显式选择（all/company:/summary:）原样同步；自动模式（''）按后端实际生效主体解析
    if (dimFilter !== '') {
      patch.dimFilter = dimFilter
    } else if (data?.companyCode && data?.companyType) {
      patch.dimFilter = `${data.companyType === 'summary' ? 'summary' : 'company'}:${data.companyCode}`
    }
    // 期间：看板实际生效期间（选定期或后端回显最新期）；无候选时不动指标页期间
    if (currentPeriod) patch.periodFilter = currentPeriod
    setIndicators(patch)
    sessionStorage.setItem('dashboard.fromDashboard', '1')
    navigate('/indicators/operating')
  }, [dimFilter, data?.companyCode, data?.companyType, currentPeriod, setIndicators, navigate])

  // 当前主体显示名（顶部筛选解析；自动模式下支持用后端返回的实际生效主体覆盖，下行传入趋势口径说明）
  const subjectName = dimFilter === '' && data?.companyName ? data.companyName : currentSubjectName

  return (
    <PageContainer
      title="首页看板"
      stickyHeader
      headerRef={headerRef}
      actionsFullWidth
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <StatusIndicator
            variant={isError ? 'error' : isRefreshing ? 'idle' : 'active'}
            label={isError ? '同步失败' : isRefreshing ? '数据同步中…' : '数据已同步'}
            colored
            className="mr-1 hidden sm:inline-flex"
          />
          <DashboardFilterBar
            dimFilter={dimFilter}
            onDimChange={setDimFilter}
            selectedPeriod={selectedPeriod}
            onPeriodChange={setSelectedPeriod}
            periodOptions={periodOptions}
          />
          {isRefreshing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      }
    >
      {isLoading ? (
        <>
          <KpiGridSkeleton count={4} />
          <ChartSkeleton />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ListSkeleton rows={4} />
            <ListSkeleton rows={4} />
          </div>
        </>
      ) : isError ? (
        // 错误态：占位卡 + 重试（越权 403 / 网络失败统一提示）
        <Card className="animate-fade-in border border-border shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <p className="text-sm font-medium text-foreground">看板数据加载失败</p>
            <p className="text-xs text-muted-foreground">可能是所选主体超出数据权限范围，或网络异常；请调整筛选后重试</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              重试
            </Button>
          </CardContent>
        </Card>
      ) : isEmpty ? (
        // 空态：暂无经营数据
        <Card className="animate-fade-in border border-border shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <Inbox className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">暂无可用数据</p>
            <p className="text-xs text-muted-foreground">当前账户可能无任何数据权限，或尚未导入经营数据批次</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 核心 KPI 卡片区（收入/毛利/净利润/回款）—— 交错淡入，点击钻取指标分析 */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {kpiData.map((kpi, i) => (
              <KpiCard key={kpi.title} data={kpi} index={i} onClick={handleKpiClick} />
            ))}
          </div>

          {/* 综合分析：趋势分析（品类预算达成 / 公司预算达成 / 运营费用已迁至「经营分析」子页） */}
          <Card className="animate-fade-in border border-border shadow-sm">
            <CardContent className="px-6 py-6">
              <TrendSection
                data={trendData}
                metric={trendMetric}
                onMetricChange={setTrendMetric}
                mode={trendMode}
                onModeChange={setTrendMode}
                period={currentPeriod || undefined}
                subjectName={subjectName}
              />
            </CardContent>
          </Card>

          {/* 应收账款分析 + 存货品类分析（均跟随顶部主体筛选，期间跟随看板） */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ReceivablesCard period={currentPeriod || undefined} companyCode={companyCode} />
            <InventoryPieCard period={currentPeriod || undefined} companyCode={companyCode} />
          </div>
        </>
      )}
    </PageContainer>
  )
}
