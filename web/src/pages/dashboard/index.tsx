import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CompanySelect } from '@/components/filters/company-select'
import { KpiCard } from '@/components/charts/kpi-card'
import { type TrendMetric, type TrendMode } from '@/components/charts/trend-metrics'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { KpiGridSkeleton, ChartSkeleton, ListSkeleton } from '@/components/ui/skeleton-blocks'
import { useCompanies, useDashboardOverview, useAvailablePeriods } from '@/hooks/api-queries'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'
import { AnalysisTabsCard, type AnalysisTab } from './analysis-tabs-card'
import { ReceivablesCard } from './receivables-card'
import { InventoryPieCard } from './inventory-pie-card'
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react'

export default function DashboardPage() {
  // 吸顶测量：标题区高度实时测量（标题区含 actions 筛选控件，吸顶时筛选随标题区固定）
  const { headerRef } = useStickyHeader()
  // 查询条件与图表指标持久化到 pageStateStore（路由切换/刷新后恢复）
  const setDashboard = usePageStore((s) => s.setDashboard)
  const setIndicators = usePageStore((s) => s.setIndicators)
  const selectedPeriod = usePageStore((s) => s.dashboard.period)
  // 主体筛选：all / company:CODE / summary:CODE（与指标页一致的三态格式）；
  // 默认自动模式（''）：由后端按权限选择 ET0001 → 授权汇总 → 授权单体，前端在候选加载后对齐回显
  const dimFilter = usePageStore((s) => s.dashboard.dim)
  const trendMetric = usePageStore((s) => s.dashboard.trendMetric) as TrendMetric
  const trendMode = usePageStore((s) => s.dashboard.trendMode) as TrendMode
  const analysisTab = usePageStore((s) => s.dashboard.analysisTab) as AnalysisTab
  const setSelectedPeriod = useCallback((v: string) => setDashboard({ period: v }), [setDashboard])
  const setDimFilter = useCallback((v: string) => setDashboard({ dim: v }), [setDashboard])
  const setTrendMetric = useCallback((v: TrendMetric) => setDashboard({ trendMetric: v }), [setDashboard])
  const setTrendMode = useCallback((v: TrendMode) => setDashboard({ trendMode: v }), [setDashboard])
  const setAnalysisTab = useCallback((v: AnalysisTab) => setDashboard({ analysisTab: v }), [setDashboard])
  const navigate = useNavigate()

  // 期间候选：可用期间按全局选中财年过滤；未选时后端默认取最新期
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const { data: periodsData } = useAvailablePeriods()
  const periodOptions = useMemo(
    () => filterPeriodsByFiscalYear(periodsData?.periods ?? [], fiscalYear, periodsData?.fiscalStartMonth ?? 1),
    [periodsData, fiscalYear],
  )
  // 财年切换后已选期间不在候选内时回退默认（最新期）
  useEffect(() => {
    if (selectedPeriod && !periodOptions.includes(selectedPeriod)) setSelectedPeriod('')
  }, [periodOptions, selectedPeriod])

  // 主体维度候选：公司 / 汇总主体分组
  const { data: companies } = useCompanies()
  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  const summaryEntities = useMemo(() => (companies ?? []).filter((c) => c.type === 'summary'), [companies])
  const companyCode = dimFilter.startsWith('company:')
    ? dimFilter.slice('company:'.length)
    : dimFilter.startsWith('summary:')
      ? dimFilter.slice('summary:'.length)
      : undefined

  // 自动模式主体对齐 + 持久化主体校验：无选或编码已删除/越权时回退默认主体；
  // useCompanies 已按数据权限过滤（与后端同源：ET0001 → 首个汇总 → 首个单体），避免以越权主体发起请求
  useEffect(() => {
    if (!companies || companies.length === 0) return
    const valid = new Set(companies.map((c) => c.code))
    const fallback = () => {
      const et0001 = summaryEntities.find((c) => c.code === 'ET0001')
      if (et0001) return `summary:${et0001.code}`
      if (summaryEntities[0]) return `summary:${summaryEntities[0].code}`
      if (entityCompanies[0]) return `company:${entityCompanies[0].code}`
      return 'all'
    }
    const cur = usePageStore.getState().dashboard.dim
    if (cur === '') {
      setDimFilter(fallback())
      return
    }
    if (cur === 'all') return
    const code = cur.includes(':') ? cur.split(':')[1] : undefined
    if (!code || !valid.has(code)) setDimFilter(fallback())
  }, [dimFilter, companies, summaryEntities, entityCompanies, setDimFilter])

  // 真实后端数据（React Query），加载期展示骨架屏
  const { data, isLoading, isError, isFetching, refetch } = useDashboardOverview({
    period: selectedPeriod || (fiscalYear ? periodOptions[periodOptions.length - 1] : undefined),
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
  }, [data?.degraded, data?.companyCode, data?.companyType])

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

  // 当前主体显示名（顶部筛选解析；自动模式下用后端返回的实际生效主体）
  const currentSubjectName = useMemo(() => {
    if (dimFilter === '') return data?.companyName ?? '全部主体'
    const code = companyCode
    if (!code) return '全部主体'
    const match = (companies ?? []).find((c) => c.code === code)
    return match?.name ?? code
  }, [dimFilter, companyCode, companies, data?.companyName])

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
          <CompanySelect
            value={dimFilter}
            onChange={setDimFilter}
            valueFormat="prefixed"
            allLabel="全部主体"
            ariaLabel="选择主体维度（汇总主体自动展开为成员合并口径）"
            title="选择主体维度（汇总主体自动展开为成员合并口径）"
            className="h-8 w-[150px] border-input/60 bg-page hover:bg-muted/60 sm:w-[180px]"
          />
          {periodOptions.length > 0 && (
            <div className="flex items-center gap-2">
              {/* 未选时直接回显最新期间实际值（YYYY-MM），而非占位符文本；'latest' 项仍保留「跟随最新」语义 */}
              <Select
                value={selectedPeriod || periodOptions[periodOptions.length - 1] || 'latest'}
                onValueChange={(v) => setSelectedPeriod(v === 'latest' ? '' : v)}
              >
                <SelectTrigger className="h-8 w-[140px] border-input/60 bg-page hover:bg-muted/60" title="选择预览期间（KPI 按选定期计算）">
                  <SelectValue placeholder="最新期间" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">最新期间</SelectItem>
                  {[...periodOptions].reverse().map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isRefreshing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          )}
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

          {/* 综合分析：趋势分析 / 品类预算达成 / 公司预算达成 / 运营费用（TAB 切换，主体口径跟随顶部筛选） */}
          <AnalysisTabsCard
            period={currentPeriod || undefined}
            companyCode={companyCode}
            subjectName={currentSubjectName}
            trendData={trendData}
            trendMetric={trendMetric}
            onTrendMetricChange={setTrendMetric}
            trendMode={trendMode}
            onTrendModeChange={setTrendMode}
            tab={analysisTab}
            onTabChange={setAnalysisTab}
          />

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
