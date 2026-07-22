import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KpiCard } from '@/components/charts/kpi-card'
import { TrendChart } from '@/components/charts/trend-chart'
import { MiniBarChart } from '@/components/charts/mini-bar-chart'
import { PageContainer } from '@/components/layout/page-container'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { KpiGridSkeleton, ChartSkeleton, ListSkeleton } from '@/components/ui/skeleton-blocks'
import { usePermission } from '@/hooks/usePermission'
import { exportToExcel } from '@/lib/export'
import { formatMoney } from '@/lib/utils'
import { 
  Download, 
  Upload, 
  FileText, 
  AlertTriangle,
  TrendingUp,
  Building2,
  Clock
} from 'lucide-react'
import { 
  mockKpiData, 
  mockTrendData, 
  mockBusinessUnitData, 
  mockAlerts 
} from '@/mock/data'

export default function DashboardPage() {
  const [compareType, setCompareType] = useState<'yoy' | 'mom'>('yoy')
  // 首屏加载态：数据就绪前展示骨架屏（借鉴 demo-3，降低布局抖动、提升感知性能）
  const [isLoading, setIsLoading] = useState(true)
  const { can } = usePermission()
  const navigate = useNavigate()

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 600)
    return () => clearTimeout(timer)
  }, [])

  const handleExport = async () => {
    await exportToExcel({
      filename: `首页看板_收入趋势_${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: '收入趋势',
      columns: [
        { header: '期间', key: 'period', width: 12 },
        { header: '收入(万)', key: 'revenue', width: 14 },
        { header: '成本(万)', key: 'cost', width: 14 },
        { header: '毛利(万)', key: 'profit', width: 14 },
        { header: '预算(万)', key: 'budget', width: 14 },
      ],
      rows: mockTrendData.map((r) => ({
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
      description={`数据更新时间: ${new Date().toLocaleDateString('zh-CN')}`}
      actions={
        <div className="flex items-center gap-3">
          <StatusIndicator variant="active" label="数据实时同步" colored className="mr-1 hidden sm:inline-flex" />
          {can('dashboard', 'export') && (
            <Button variant="outline" size="sm" className="h-9 px-4" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              导出数据
            </Button>
          )}
          <Button size="sm" className="h-9 px-4" onClick={() => navigate('/data')}>
            <Upload className="mr-2 h-4 w-4" />
            导入数据
          </Button>
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
            {mockKpiData.map((kpi, i) => (
              <KpiCard key={kpi.title} data={kpi} index={i} />
            ))}
          </div>

          {/* 趋势图区 */}
          <Card className="animate-fade-in border-0 bg-white shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]" style={{ animationDelay: '120ms' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-6 px-6">
              <div>
                <CardTitle className="flex items-center gap-3 text-lg font-semibold text-foreground">
                  收入趋势分析
                  <StatusIndicator variant="active" label="实时" colored />
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">近12个月收入、成本、毛利对比</p>
              </div>
              <Tabs value={compareType} onValueChange={(v) => setCompareType(v as 'yoy' | 'mom')}>
                <TabsList className="bg-slate-100">
                  <TabsTrigger value="yoy" className="text-xs px-3 py-1.5">同比</TabsTrigger>
                  <TabsTrigger value="mom" className="text-xs px-3 py-1.5">环比</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <TrendChart data={mockTrendData} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* 事业部概览 —— 轻量 CSS 图表 */}
            <Card className="animate-fade-in border-0 bg-white shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]" style={{ animationDelay: '200ms' }}>
              <CardHeader className="pb-2 pt-6 px-6">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="h-4 w-4 text-primary" />
                  </div>
                  事业部概览
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <MiniBarChart
                  data={mockBusinessUnitData.map((bu) => ({
                    label: bu.name,
                    value: bu.revenue,
                    hint: `${bu.percentage}%`,
                  }))}
                  valueFormatter={(v) => formatMoney(v)}
                />
              </CardContent>
            </Card>

            {/* 预警提醒 */}
            <Card className="animate-fade-in border-0 bg-white shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]" style={{ animationDelay: '280ms' }}>
              <CardHeader className="pb-2 pt-6 px-6">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  </div>
                  预警提醒
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <div className="space-y-3">
                  {mockAlerts.map((alert, i) => (
                    <div
                      key={alert.id}
                      className={`group relative animate-fade-in rounded-xl border p-4 transition-all hover:shadow-md ${
                        alert.severity === 'error'
                          ? 'border-red-100 bg-gradient-to-r from-red-50 to-white'
                          : 'border-amber-100 bg-gradient-to-r from-amber-50 to-white'
                      }`}
                      style={{ animationDelay: `${320 + i * 80}ms` }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg ${
                            alert.severity === 'error' ? 'bg-red-100' : 'bg-amber-100'
                          }`}>
                            <AlertTriangle
                              className={`h-4 w-4 ${
                                alert.severity === 'error' ? 'text-red-600' : 'text-amber-600'
                              }`}
                            />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-foreground">{alert.title}</h4>
                            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                              {alert.message}
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant={alert.severity === 'error' ? 'destructive' : 'warning'}
                          className="ml-2 shrink-0"
                        >
                          {alert.severity === 'error' ? '严重' : '警告'}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(alert.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 快捷入口 —— 模块卡片式（借鉴 demo-2） */}
          <Card className="animate-fade-in border-0 bg-white shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]" style={{ animationDelay: '360ms' }}>
            <CardHeader className="pb-2 pt-6 px-6">
              <CardTitle className="text-lg font-semibold">快捷入口</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <button
                  type="button"
                  className="group flex h-24 flex-col items-center justify-center gap-3 rounded-xl border-2 border-slate-100 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/5"
                  onClick={() => navigate('/data')}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
                    <Upload className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-sm font-medium">导入数据</span>
                </button>
                <button
                  type="button"
                  className="group flex h-24 flex-col items-center justify-center gap-3 rounded-xl border-2 border-slate-100 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/50 hover:bg-emerald-50"
                  onClick={() => navigate('/reports')}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 transition-colors group-hover:bg-emerald-200">
                    <FileText className="h-5 w-5 text-emerald-600" />
                  </div>
                  <span className="text-sm font-medium">新建报告</span>
                </button>
                <button
                  type="button"
                  className="group flex h-24 flex-col items-center justify-center gap-3 rounded-xl border-2 border-slate-100 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-500/50 hover:bg-blue-50"
                  onClick={() => navigate('/indicators')}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 transition-colors group-hover:bg-blue-200">
                    <TrendingUp className="h-5 w-5 text-blue-600" />
                  </div>
                  <span className="text-sm font-medium">财务指标</span>
                </button>
                <button
                  type="button"
                  className="group flex h-24 flex-col items-center justify-center gap-3 rounded-xl border-2 border-slate-100 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-500/50 hover:bg-violet-50"
                  onClick={() => navigate('/reports')}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 transition-colors group-hover:bg-violet-200">
                    <Download className="h-5 w-5 text-violet-600" />
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
