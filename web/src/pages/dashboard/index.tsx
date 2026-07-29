import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { KpiCard } from '@/components/charts/kpi-card'
import { TrendChart } from '@/components/charts/trend-chart'
import { PageContainer } from '@/components/layout/page-container'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { KpiGridSkeleton, ChartSkeleton, ListSkeleton } from '@/components/ui/skeleton-blocks'
import { usePermission } from '@/hooks/usePermission'
import { useDashboardOverview, useAvailablePeriods } from '@/hooks/api-queries'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { exportToExcel } from '@/lib/export'
import { 
  Download, 
  Upload, 
  FileText, 
  AlertTriangle,
  TrendingUp,
  Clock
} from 'lucide-react'

interface DashboardAlert { id: string; severity: string; title: string; message: string; createdAt: string }

export default function DashboardPage() {
  const [compareType, setCompareType] = useState<'yoy' | 'mom'>('yoy')
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const { can } = usePermission()
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

  // 真实后端数据（React Query），加载期展示骨架屏
  const { data, isLoading } = useDashboardOverview(selectedPeriod || (fiscalYear ? periodOptions[periodOptions.length - 1] : undefined))
  const kpiData = data?.kpiData ?? []
  const trendData = data?.trendData ?? []
  const alerts = (data?.alerts ?? []) as DashboardAlert[]
  const lastUpdatedAt = data?.lastUpdatedAt
  const currentPeriod = selectedPeriod || data?.period || ''

  const handleExport = async () => {
    await exportToExcel({
      filename: `首页看板_收入趋势_${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: '收入趋势',
      columns: [
        { header: '期间', key: 'period', width: 12 },
        { header: '收入(万)', key: 'revenue', width: 14 },
        { header: '成本(万)', key: 'cost', width: 14 },
        { header: '毛利(万)', key: 'profit', width: 14 },
        { header: '月均预算(万)', key: 'budget', width: 14 },
      ],
      rows: trendData.map((r) => ({
        period: r.period,
        revenue: r.revenue,
        cost: r.cost,
        profit: r.profit,
        budget: r.budget ?? '-',
      })),
    })
  }

  return (
    <PageContainer
      title="首页看板"
      description={`数据更新时间: ${lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString('zh-CN') : new Date().toLocaleDateString('zh-CN')}${currentPeriod ? ` · 当前期间: ${currentPeriod}` : ''}`}
      actions={
        <div className="flex items-center gap-3">
          <StatusIndicator variant="active" label="数据实时同步" colored className="mr-1 hidden sm:inline-flex" />
          {periodOptions.length > 0 && (
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
          )}
          {can('dashboard', 'export') && (
            <Button variant="outline" size="sm" className="h-9 px-4" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              导出数据
            </Button>
          )}
          {can('data:import', 'upload') && (
            <Button size="sm" className="h-9 px-4" onClick={() => navigate('/data')}>
              <Upload className="mr-2 h-4 w-4" />
              导入数据
            </Button>
          )}
        </div>
      }
    >
      {isLoading ? (
        <>
          <KpiGridSkeleton count={5} />
          <ChartSkeleton />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ListSkeleton rows={4} />
            <ListSkeleton rows={2} />
          </div>
        </>
      ) : (
        <>
          {/* KPI 卡片区 —— 交错淡入 */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {kpiData.map((kpi, i) => (
              <KpiCard key={kpi.title} data={kpi} index={i} />
            ))}
          </div>

          {/* 趋势图区 */}
          <Card className="animate-fade-in border border-border bg-white shadow-sm transition-shadow duration-200 hover:shadow-md" style={{ animationDelay: '120ms' }}>
            <CardHeader className="flex flex-row items-center justify-between px-6 pb-3 pt-5">
              <div>
                <CardTitle className="text-lg font-semibold text-foreground">
                  收入趋势分析
                </CardTitle>
                <p className="mt-1 text-xs text-[#64748B]">近12个月收入、成本、毛利对比</p>
              </div>
              <Tabs value={compareType} onValueChange={(v) => setCompareType(v as 'yoy' | 'mom')}>
                <TabsList className="bg-[#F1F5F9] p-1">
                  <TabsTrigger value="yoy" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-white data-[state=active]:text-[#0F172A] data-[state=active]:shadow-sm">同比</TabsTrigger>
                  <TabsTrigger value="mom" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-white data-[state=active]:text-[#0F172A] data-[state=active]:shadow-sm">环比</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <TrendChart data={trendData} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-5">
            {/* 预警提醒 */}
            <Card className="animate-fade-in border border-border bg-white shadow-sm transition-shadow duration-200 hover:shadow-md" style={{ animationDelay: '280ms' }}>
              <CardHeader className="px-6 pb-3 pt-5">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFFBEB]">
                    <AlertTriangle className="h-4 w-4 text-[#D97706]" />
                  </div>
                  预警提醒
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <div className="space-y-3">
                  {alerts.map((alert, i) => (
                    <div
                      key={alert.id}
                      className={`animate-fade-in rounded-xl border p-4 ${
                        alert.severity === 'error'
                          ? 'border-[#FECACA] border-l-[3px] border-l-[#EF4444] bg-[#FEF2F2]'
                          : 'border-[#FDE68A] border-l-[3px] border-l-[#F59E0B] bg-[#FFFBEB]'
                      }`}
                      style={{ animationDelay: `${320 + i * 80}ms` }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                            alert.severity === 'error' ? 'bg-[#FEE2E2]' : 'bg-[#FEF3C7]'
                          }`}>
                            <AlertTriangle
                              className={`h-4 w-4 ${
                                alert.severity === 'error' ? 'text-[#EF4444]' : 'text-[#D97706]'
                              }`}
                            />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-foreground">{alert.title}</h4>
                            <p className="mt-1 text-sm leading-relaxed text-[#64748B]">
                              {alert.message}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`ml-2 inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            alert.severity === 'error'
                              ? 'bg-[#FEE2E2] text-[#EF4444]'
                              : 'bg-[#FEF3C7] text-[#D97706]'
                          }`}
                        >
                          {alert.severity === 'error' ? '严重' : '警告'}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-1 text-xs text-[#64748B]">
                        <Clock className="h-3 w-3" />
                        {new Date(alert.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 快捷入口 */}
          <Card className="animate-fade-in border border-border bg-white shadow-sm transition-shadow duration-200 hover:shadow-md" style={{ animationDelay: '360ms' }}>
            <CardHeader className="px-6 pb-3 pt-5">
              <CardTitle className="text-lg font-semibold">快捷入口</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {can('data:import', 'upload') && (
                  <button
                    type="button"
                    className="group flex h-24 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-white transition-all duration-150 hover:border-orange-400/50 hover:shadow-md active:scale-[0.97]"
                    onClick={() => navigate('/data')}
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10">
                      <Upload className="h-5 w-5 text-orange-500" />
                    </div>
                    <span className="text-sm font-medium">导入数据</span>
                  </button>
                )}
                <button
                  type="button"
                  className="group flex h-24 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-white transition-all duration-150 hover:border-orange-400/50 hover:shadow-md active:scale-[0.97]"
                  onClick={() => navigate('/reports')}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
                    <FileText className="h-5 w-5 text-emerald-500" />
                  </div>
                  <span className="text-sm font-medium">新建报告</span>
                </button>
                <button
                  type="button"
                  className="group flex h-24 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-white transition-all duration-150 hover:border-orange-400/50 hover:shadow-md active:scale-[0.97]"
                  onClick={() => navigate('/indicators')}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
                    <TrendingUp className="h-5 w-5 text-blue-500" />
                  </div>
                  <span className="text-sm font-medium">财务指标</span>
                </button>
                <button
                  type="button"
                  className="group flex h-24 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-white transition-all duration-150 hover:border-orange-400/50 hover:shadow-md active:scale-[0.97]"
                  onClick={() => navigate('/reports')}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10">
                    <Download className="h-5 w-5 text-violet-500" />
                  </div>
                  <span className="text-sm font-medium">导出报表</span>
                </button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </PageContainer>
  )
}
