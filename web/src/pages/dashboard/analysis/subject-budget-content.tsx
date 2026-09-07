import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { TipLabel } from '@/components/ui/tip-label'
import { useSubjectBudget } from '@/hooks/api-queries'
import { AnalysisPageSkeleton } from '@/components/ui/skeleton-blocks'
import { usePageStore } from '@/stores/pageStateStore'
import { totalOf } from '../budget-total'
import { SubjectBudgetCard } from '../subject-budget-card'
import { cn, formatMoneyWan } from '@/lib/utils'
import { ACHIEVEMENT_RATE_THRESHOLDS } from '@/lib/constants'
import { rateColorClass } from '@/components/charts/kpi-card'
import type { ProductBudgetMetric } from '@/types'

interface SubjectBudgetContentProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选） */
  companyCode?: string
}

/** 达成率环色阶：≥75 绿 / 60-75 橙 / <60 红 / null 灰（阈值消费共享常量，与 kpi-card 红绿灯分档一致） */
function rateColor(rate: number | null): string {
  if (rate === null) return 'hsl(var(--muted-foreground) / 0.4)'
  if (rate >= ACHIEVEMENT_RATE_THRESHOLDS.PASS) return 'hsl(var(--success-500))'
  if (rate >= ACHIEVEMENT_RATE_THRESHOLDS.WARN) return 'hsl(var(--orange-500))'
  return 'hsl(var(--destructive))'
}

/** 主体达成率环（Ring progress）：外环=当前标签页指标的累计达成率（累计实际÷累计预算，月度预算累加口径），中心百分比随指标切换 */
function SubjectRing({ name, code, metric, metricName }: {
  name: string
  code: string
  metric?: ProductBudgetMetric
  metricName: string
}) {
  const R = 40
  const C = 2 * Math.PI * R
  const rate = metric?.ytdCumRate ?? null
  const pct = rate === null ? 0 : Math.min(100, Math.max(0, rate))
  const color = rateColor(rate)
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-border bg-card p-4 shadow-antd-1">
      <div className="w-full truncate text-center text-sm font-medium text-foreground" title={name}>{name}</div>
      <div className="relative h-[120px] w-[120px]">
        <svg viewBox="0 0 100 100" className="h-full w-full" style={{ transform: 'rotate(-90deg)' }} aria-label={`${name} ${metricName}累计达成率`}>
          <circle cx={50} cy={50} r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth={9} />
          <circle
            cx={50}
            cy={50}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={`${(C * pct) / 100} ${C}`}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('font-num text-lg font-semibold', rate === null && 'text-muted-foreground')}>
            {rate === null ? '–' : `${rate.toFixed(1)}%`}
          </span>
          <span className="text-[10px] text-muted-foreground">{metricName}达成</span>
        </div>
      </div>
      <span className="font-num text-[10px] text-muted-foreground">{code}</span>
    </div>
  )
}

/** 主体达成率环网格的指标标签页键：收入/毛利/净利润 */
type MetricKey = 'income' | 'profit' | 'netProfit'
const METRIC_TABS: { key: MetricKey; name: string }[] = [
  { key: 'income', name: '收入' },
  { key: 'profit', name: '毛利' },
  { key: 'netProfit', name: '净利' },
]

/**
 * 公司预算达成页（真实数据：useSubjectBudget，跟随看板主体/期间筛选）：
 * - 单体/汇总 mode 跟随看板主体筛选（summary:X → summary 展开成员明细，其余 single）；
 * - 顶部 4 个 KPI 磁贴：主体数 / 收入年度预算 / 收入累计实际 / 整体累计达成率（Σ口径）；
 * - 主体达成率 Ring 网格（每主体一环，指标随收入/毛利/净利润标签页切换，均为累计预算口径）；
 * - 底部：主体预算明细表（复用 SubjectBudgetCard：月度/累计口径联动 + 收入/毛利/净利润三组）。
 */
