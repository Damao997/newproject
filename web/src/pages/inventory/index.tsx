import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompanyMultiSelect } from '@/components/filters/company-select'
import { PageContainer } from '@/components/layout/page-container'
import { AnalysisDrawer, type AnalysisTarget } from '@/components/indicators/analysis-drawer'
import {
  useAvailablePeriods,
  useInventoryDetails,
  useInventoryOverview,
  type InventoryDetailRow,
} from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { usePermission } from '@/hooks/usePermission'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { cn, formatMoneyWan, getChangeColor, getChangePrefix } from '@/lib/utils'
import { Package, Boxes, CalendarClock, TrendingUp, FileText } from 'lucide-react'
import { CategoryPieCard } from './category-pie-card'
import { CategoryRankCard } from './category-rank-card'
import { InventoryTrendCard } from './trend-card'

/**
 * 存货管理页：数据源为静态数据（fact_static 存货品类叶子科目），
 * 按 期间 × 公司 × 品类 聚合展示总览 KPI、品类占比/排名、财年趋势与公司×品类明细；
 * 周转指标直接复用静态树「存货周转天数」，与指标页口径一致。金额单位：万元。
 */

/** KPI 图标底色：与看板四色体系一致（图表序列色），按序轮换 */
const KPI_ACCENTS = [
  'bg-chart-1/10 text-chart-1',
  'bg-chart-2/10 text-chart-2',
  'bg-chart-3/10 text-chart-3',
  'bg-chart-5/10 text-chart-5',
]

