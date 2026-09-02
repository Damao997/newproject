import { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { RankBadge } from '@/components/ui/rank-badge'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useProductBudget } from '@/hooks/api-queries'
import { totalOf } from '../budget-total'
import { ProductBudgetCard } from '../product-budget-card'
import { cn, formatMoneyWan } from '@/lib/utils'
import { getChartSeries } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'
import type { ProductBudgetRow } from '@/types'

interface CategoryBudgetContentProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选） */
  companyCode?: string
}

/** 计算 SVG 圆环扇区 path（0-1 圆周比例，0=12 点方向，顺时针） */
function donutSlicePath(cx: number, cy: number, r: number, start: number, end: number): string {
  const TAU = Math.PI * 2
  const a0 = start * TAU - Math.PI / 2
  const a1 = end * TAU - Math.PI / 2
  const x0 = cx + r * Math.cos(a0)
  const y0 = cy + r * Math.sin(a0)
  const x1 = cx + r * Math.cos(a1)
  const y1 = cy + r * Math.sin(a1)
  const large = end - start > 0.5 ? 1 : 0
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
}

/** KPI 磁贴：左侧 3px 色条 + 标题 + 数值 + 脚注（真实数据派生） */
function StatTile({ label, value, unit, foot, accent, valueClass }: {
  label: string
  value: string
  unit: string
  foot: string
  accent: string
  valueClass?: string
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-2 overflow-hidden rounded-card border border-border bg-card p-5 shadow-antd-1 transition-all duration-200 hover:shadow-antd-2',
        "before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:content-['']",
        accent,
      )}
    >
      <span className="text-body text-muted-foreground">{label}</span>
      <div className={cn('font-num text-2xl font-semibold leading-tight text-foreground', valueClass)}>
        {value}
        <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>
      </div>
      <span className="text-xs text-muted-foreground">{foot}</span>
    </div>
  )
}

/** 达成率色阶：≥75 绿 / 60-75 橙 / <60 红 / null 灰 */
function rateTone(rate: number | null): { bar: string; text: string } {
  if (rate === null) return { bar: 'bg-muted-foreground/40', text: 'text-muted-foreground' }
  if (rate >= 75) return { bar: 'bg-success-500', text: 'text-success-strong' }
  if (rate >= 60) return { bar: 'bg-orange-500', text: 'text-warning-strong' }
  return { bar: 'bg-destructive', text: 'text-destructive' }
}

/** 达成率 Top 排行行：RankBadge + 品类 + 进度条 + 累计金额 + 达成率 */
function RankRow({ rank, row }: { rank: number; row: ProductBudgetRow }) {
  const tone = rateTone(row.income.ytdRate)
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)_120px_88px_64px] items-center gap-2.5 border-b border-dashed border-border py-1.5 last:border-b-0">
      <RankBadge rank={rank} />
      <span className="truncate text-body text-foreground" title={row.category}>{row.category}</span>
      <span className="relative inline-block h-1.5 overflow-hidden rounded-full bg-muted" style={{ width: 120 }}>
        <span
          className={cn('absolute left-0 top-0 h-full rounded-full', tone.bar)}
          style={{ width: `${Math.min(100, Math.max(0, row.income.ytdRate ?? 0))}%` }}
        />
      </span>
      <span className="text-right font-num text-body text-foreground">{formatMoneyWan(row.income.ytdActual)}</span>
      <span className={cn('text-right font-num text-xs', tone.text)}>
        {row.income.ytdRate === null ? '–' : `${row.income.ytdRate.toFixed(1)}%`}
      </span>
    </div>
  )
}

/**
 * 品类预算达成分析页（真实数据：useProductBudget，跟随看板主体/期间筛选）：
 * - 顶部 4 个 KPI 磁贴：品类数 / 收入年度预算 / 收入累计实际 / 收入累计达成率（Σ口径）；
 * - 左：品类年度预算占比圆环（真实预算额）；右：累计达成率 Top10 排行；
 * - 底部：品类预算达成明细表（复用 ProductBudgetCard：月度/累计口径联动 + 预警灯 + 同比）。
 */
