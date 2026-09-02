import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useExpenseAnalysis } from '@/hooks/api-queries'
import { totalMetrics } from '../budget-total'
import { ExpenseAnalysisCard } from '../expense-analysis-card'
import { cn, formatMoneyWan } from '@/lib/utils'
import { getChartSeries } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'

interface ExpenseContentProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选） */
  companyCode?: string
}

/** 圆环口径：本月金额 / 累计金额（费用结构占比跟随切换） */
type AmountMode = 'month' | 'ytd'

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

/** KPI 磁贴：左侧 3px 色条 + 标题 + 数值 + 脚注（Σ口径，真实派生） */
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

/** 同比 chip：费用类红涨绿跌（数值越大越警示），持平灰 */
function yoyText(v: number): { text: string; cls: string } {
  if (v === 0) return { text: '→ 持平', cls: 'text-muted-foreground' }
  return v > 0
    ? { text: `↑ ${Math.abs(v * 100).toFixed(1)}%`, cls: 'text-finance-red' }
    : { text: `↓ ${Math.abs(v * 100).toFixed(1)}%`, cls: 'text-finance-green' }
}

/**
 * 运营费用分析页（真实数据：useExpenseAnalysis，跟随看板主体/期间筛选）：
 * - 顶部 4 个 KPI 磁贴：本月费用合计（含同比 chip）/ 累计费用合计（含财年同比 chip）/ 累计预算使用率 / 超支科目数；
 * - 费用结构占比圆环：月度/累计口径切换，按金额降序取 Top5 + 「其他」合并（真实科目金额）；
 * - 底部：运营费用明细表（复用 ExpenseAnalysisCard：月度 6 列 + 累计 6 列 + 预警红绿灯）。
 */