function StatCard({ title, icon: Icon, value, sub, index }: {
  title: string
  icon: React.ElementType
  value: React.ReactNode
  sub?: React.ReactNode
  index: number
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
        <div className="font-num text-[26px] font-bold leading-tight tracking-tight text-foreground">{value}</div>
        {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

/** 变动率徽标：红涨绿跌（国内财报习惯），分母为 0 显示 '-' */
function ChangeRate({ current, base }: { current: number; base: number }) {
  if (!base) return <span className="font-num text-muted-foreground">-</span>
  const rate = ((current - base) / base) * 100
  return (
    <span className={cn('font-num', getChangeColor(rate))}>
      {getChangePrefix(rate)}{Math.abs(rate).toFixed(1)}%
    </span>
  )
}

/** 周转天数展示：无口径（0）显示 '-' */
function formatDays(v: number): string {
  return v > 0 ? `${v.toFixed(1)} 天` : '-'
}

export default function InventoryPage() {
  const { can } = usePermission()
  // 公司多选（空数组 = 全部公司）与期间单选（空串 = 跟随最新期间）
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const [periodFilter, setPeriodFilter] = useState('')
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
  }, [periods, periodFilter])

  const period = periodFilter || periods[periods.length - 1]

  const overviewQuery = useInventoryOverview({ period, companyCodes: selectedCompanies })
  const detailsQuery = useInventoryDetails({ period, companyCodes: selectedCompanies })
  const overview = overviewQuery.data
  const detailRows = detailsQuery.data?.rows ?? []

  const { getDisplayName } = useCompanyDisplayName()

  /** 打开单项分析抽屉：品类为静态科目，指标上下文映射与指标页静态口径一致 */
  const handleAnalyze = (row: InventoryDetailRow) => {
    if (!period) return
    setAnalysisTarget({
      companyCode: row.companyCode,
      companyName: row.companyName,
      subjectCode: row.categoryCode,
      subjectName: row.categoryName,
      subjectType: 'static',
      valueType: 'amount',
      fiscalYear: period.slice(0, 4),
      period,
      // 静态科目 → MetricValue：本期→actual、同期→samePeriod、年初→budget/ytd、上年年初→samePeriodYtd
      metric: { budget: row.yearStart, actual: row.current, samePeriod: row.samePeriod, ytd: row.yearStart, samePeriodYtd: row.lastYearStart },
    })
  }

  const canAnalyze = can('reports', 'create')
  const total = overview?.total
  const isOverviewLoading = overviewQuery.isLoading

  return (
    <PageContainer
      title="存货管理"
      description="库存总览、品类占比、周转指标、趋势分析（数据源：静态数据存货品类）"
    >
      <div className="space-y-6">
        {/* 筛选行：公司多选 + 期间单选（财年由顶部导航全局控制） */}
        <div className="flex flex-wrap items-center gap-3">
          <CompanyMultiSelect value={selectedCompanies} onChange={setSelectedCompanies} />
          <Select value={period ?? ''} onValueChange={setPeriodFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="期间" />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">金额单位：万元</span>
        </div>

        {/* KPI 卡行 */}
        <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4 transition-opacity duration-200', overviewQuery.isFetching && 'opacity-60')}>
          <StatCard
            index={0}
            title="存货总额（本期）"
            icon={Package}
            value={isOverviewLoading || !total ? '-' : formatMoneyWan(total.current)}
            sub={total ? <>年初 <span className="font-num">{formatMoneyWan(total.yearStart)}</span></> : undefined}
          />
          <StatCard
            index={1}
            title="较年初增减"
            icon={Boxes}
            value={
              isOverviewLoading || !total ? '-' : (
                <span className={getChangeColor(total.current - total.yearStart)}>
                  {getChangePrefix(total.current - total.yearStart)}{formatMoneyWan(Math.abs(total.current - total.yearStart))}
                </span>
              )
            }
            sub={total ? <>增减率 <ChangeRate current={total.current} base={total.yearStart} /></> : undefined}
          />
          <StatCard
            index={2}
            title="同比增减率"
            icon={TrendingUp}
            value={isOverviewLoading || !total ? '-' : <ChangeRate current={total.current} base={total.samePeriod} />}
            sub={total ? <>同期 <span className="font-num">{formatMoneyWan(total.samePeriod)}</span></> : undefined}
          />
          <StatCard
            index={3}
            title="存货周转天数"
            icon={CalendarClock}
            value={isOverviewLoading || !overview ? '-' : formatDays(overview.turnoverDays.current)}
            sub={overview ? <>同期 <span className="font-num">{formatDays(overview.turnoverDays.samePeriod)}</span></> : undefined}
          />
        </div>

        {/* 图表区：品类占比饼图 + 品类排名 */}
        <div className={cn('grid gap-6 lg:grid-cols-2 transition-opacity duration-200', overviewQuery.isFetching && 'opacity-60')}>
          <CategoryPieCard categories={overview?.categories ?? []} loading={isOverviewLoading} />
          <CategoryRankCard categories={overview?.categories ?? []} loading={isOverviewLoading} />
        </div>

        {/* 财年月度趋势（公司多选联动，财年跟随顶部导航） */}
        <InventoryTrendCard companyCodes={selectedCompanies} fiscalYear={fiscalYear} />

        {/* 明细表：公司 × 品类 */}
        <Card className="animate-fade-in">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Boxes className="h-4 w-4" />
              公司 × 品类明细
              <span className="ml-1 text-xs font-normal text-muted-foreground">{period ?? ''} · 共 {detailRows.length} 行</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {detailsQuery.isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>
            ) : detailRows.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">暂无存货数据</div>
            ) : (
              <div className={cn('max-h-[520px] overflow-auto transition-opacity duration-200', detailsQuery.isFetching && 'opacity-60')}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b text-center text-black">
                      <th className="px-2 py-2 font-medium">公司</th>
                      <th className="px-2 py-2 font-medium">品类</th>
                      <th className="px-2 py-2 font-medium">本期金额</th>
                      <th className="px-2 py-2 font-medium">年初金额</th>
                      <th className="px-2 py-2 font-medium">较年初</th>
                      <th className="px-2 py-2 font-medium">同期金额</th>
                      <th className="px-2 py-2 font-medium">同比</th>
                      {canAnalyze && <th className="px-2 py-2 font-medium">操作</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((row) => (
                      <tr key={`${row.companyCode}-${row.categoryCode}`} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="max-w-[180px] truncate px-2 py-2 text-xs" title={row.companyName}>
                          {getDisplayName(row.companyCode, row.companyName)}
                        </td>
                        <td className="px-2 py-2">{row.categoryName}</td>
                        <td className="px-2 py-2 text-right font-num">{formatMoneyWan(row.current)}</td>
                        <td className="px-2 py-2 text-right font-num">{formatMoneyWan(row.yearStart)}</td>
                        <td className="px-2 py-2 text-right"><ChangeRate current={row.current} base={row.yearStart} /></td>
                        <td className="px-2 py-2 text-right font-num">{formatMoneyWan(row.samePeriod)}</td>
                        <td className="px-2 py-2 text-right">
                          {row.samePeriod ? (
                            <span className={cn('font-num', getChangeColor(row.yoy))}>{getChangePrefix(row.yoy)}{Math.abs(row.yoy).toFixed(1)}%</span>
                          ) : (
                            <span className="font-num text-muted-foreground">-</span>
                          )}
                        </td>
                        {canAnalyze && (
                          <td className="px-2 py-2 text-center">
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleAnalyze(row)}>
                              <FileText className="mr-1 h-3.5 w-3.5" />
                              分析
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 单项分析抽屉（与指标页共用组件） */}
      <AnalysisDrawer open={analysisTarget !== null} target={analysisTarget} onClose={() => setAnalysisTarget(null)} />
    </PageContainer>
  )
}
