import { useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { KpiCard } from '@/components/charts/kpi-card'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { useDashboardOverview } from '@/hooks/api-queries'
import { useDashboardFilters } from '@/hooks/useDashboardFilters'
import { ReceivablesCard } from './receivables-card'
import { InventoryPieCard } from './inventory-pie-card'
import { QuickEntries } from './quick-entries'
import { ExpenseStructureCard } from './expense-structure-card'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useSummaryMemberValues, type MemberBreakdown } from '@/hooks/use-summary-member-values'
import { kpiRootMatcher } from '@/components/charts/kpi-card'
import type { KpiData } from '@/types'

export default function DashboardPage() {
  // 吸顶测量：标题区高度实时测量（标题区含 actions 筛选控件，吸顶时筛选随标题区固定）
  const { headerRef } = useStickyHeader()
  const navigate = useNavigate()
  // 共享看板筛选（主体 all/company:/summary: 三态 + 全局期间）：主体与全局公司集合双向联动，期间读全局
  const { setDimFilter, selectedPeriod, periodOptions, companyCode } =
    useDashboardFilters()

  // 真实后端数据（React Query），加载期展示骨架屏
  const { data, isLoading, isError, isFetching, refetch } = useDashboardOverview({
    period: selectedPeriod || periodOptions[periodOptions.length - 1],
    companyCode,
  })
  const kpiData = data?.kpiData ?? []
  const currentPeriod = selectedPeriod || data?.period || periodOptions[periodOptions.length - 1] || ''
  // keepPreviousData 下期间/主体切换的后台刷新态（非首屏加载）
  const isRefreshing = isFetching && !isLoading
  const isEmpty = !isLoading && !isError && kpiData.length === 0

  // ---- 汇总主体 KPI 悬浮明细（成员公司数值）：仅当前主体为汇总主体时启用 ----
  // 成员树并行预取（/indicators/operating 同参同 key，挂载即后台拉取，hover 时命中缓存零等待）
  const isSummaryScope = data?.companyType === 'summary' && !!companyCode
  const summaryMembers = useSummaryMemberValues({
    variant: 'operating',
    period: currentPeriod || undefined,
    summaryCode: isSummaryScope ? companyCode ?? null : null,
  })
  // KPI 标题 → 成员树 level0 类目定位（kpiRootMatcher 与后端 metricNodes 口径一致）
  const kpiBreakdown = useMemo(() => {
    if (!isSummaryScope || !summaryMembers.enabled) return null
    return {
      getMemberValues: (kpiTitle: string) => {
        const m = kpiRootMatcher(kpiTitle)
        return summaryMembers.getMemberRoots(m.category, m.name)
      },
    }
  }, [isSummaryScope, summaryMembers])

  // 后端降级（请求主体越权/不存在而被替换）时同步实际生效主体，防止下拉空白
  useEffect(() => {
    if (data?.degraded && data.companyCode) {
      setDimFilter(`${data.companyType === 'summary' ? 'summary' : 'company'}:${data.companyCode}`)
    }
  }, [data?.degraded, data?.companyCode, data?.companyType, setDimFilter])

  // 点击 KPI 卡片：记录返回标记后跳转指标页。公司/期间口径已上收全局 periodStore（页面内主体切换亦回写全局），
  // 指标页读取同一全局口径，无需再同步 dimFilter/periodFilter
  const handleKpiClick = useCallback(() => {
    sessionStorage.setItem('dashboard.fromDashboard', '1')
    navigate('/indicators/operating')
  }, [navigate])

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
          {isRefreshing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      }
    >
      <DashboardView
        kpiData={kpiData}
        isEmpty={isEmpty}
        currentPeriod={currentPeriod}
        handleKpiClick={handleKpiClick}
        companyCode={companyCode}
        kpiBreakdown={kpiBreakdown}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
      />
    </PageContainer>
  )
}

interface DashboardViewProps {
  /** 核心 KPI 卡（后端返回几条展示几条，无 mock 补位） */
  kpiData: KpiData[]
  isEmpty: boolean
  currentPeriod: string
  handleKpiClick: () => void
  companyCode: string | undefined
  /** 汇总主体 KPI 悬浮明细数据源（仅汇总口径非空，见 DashboardPage） */
  kpiBreakdown?: {
    getMemberValues: (kpiTitle: string) => MemberBreakdown | undefined
  } | null
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
}

function DashboardView(props: DashboardViewProps) {
  const {
    kpiData,
    isEmpty,
    currentPeriod,
    handleKpiClick,
    companyCode,
    kpiBreakdown,
    isLoading = false,
    isError = false,
    onRetry,
  } = props

  return (
    <>
      {/* 加载/错误态：保留视觉密度的同时提示用户当前数据状态 */}
      {(isLoading || isError) && (
        <div
          className={
            isError
              ? 'flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive'
              : 'flex flex-wrap items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-2 text-sm text-primary'
          }
        >
          {isError ? <AlertTriangle className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
          <span className="flex-1">
            {isError ? '数据加载失败，请稍后重试' : '数据同步中'}
          </span>
          {isError && onRetry && (
            <Button variant="ghost" size="sm" onClick={onRetry}>
              <RefreshCw className="mr-1 h-3 w-3" />
              重试
            </Button>
          )}
        </div>
      )}

      {/* 核心 KPI 卡区（后端返回数量即展示数量；空数据时整行不渲染，不做 mock 补位） */}
      {kpiData.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {kpiData.map((kpi, i) => (
            <KpiCard key={kpi.title + '-' + i} data={kpi} index={i} onClick={handleKpiClick} breakdown={kpiBreakdown} />
          ))}
        </div>
      )}
      {isEmpty && (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          当前主体/期间暂无核心 KPI 数据，可在顶部切换筛选或前往「数据导入」激活批次。
        </div>
      )}

      {/* 费用结构（真实运营费用分析，圆环） */}
      <ExpenseStructureCard period={currentPeriod || undefined} companyCode={companyCode} />

      {/* 应收账款分析 + 存货品类分析（真实接口：应收按主体分布 / 存货品类占比，均跟随顶部筛选） */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ReceivablesCard period={currentPeriod || undefined} companyCode={companyCode} />
        <InventoryPieCard period={currentPeriod || undefined} companyCode={companyCode} />
      </div>

      {/* 快捷入口：8 张 antd 风格 quick-card，跨主业务/数据/系统 */}
      <QuickEntries />
    </>
  )
}