export function CategoryBudgetContent({ period, companyCode }: CategoryBudgetContentProps) {
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const { data, isLoading, isError, refetch } = useProductBudget({ period, companyCode })
  const rows = useMemo(() => data?.rows ?? [], [data])
  const total = useMemo(() => totalOf(rows), [rows])
  const ranked = useMemo(
    () =>
      [...rows]
        .sort((a, b) => (b.income.ytdRate ?? -1) - (a.income.ytdRate ?? -1))
        .slice(0, 10)
        .map((row, i) => ({ rank: i + 1, row })),
    [rows],
  )
  const palette = useMemo(() => getChartSeries(sidebarStyle), [sidebarStyle])

  // 品类年度预算占比（真实预算额；0 预算品类不进圆环）
  const pieSlices = useMemo(() => {
    const positive = rows.filter((r) => r.income.budget > 0).sort((a, b) => b.income.budget - a.income.budget)
    const sum = positive.reduce((s, r) => s + r.income.budget, 0) || 1
    let cursor = 0
    return positive.map((r, i) => {
      const start = cursor
      const end = cursor + r.income.budget / sum
      cursor = end
      return { name: r.category, value: r.income.budget, color: palette[i % palette.length], start, end }
    })
  }, [rows, palette])
  const pieTotal = pieSlices.reduce((s, x) => s + x.value, 0)

  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-[108px] rounded-card" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="skeleton h-[280px] rounded-card" />
          <div className="skeleton h-[280px] rounded-card" />
        </div>
        <div className="skeleton h-[240px] rounded-card" />
      </div>
    )
  }

  if (isError && rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <p className="text-sm font-medium text-foreground">品类预算数据加载失败</p>
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
        title="暂无品类预算数据"
        description={data?.degraded ? '当前主体数据权限已降级且无品类数据，请调整看板筛选后重试' : '配置品类映射与预算并导入经营数据后，将按收入/毛利品类展示预算达成情况'}
      />
    )
  }

  return (
    <div className="animate-fade-in space-y-4">
      {/* 权限降级提示：请求主体被替换为实际生效主体 */}
      {data?.degraded && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-4 py-2 text-sm text-warning-strong">
          请求主体已按数据权限降级为「{data.companyName ?? '默认主体'}」口径
        </div>
      )}

      {/* 顶部 4 个 KPI 磁贴（Σ口径，真实派生） */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="品类数" value={String(rows.length)} unit="个" foot="已配置品类映射" accent="before:bg-blue-8" />
        <StatTile label="收入年度预算" value={formatMoneyWan(total.income.budget)} unit="万" foot="全部品类合计" accent="before:bg-orange-500" />
        <StatTile label="收入累计实际" value={formatMoneyWan(total.income.ytdActual)} unit="万" foot={period ? `截至 ${period}` : '财年累计'} accent="before:bg-chart-5" />
        <StatTile
          label="收入累计达成率"
          value={total.income.ytdRate === null ? '–' : total.income.ytdRate.toFixed(1)}
          unit={total.income.ytdRate === null ? '' : '%'}
          foot="Σ累计实际 ÷ Σ年度预算"
          accent="before:bg-success-500"
          valueClass={rateTone(total.income.ytdRate).text}
        />
      </div>

      {/* 左：品类年度预算占比圆环 + 右：累计达成率 Top10 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border border-border shadow-antd-1">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">
                品类年度预算占比
                <span className="ml-2 text-xs font-normal text-muted-foreground">{pieSlices.length} 个品类</span>
              </h3>
            </div>
            {pieTotal <= 0 ? (
              <EmptyState compact className="py-10" title="暂无预算额" description="未配置品类年度预算，无法展示占比" />
            ) : (
              <div className="flex items-center gap-5">
                <svg viewBox="0 0 100 100" className="h-[200px] w-[200px] shrink-0" aria-label="品类预算占比饼图">
                  <circle cx={50} cy={50} r={40} fill="hsl(var(--muted))" />
                  {pieSlices.map((s) =>
                    s.end - s.start <= 0 ? null : (
                      <path key={s.name} d={donutSlicePath(50, 50, 40, s.start, s.end)} fill={s.color} />
                    ),
                  )}
                  <circle cx={50} cy={50} r={22} fill="hsl(var(--card))" />
                  <text x={50} y={46} textAnchor="middle" fontSize={8} fill="hsl(var(--muted-foreground))">
                    预算总额
                  </text>
                  <text x={50} y={58} textAnchor="middle" fontSize={10} fontWeight={600} fill="hsl(var(--foreground))">
                    {formatMoneyWan(pieTotal)}
                  </text>
                </svg>
                <div className="flex-1 space-y-1.5 text-body">
                  {pieSlices.map((s) => (
                    <div key={s.name} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} aria-hidden />
                      <span className="flex-1 truncate text-foreground" title={s.name}>{s.name}</span>
                      <span className="font-num shrink-0 text-muted-foreground">
                        {formatMoneyWan(s.value)}万 · {((s.value / pieTotal) * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border shadow-antd-1">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-foreground">
                累计达成率 Top10
                <span className="ml-2 text-xs font-normal text-muted-foreground">收入口径 · 排名 / 金额 / 达成率</span>
              </h3>
            </div>
            {ranked.length === 0 ? (
              <EmptyState compact className="py-10" title="暂无排行数据" />
            ) : (
              <div className="flex flex-col">
                {ranked.map(({ rank, row }) => (
                  <RankRow key={row.category} rank={rank} row={row} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 品类预算达成明细表（复用看板同源卡片：月度/累计切换 + 预警灯 + 同比） */}
      <Card className="border border-border shadow-antd-1">
        <CardContent className="px-5 py-5">
          <div className="mb-3 flex items-baseline gap-2">
            <h3 className="text-base font-semibold text-foreground">品类预算 vs 实际明细</h3>
            <span className="text-xs text-muted-foreground">品类 / 预算 / 金额 / 达成率 / 预警 / 同比 · 单位：万元</span>
          </div>
          <ProductBudgetCard period={period} companyCode={companyCode} />
        </CardContent>
      </Card>
    </div>
  )
}
