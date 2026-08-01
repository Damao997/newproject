import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { KpiCard } from '@/components/charts/kpi-card'
import { type TrendMetric } from '@/components/charts/trend-metrics'
import { PageContainer } from '@/components/layout/page-container'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { KpiGridSkeleton, ChartSkeleton, ListSkeleton } from '@/components/ui/skeleton-blocks'
import { useCompanies, useDashboardOverview, useAvailablePeriods } from '@/hooks/api-queries'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { TrendSection } from './trend-section'
import { ProductBudgetCard } from './product-budget-card'
import { ReceivablesCard } from './receivables-card'
import { InventoryPieCard } from './inventory-pie-card'
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react'

export default function DashboardPage() {
  const [selectedPeriod, setSelectedPeriod] = useState('')
  // 主体筛选：all / company:CODE / summary:CODE（与指标页一致的三态格式）
  const [dimFilter, setDimFilter] = useState('all')
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('revenue')
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

  // 真实后端数据（React Query），加载期展示骨架屏
  const { data, isLoading, isError, isFetching, refetch } = useDashboardOverview({
    period: selectedPeriod || (fiscalYear ? periodOptions[periodOptions.length - 1] : undefined),
    companyCode,
  })
  const kpiData = data?.kpiData ?? []
  const trendData = data?.trendData ?? []
  const lastUpdatedAt = data?.lastUpdatedAt
  const currentPeriod = selectedPeriod || data?.period || periodOptions[periodOptions.length - 1] || ''
  // keepPreviousData 下期间/主体切换的后台刷新态（非首屏加载）
  const isRefreshing = isFetching && !isLoading
  const isEmpty = !isLoading && !isError && kpiData.length === 0

  return (
    <PageContainer
      title="首页看板"
      description={`数据更新时间: ${lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString('zh-CN') : new Date().toLocaleDateString('zh-CN')}${currentPeriod ? ` · 当前期间: ${currentPeriod}` : ''}`}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <StatusIndicator
            variant={isError ? 'error' : isRefreshing ? 'idle' : 'active'}
            label={isError ? '同步失败' : isRefreshing ? '数据同步中…' : '数据已同步'}
            colored
            className="mr-1 hidden sm:inline-flex"
          />
          <Select value={dimFilter} onValueChange={setDimFilter}>
            <SelectTrigger className="h-9 w-[150px] sm:w-[180px]" title="选择主体维度（汇总主体自动展开为成员合并口径）">
              <SelectValue placeholder="选择主体" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部主体</SelectItem>
              <SelectGroup>
                <SelectLabel>公司</SelectLabel>
                {entityCompanies.map((c) => (
                  <SelectItem key={c.code} value={`company:${c.code}`}>{c.name}</SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>汇总主体</SelectLabel>
                {summaryEntities.map((c) => (
                  <SelectItem key={c.code} value={`summary:${c.code}`}>{c.name}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {periodOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={selectedPeriod || 'latest'} onValueChange={(v) => setSelectedPeriod(v === 'latest' ? '' : v)}>
                <SelectTrigger className="h-9 w-[130px]" title="选择预览期间（KPI 按选定期计算）">
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
            <p className="text-sm font-medium text-foreground">暂无经营数据</p>
            <p className="text-xs text-muted-foreground">导入并激活经营数据批次后，看板将自动展示核心指标</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 核心 KPI 卡片区（收入/毛利/净利润/回款）—— 交错淡入，点击钻取指标分析 */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {kpiData.map((kpi, i) => (
              <KpiCard key={kpi.title} data={kpi} index={i} onClick={() => navigate('/indicators')} />
            ))}
          </div>

          {/* 财年趋势（指标可切换 + 主体口径联动顶部筛选） */}
          <TrendSection
            data={trendData}
            metric={trendMetric}
            onMetricChange={setTrendMetric}
            fiscalYearLabel={fiscalYear}
            companies={companies ?? []}
            dimFilter={dimFilter}
            onDimFilterChange={setDimFilter}
          />

          {/* 品类预算达成（单期间，主体口径跟随顶部筛选） */}
          <ProductBudgetCard period={currentPeriod || undefined} companyCode={companyCode} />

          {/* 应收分布 + 存货占比（各自独立筛选，期间跟随看板） */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ReceivablesCard period={currentPeriod || undefined} />
            <InventoryPieCard period={currentPeriod || undefined} />
          </div>
        </>
      )}
    </PageContainer>
  )
}