export function ExpenseContent({ period, companyCode }: ExpenseContentProps) {
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const [amountMode, setAmountMode] = useState<AmountMode>('month')
  const { data, isLoading, isError, refetch } = useExpenseAnalysis({ period, companyCode })
  const rows = useMemo(() => data?.rows ?? [], [data])
  const total = useMemo(() => totalMetrics(rows), [rows])
  const overBudgetCount = rows.filter((r) => (r.monthRate ?? 0) > 100).length

  // 费用结构占比：按当前口径金额降序 Top5 + 其余合并「其他」
  const slices = useMemo(() => {
    const palette = getChartSeries(sidebarStyle)
    const key = amountMode === 'month' ? 'monthActual' : 'ytdActual'
    const positive = [...rows].filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key])
    const list = positive.slice(0, 5).map((r, i) => ({
      name: r.name,
      value: r[key],
      color: palette[i % palette.length],
    }))
    const rest = positive.slice(5).reduce((s, r) => s + r[key], 0)
    if (rest > 0) list.push({ name: '其他费用', value: rest, color: palette[list.length % palette.length] })
    return list
  }, [rows, amountMode, sidebarStyle])
  const pieTotal = slices.reduce((s, x) => s + x.value, 0)
  const segments = useMemo(() => {
    const sum = pieTotal || 1
    return slices.reduce<Array<{ slice: (typeof slices)[number]; start: number; end: number }>>((acc, s) => {
      const start = acc.length === 0 ? 0 : acc[acc.length - 1].end
      const end = start + s.value / sum
      acc.push({ slice: s, start, end })
      return acc
    }, [])
  }, [slices, pieTotal])

  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-[108px] rounded-card" />
          ))}
        </div>
        <div className="skeleton h-[280px] rounded-card" />
        <div className="skeleton h-[260px] rounded-card" />
      </div>
    )
  }

  if (isError && rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <p className="text-sm font-medium text-foreground">运营费用数据加载失败</p>
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
        title="暂无运营费用数据"
        description={data?.degraded ? '当前主体数据权限已降级且无费用数据，请调整看板筛选后重试' : '配置运营费用映射并导入经营数据后，将按映射科目展示费用使用情况'}
      />
    )
  }

  const monthYoy = yoyText(total.monthYoy)
  const ytdYoy = yoyText(total.ytdYoy)

  return (
    <div className="animate-fade-in space-y-4">
      {/* 权限降级提示 */}
      {data?.degraded && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-4 py-2 text-sm text-warning-strong">
          请求主体已按数据权限降级为「{data.companyName ?? '默认主体'}」口径
        </div>
      )}

      {/* 顶部 4 个 KPI 磁贴（Σ口径，真实派生） */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="本月费用合计"
          value={formatMoneyWan(total.monthActual)}
          unit="万"
          foot={period ? `${period} 当月` : '当月'}
          accent="before:bg-orange-500"
        />
        <StatTile
          label="累计费用合计"
          value={formatMoneyWan(total.ytdActual)}
          unit="万"
          foot={period ? `截至 ${period} 财年累计` : '财年累计'}
          accent="before:bg-blue-8"
        />
        <StatTile
          label="累计预算使用率"
          value={total.ytdRate === null ? '–' : total.ytdRate.toFixed(1)}
          unit={total.ytdRate === null ? '' : '%'}
          foot="Σ累计金额 ÷ Σ年度预算"
          accent="before:bg-success-500"
          valueClass={total.ytdRate !== null && total.ytdRate > 100 ? 'text-destructive' : undefined}
        />
        <StatTile
          label="超支科目数"
          value={String(overBudgetCount)}
          unit="个"
          foot="当月使用率 > 100%"
          accent={overBudgetCount > 0 ? 'before:bg-destructive' : 'before:bg-success-500'}
          valueClass={overBudgetCount > 0 ? 'text-orange-600' : undefined}
        />
      </div>

      {/* 费用结构占比（月度/累计口径切换） */}
      <Card className="border border-border shadow-antd-1">
        <CardContent className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-foreground">
              费用结构占比
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                按映射科目金额 Top5 + 其他 · {amountMode === 'month' ? '本月口径' : '财年累计口径'}
              </span>
            </h3>
            <Tabs value={amountMode} onValueChange={(v) => setAmountMode(v as AmountMode)}>
              <TabsList variant="segmented">
                <TabsTrigger value="month">月度</TabsTrigger>
                <TabsTrigger value="ytd">累计</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {pieTotal <= 0 ? (
            <EmptyState compact className="py-10" title="暂无费用金额" description="当前口径下各科目金额均为 0" />
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <svg viewBox="0 0 100 100" className="h-[200px] w-[200px] shrink-0" aria-label="费用结构占比饼图">
                <circle cx={50} cy={50} r={40} fill="hsl(var(--muted))" />
                {segments.map(({ slice, start, end }) =>
                  end - start <= 0 ? null : (
                    <path key={slice.name} d={donutSlicePath(50, 50, 40, start, end)} fill={slice.color} />
                  ),
                )}
                <circle cx={50} cy={50} r={22} fill="hsl(var(--card))" />
                <text x={50} y={46} textAnchor="middle" fontSize={8} fill="hsl(var(--muted-foreground))">
                  费用合计
                </text>
                <text x={50} y={58} textAnchor="middle" fontSize={10} fontWeight={600} fill="hsl(var(--foreground))">
                  {formatMoneyWan(pieTotal)}
                </text>
              </svg>
              <div className="min-w-[220px] flex-1 space-y-1.5 text-body">
                {slices.map((s) => (
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

      {/* 同比摘要条（Σ口径重算，与明细表合计行同源） */}
      <Card className="border border-border shadow-antd-1">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-4 text-sm">
          <span className="text-muted-foreground">
            本月同比：
            <span className={cn('font-num font-semibold', monthYoy.cls)}>{monthYoy.text}</span>
          </span>
          <span className="text-muted-foreground">
            财年累计同比：
            <span className={cn('font-num font-semibold', ytdYoy.cls)}>{ytdYoy.text}</span>
          </span>
          <span className="text-muted-foreground">
            本月预算：
            <span className="font-num font-semibold text-foreground">{formatMoneyWan(total.monthBudget ?? total.budget / 12)}万</span>
          </span>
        </CardContent>
      </Card>

      {/* 运营费用明细表（月度 6 列 + 累计 6 列 + 预警红绿灯） */}
      <Card className="border border-border shadow-antd-1">
        <CardContent className="px-5 py-5">
          <div className="mb-3 flex items-baseline gap-2">
            <h3 className="text-base font-semibold text-foreground">运营费用明细</h3>
            <span className="text-xs text-muted-foreground">月度完成情况 / 财年累计完成情况 · 单位：万元</span>
          </div>
          <ExpenseAnalysisCard period={period} companyCode={companyCode} />
        </CardContent>
      </Card>
    </div>
  )
}
