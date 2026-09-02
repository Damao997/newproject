import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react'
import { useExpenseAnalysis } from '@/hooks/api-queries'
import { formatMoneyWan, cn } from '@/lib/utils'
import { getChartSeries } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'

interface ExpenseStructureCardProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
}

/**
 * 计算 SVG 圆环扇区 path。cx/cy 圆心；r 半径；start/end 角度（0-1 圆周比例，0=12 点方向，顺时针）。
 */
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

/**
 * 费用结构卡（看板右侧栏）：数据来自运营费用分析接口（useExpenseAnalysis，跟随看板主体/期间筛选），
 * 按本月金额降序取 Top5 费用科目 + 其余合并为「其他」，圆环展示费用结构占比；
 * 详情跳转经营分析 · 运营费用子页。
 */
export function ExpenseStructureCard({ period, companyCode }: ExpenseStructureCardProps) {
  const navigate = useNavigate()
  // 分类色板跟随当前侧边栏风格（与应收/存货图卡同源）
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const { data, isLoading, isError, refetch } = useExpenseAnalysis({ period, companyCode })
  const rows = data?.rows ?? []

  const slices = useMemo(() => {
    const palette = getChartSeries(sidebarStyle)
    const positive = rows.filter((r) => r.monthActual > 0).sort((a, b) => b.monthActual - a.monthActual)
    const list = positive.slice(0, 5).map((r, i) => ({
      name: r.name,
      value: r.monthActual,
      color: palette[i % palette.length],
    }))
    const rest = positive.slice(5).reduce((s, r) => s + r.monthActual, 0)
    if (rest > 0) list.push({ name: '其他费用', value: rest, color: palette[list.length % palette.length] })
    return list
  }, [rows, sidebarStyle])
  const total = slices.reduce((s, x) => s + x.value, 0)

  // 圆心 + 半径（外圈 40 / 内圈 22，viewBox 100x100）；预计算扇区角度避免渲染期突变
  const segments = useMemo(() => {
    const sum = total || 1
    return slices.reduce<Array<{ slice: (typeof slices)[number]; start: number; end: number }>>((acc, s) => {
      const start = acc.length === 0 ? 0 : acc[acc.length - 1].end
      const end = start + s.value / sum
      acc.push({ slice: s, start, end })
      return acc
    }, [])
  }, [slices, total])

  return (
    <Card className="animate-fade-in border border-border shadow-sm" style={{ animationDelay: '120ms' }}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-5">
        <div>
          <CardTitle className="text-base font-semibold">费用结构</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {period ? `期间 ${period} · ` : ''}本月费用 Top5 科目
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-primary"
          onClick={() => navigate('/dashboard/analysis/expense')}
        >
          详情
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        {isLoading ? (
          <div className="flex items-center gap-5">
            <div className="skeleton h-[140px] w-[140px] shrink-0 rounded-full" />
            <div className="flex-1 space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-3.5 w-full rounded" />
              ))}
            </div>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-muted-foreground">费用数据加载失败</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3 w-3" />
              重试
            </Button>
          </div>
        ) : total <= 0 ? (
          <EmptyState
            compact
            className="py-10"
            title="暂无费用数据"
            description="配置运营费用映射并导入经营数据后，将展示当月费用结构"
          />
        ) : (
          <div className="flex items-center gap-5">
            <svg viewBox="0 0 100 100" className="h-[140px] w-[140px] shrink-0" aria-label="费用结构饼图">
              <circle cx={50} cy={50} r={40} fill="hsl(var(--muted))" />
              {segments.map(({ slice, start, end }) =>
                end - start <= 0 ? null : (
                  <path key={slice.name} d={donutSlicePath(50, 50, 40, start, end)} fill={slice.color} />
                ),
              )}
              <circle cx={50} cy={50} r={22} fill="hsl(var(--card))" />
              <text x={50} y={48} textAnchor="middle" fontSize={8} fill="hsl(var(--muted-foreground))">
                费用合计
              </text>
              <text x={50} y={60} textAnchor="middle" fontSize={11} fontWeight={600} fill="hsl(var(--foreground))">
                {formatMoneyWan(total)}
              </text>
            </svg>
            <ul className="flex-1 space-y-1.5 text-sm">
              {slices.map((s) => (
                <li key={s.name} className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: s.color }} aria-hidden />
                  <span className="flex-1 truncate text-foreground" title={s.name}>{s.name}</span>
                  <span className="shrink-0 font-num text-xs text-muted-foreground tabular-nums">
                    {formatMoneyWan(s.value)} · {((s.value / total) * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!isLoading && !isError && data?.degraded && (
          <p className={cn('mt-3 text-xs text-warning-strong')}>请求主体已按数据权限降级为「{data.companyName ?? '默认主体'}」口径</p>
        )}
      </CardContent>
    </Card>
  )
}