export function SubjectBudgetContent({ period, companyCode }: SubjectBudgetContentProps) {
  // 环网格指标标签页（收入/毛利/净利润），默认收入
  const [metricKey, setMetricKey] = useState<MetricKey>('income')
  const metricName = METRIC_TABS.find((t) => t.key === metricKey)?.name ?? '收入'
  // 汇总主体筛选时以 summary 口径请求（后端展开成员公司明细行），其余 single
  const dim = usePageStore((s) => s.dashboard.dim)
  const mode: 'single' | 'summary' = dim.startsWith('summary:') ? 'summary' : 'single'
  const { data, isLoading, isError, refetch } = useSubjectBudget({ period, mode, companyCode })
  const rows = useMemo(() => data?.rows ?? [], [data])
  const total = useMemo(() => totalOf(rows), [rows])

  if (isLoading) return <AnalysisPageSkeleton blocks={[220, 240]} />

  if (isError && rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <p className="text-sm font-medium text-foreground">主体预算数据加载失败</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          重试
        </Button>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="暂无主体预算数据"
        description="导入并激活经营数据、配置主体年度预算后，将按主体展示收入/毛利/净利润预算达成情况"
      />
    )
  }

  return (
    <div className="animate-fade-in space-y-4">
      {/* 顶部 4 个 KPI 磁贴（Σ口径，真实派生） */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(() => {
          const tiles: { label: string; value: string; unit: string; foot: string; accent: string }[] = [
            { label: '主体数', value: String(rows.length), unit: mode === 'summary' ? '个' : '家', foot: mode === 'summary' ? '汇总层主体树形明细' : '单体公司口径', accent: 'before:bg-info-500' },
            { label: '收入年度预算', value: formatMoneyWan(total.income.budget), unit: '万', foot: '全部主体合计', accent: 'before:bg-blue-8' },
            { label: '收入累计实际', value: formatMoneyWan(total.income.ytdActual), unit: '万', foot: period ? `截至 ${period}` : '财年累计', accent: 'before:bg-success-500' },
          ]
          return (
            <>
              {tiles.map((t) => (
                <div
                  key={t.label}
                  className={cn(
                    'relative flex flex-col gap-2 overflow-hidden rounded-card border border-border bg-card p-5 shadow-antd-1 transition-all duration-200 hover:shadow-antd-2',
                    "before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:content-['']",
                    t.accent,
                  )}
                >
                  <span className="text-body text-muted-foreground">{t.label}</span>
                  <div className="font-num text-2xl font-semibold leading-tight text-foreground">
                    {t.value}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">{t.unit}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{t.foot}</span>
                </div>
              ))}
              <div className="relative flex flex-col gap-2 overflow-hidden rounded-card border border-border bg-card p-5 shadow-antd-1 before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:bg-orange-500 before:content-['']">
                <span className="text-body text-muted-foreground">整体累计达成率</span>
                <div className={cn('font-num text-2xl font-semibold leading-tight', rateColorClass(total.income.ytdCumRate))}>
                  {total.income.ytdCumRate === null ? '–' : total.income.ytdCumRate.toFixed(1)}
                  {total.income.ytdCumRate !== null && <span className="ml-1 text-sm font-normal text-muted-foreground">%</span>}
                </div>
                <span className="text-xs text-muted-foreground">Σ累计实际 ÷ Σ累计预算（月度预算累加）</span>
              </div>
            </>
          )
        })()}
      </div>

      {/* 主体达成率 Ring 网格（指标随标签页切换） */}
      <Card className="border border-border shadow-antd-1">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-foreground">
              <TipLabel label="主体达成率" tip="累计实际 ÷ 累计预算（月度预算累加）· 环色：≥75 绿 / 60-75 橙 / <60 红 · 无预算灰" />
            </h3>
            <Tabs value={metricKey} onValueChange={(v) => setMetricKey(v as MetricKey)}>
              <TabsList variant="segmented" className="justify-start">
                {METRIC_TABS.map((t) => (
                  <TabsTrigger key={t.key} value={t.key}>{t.name}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {rows.map((r) => (
              <SubjectRing
                key={r.code}
                name={r.name}
                code={r.code}
                metric={r[metricKey]}
                metricName={metricName}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 主体预算明细表（月度/累计口径联动） */}
      <Card className="border border-border shadow-antd-1">
        <CardContent className="px-5 py-5">
          <div className="mb-3 flex items-baseline gap-2">
            <h3 className="text-base font-semibold text-foreground">
              <TipLabel label="主体预算明细" tip="收入 / 毛利 / 净利润 · 月度/累计口径 · 单位：万元" />
            </h3>
          </div>
          <SubjectBudgetCard period={period} companyCode={companyCode} mode={mode} />
        </CardContent>
      </Card>
    </div>
  )
}
