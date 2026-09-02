import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/skeleton-blocks'
import { KeyMetricsStatTiles, type StatTileItem } from './key-metrics-stat-tiles'
import { KeyMetricsHeatmap, type HeatmapRow, type HeatmapLevel } from './key-metrics-heatmap'
import { KeyMetricsTrendChart, type TrendPoint } from './key-metrics-trend-chart'
import { useKeyMetrics, useDashboardTrend } from '@/hooks/api-queries'
import { cn, formatMoneyWan } from '@/lib/utils'
import type { KeyMetricsGroup } from '@/types'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// 对外保持数据契约：原本的 props / 类型仍可被父级 / 测试引用
export type { KeyMetricsGroup, KeyMetricsRow, KeyMetricsResponse } from '@/types'

export interface KeyMetricsTableProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
}

/** 明细行：科目 / 本期 / 同比 / 环比 / 趋势 / 状态 */
interface DetailRow {
  key: string
  label: string
  actual: number
  yoy: number
  mom: number
  trendPct: number
  trendTone: 'orange' | 'green' | 'blue' | 'red'
  status: { text: string; tone: 'orange' | 'blue' | 'green' | 'red' }
}

/** 明细行固定科目集（与后端 getKeyMetrics 损益板块行 key 一一对应；现金板块四行不进明细表） */
const DETAIL_KEYS: { key: string; label: string }[] = [
  { key: 'income', label: '营业收入' },
  { key: 'profit', label: '毛利' },
  { key: 'expense', label: '运营费用' },
  { key: 'finance', label: '财务费用' },
  { key: 'netProfit', label: '净利润' },
]

/** TrendData.period（YYYY-MM）→ 「N月」 */
function monthLabelOf(period: string): string {
  const m = Number(period.slice(5, 7))
  return m >= 1 && m <= 12 ? `${m}月` : period
}

/** 月度序列 → 0~1 sparkline（null/负值按 0 处理，最大值归一） */
function toSpark(series: (number | null)[]): number[] {
  const vals = series.map((v) => (v == null ? 0 : Math.max(v, 0)))
  const max = Math.max(...vals, 1)
  return vals.map((v) => v / max)
}

const fmtWan = (v: number) => `${v.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} 万`
const fmtPct = (v: number) => `${v.toFixed(1)}%`

/** 热力行构建：单行内 min-max 归一化为 1~5 级（null=0 级无数据，悬浮提示「待录入」） */
function buildHeatmapRow(label: string, series: (number | null)[], fmt: (v: number) => string, labels: string[]): HeatmapRow {
  const nums = series.filter((v): v is number => v != null)
  const min = nums.length ? Math.min(...nums) : 0
  const max = nums.length ? Math.max(...nums) : 0
  const span = max - min
  return {
    label,
    cells: series.map((v, i): { level: HeatmapLevel; tip: string } => {
      if (v == null) return { level: 0, tip: `${labels[i]} 待录入` }
      // 全行等值时取中档，避免 0/0
      const level = span === 0 ? 3 : (1 + Math.min(4, Math.floor(((v - min) / span) * 4.999))) as HeatmapLevel
      return { level, tip: `${labels[i]} ${fmt(v)}` }
    }),
  }
}

/* ───────── 派生：明细行（真实 API 数据驱动） ───────── */
function detailFromGroup(key: string, label: string, g: KeyMetricsGroup, maxActual: number): DetailRow {
  const yoyPct = g.monthYoy * 100
  const momPct = g.monthMom * 100
  // 趋势条按本期实际 / 明细行最大本期实际归一化（同表内相对强度）
  const trendPct = Math.max(8, Math.min(100, (g.monthActual / maxActual) * 100))
  const trendTone: DetailRow['trendTone'] = yoyPct > 5 ? 'green' : yoyPct < -5 ? 'orange' : 'blue'
  const status = yoyPct > 10
    ? { text: 'Top1', tone: 'orange' as const }
    : yoyPct > 0
      ? { text: '增长', tone: 'green' as const }
      : momPct < -1
        ? { text: '需关注', tone: 'red' as const }
        : { text: '正常', tone: 'blue' as const }
  return { key, label, actual: g.monthActual, yoy: yoyPct, mom: momPct, trendPct, trendTone, status }
}

/* ───────── 表格单元格 ───────── */
function TrendCell({ pct, tone }: { pct: number; tone: DetailRow['trendTone'] }) {
  const fillCls =
    tone === 'orange' ? 'bg-orange-500'
    : tone === 'green' ? 'bg-success-500'
    : tone === 'red' ? 'bg-destructive-500'
    : 'bg-chart-2'
  return (
    <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-muted">
      <div className={cn('absolute inset-y-0 left-0 rounded-full', fillCls)} style={{ width: `${pct}%` }} />
    </div>
  )
}

function DeltaCell({ value, unit = '%', neutral = false }: { value: number; unit?: string; neutral?: boolean }) {
  if (Math.abs(value) < 0.05) {
    return <span className="font-num text-muted-foreground">→ 0.0{unit}</span>
  }
  const isUp = value > 0
  const arrow = isUp ? '↑' : '↓'
  // 同比列红涨绿跌（A 股惯例）；环比列同色
  const colorCls = neutral ? 'text-finance-red' : isUp ? 'text-finance-red' : 'text-finance-green'
  return (
    <span className={cn('font-num', colorCls)}>
      {arrow} {Math.abs(value).toFixed(1)}{unit}
    </span>
  )
}

/* ───────── 主体组件 ───────── */
/**
 * 壹品慧关键指标表（全真实数据）：
 * - 顶部 KPI 磁贴 + 12 月 sparkline：本期值/同比取 GET /dashboard/analysis/key-metrics，
 *   月度序列取 GET /dashboard/trend（授权范围全主体口径，与看板趋势卡一致）；
 * - 双栏：5×12 月度热力（收入/毛利/毛利率/净利润/净利率，单行 min-max 强度归一）+ 12 月收入/毛利双折线；
 * - 底部关键指标明细表（科目 / 本期 / 同比 / 环比 / 12 月趋势 / 状态），行数据全部来自 key-metrics 响应派生；
 * - 仍可由父级通过 period/companyCode 控制口径，刷新逻辑保留 isError/重试。
 */
export function KeyMetricsTable({ period, companyCode }: KeyMetricsTableProps) {
  const { data, isError, isLoading, isFetching, refetch } = useKeyMetrics({ period, companyCode })
  const { data: trendRows } = useDashboardTrend({ months: 12 })
  const navigate = useNavigate()

  const rows = data?.rows ?? []
  const byKey = (k: string) => rows.find((r) => r.key === k)
  const trend = trendRows ?? []
  const colLabels = useMemo(() => trend.map((t) => monthLabelOf(t.period)), [trend])

  // 财年月度序列（null=该月无数据）
  const revenueSeries = useMemo(() => trend.map((t) => t.revenueActual), [trend])
  const revenueYtdSeries = useMemo(() => trend.map((t) => t.revenueYtdActual), [trend])
  const profitSeries = useMemo(() => trend.map((t) => t.profitActual), [trend])
  const profitYtdSeries = useMemo(() => trend.map((t) => t.profitYtdActual), [trend])
  const netProfitSeries = useMemo(() => trend.map((t) => t.netProfitActual), [trend])
  // 预算完成率月度序列（无预算月为 null；预算为 0 时不计算比率）
  const rateSeries = useMemo(
    () => trend.map((t) => (t.revenueYtdActual != null && t.revenueYtdBudget ? (t.revenueYtdActual / t.revenueYtdBudget) * 100 : null)),
    [trend],
  )
  const grossMarginSeries = useMemo(
    () => trend.map((t) => (t.revenueActual && t.profitActual != null ? (t.profitActual / t.revenueActual) * 100 : null)),
    [trend],
  )
  const netMarginSeries = useMemo(
    () => trend.map((t) => (t.revenueActual && t.netProfitActual != null ? (t.netProfitActual / t.revenueActual) * 100 : null)),
    [trend],
  )

  /* 顶部 5 列 KPI 磁贴（key-metrics 行 + trend 月度序列派生；行缺失时对应磁贴不渲染） */
  const tiles = useMemo<StatTileItem[]>(() => {
    const income = byKey('income')?.values
    const profit = byKey('profit')?.values
    const netProfit = byKey('netProfit')?.values
    const out: StatTileItem[] = []
    if (income) {
      out.push({ rank: 1, label: '本月营业收入', iconText: '¥', value: income.monthActual, unit: '万', deltaPct: income.monthYoy * 100, chipColor: 'down', spark: toSpark(revenueSeries) })
      out.push({ label: '本年累计收入', iconText: '收', value: income.ytdActual, unit: '万', deltaPct: income.ytdYoy * 100, chipColor: 'down', spark: toSpark(revenueYtdSeries) })
    }
    if (profit) out.push({ rank: 2, label: '累计毛利', iconText: '毛', value: profit.ytdActual, unit: '万', deltaPct: profit.ytdYoy * 100, chipColor: 'down', spark: toSpark(profitYtdSeries) })
    if (netProfit) {
      out.push({ label: '本月净利润', iconText: '利', value: netProfit.monthActual, unit: '万', deltaPct: netProfit.monthYoy * 100, chipColor: netProfit.monthYoy > 0 ? 'down' : netProfit.monthYoy < 0 ? 'up' : 'flat', spark: toSpark(netProfitSeries) })
    }
    if (income?.annualRate != null) {
      out.push({ label: '年度预算完成率', iconText: '%', value: income.annualRate, unit: '%', deltaPct: 0, chipArrow: '→', chipColor: 'flat', deltaSuffix: '年度完成率', spark: toSpark(rateSeries) })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, revenueSeries, revenueYtdSeries, profitYtdSeries, netProfitSeries, rateSeries])

  /* 5×12 月度热力（全部主体口径的月度序列；行内 min-max 强度归一） */
  const heatmapRows = useMemo<HeatmapRow[]>(() => {
    if (trend.length === 0) return []
    return [
      buildHeatmapRow('营业收入', revenueSeries, fmtWan, colLabels),
      buildHeatmapRow('毛利', profitSeries, fmtWan, colLabels),
      buildHeatmapRow('毛利率', grossMarginSeries, fmtPct, colLabels),
      buildHeatmapRow('净利润', netProfitSeries, fmtWan, colLabels),
      buildHeatmapRow('净利率', netMarginSeries, fmtPct, colLabels),
    ]
  }, [trend, colLabels, revenueSeries, profitSeries, grossMarginSeries, netProfitSeries])

  /* 月度双折线（收入/毛利） */
  const trendData = useMemo<TrendPoint[]>(
    () => trend.map((t) => ({ label: monthLabelOf(t.period), v1: t.revenueActual ?? 0, v2: t.profitActual ?? 0 })),
    [trend],
  )
  const trendScale = useMemo(() => {
    if (trendData.length < 2) return null
    const maxY = Math.max(...trendData.map((d) => Math.max(d.v1, d.v2)), 1) * 1.1
    const mag = 10 ** Math.floor(Math.log10(maxY))
    const yMax = Math.ceil(maxY / mag) * mag
    return { yMax, ticks: [1, 2, 3, 4, 5].map((i) => Math.round((yMax * i) / 5)) }
  }, [trendData])

  /* 底部明细行：仅由 key-metrics 真实行派生（行缺失时该行不渲染，不再 mock 补位） */
  const detailRows = useMemo<DetailRow[]>(() => {
    if (rows.length === 0) return []
    const maxActual = Math.max(...DETAIL_KEYS.map((k) => byKey(k.key)?.values.monthActual ?? 0), 1)
    return DETAIL_KEYS.flatMap(({ key, label }) => {
      const g = byKey(key)?.values
      return g ? [detailFromGroup(key, label, g, maxActual)] : []
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  return (
    <div className="flex min-h-0 flex-col space-y-3">
      {isError && !data ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <p className="text-sm font-medium text-foreground">关键指标数据加载失败</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重试
          </Button>
        </div>
      ) : (
        <>
          {tiles.length > 0 && <KeyMetricsStatTiles items={tiles} />}

          {(heatmapRows.length > 0 || trendScale) && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
              {heatmapRows.length > 0 && (
                <div
                  className={cn(
                    'rounded-lg border border-border bg-card p-5 transition-opacity duration-200',
                    isFetching && 'opacity-60',
                  )}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-foreground">月度变化热力</h3>
                    <span className="text-xs text-muted-foreground">5 个核心指标 × 12 个月 · 色深=指标强度</span>
                  </div>
                  <KeyMetricsHeatmap rows={heatmapRows} colLabels={colLabels} />
                </div>
              )}
              {trendScale && (
                <div
                  className={cn(
                    'rounded-lg border border-border bg-card p-5 transition-opacity duration-200',
                    isFetching && 'opacity-60',
                  )}
                >
                  <h3 className="mb-2 text-base font-semibold text-foreground">月度趋势</h3>
                  <KeyMetricsTrendChart data={trendData} yMax={trendScale.yMax} ticks={trendScale.ticks} />
                </div>
              )}
            </div>
          )}

          <DetailTable rows={detailRows} onJumpOperating={() => navigate('/dashboard/analysis/expense')} />
        </>
      )}
      {isLoading && detailRows.length === 0 ? (
        <TableSkeleton rows={5} columns={6} />
      ) : !isError && detailRows.length === 0 ? (
        <EmptyState title="暂无经营数据" description="当前主体或期间暂无数据，请调整筛选后重试" />
      ) : null}
    </div>
  )
}

/* ───────── 关键指标明细表 ───────── */
function DetailTable({ rows, onJumpOperating }: { rows: DetailRow[]; onJumpOperating: () => void }) {
  if (rows.length === 0) return null
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">关键指标明细</h3>
        <span className="text-xs uppercase tracking-wider text-muted-foreground">科目 / 本期 / 同比 / 环比 / 趋势</span>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table-report">
          <thead>
            <tr>
              <th className="w-[16em] text-left">科目</th>
              <th className="text-right">本期</th>
              <th className="text-right">同比</th>
              <th className="text-right">环比</th>
              <th className="text-left">12月趋势</th>
              <th className="text-left">状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="text-left text-foreground">
                  {r.key === 'expense' || r.key === 'finance' ? (
                    <button
                      type="button"
                      onClick={onJumpOperating}
                      className="hover:text-primary"
                      title="跳转运营费用明细表"
                    >
                      {r.label}
                    </button>
                  ) : (
                    r.label
                  )}
                </td>
                <td className="text-right font-num tabular-nums text-foreground">
                  {formatMoneyWan(r.actual)} 万
                </td>
                <td className="text-right">
                  <DeltaCell value={r.yoy} />
                </td>
                <td className="text-right">
                  <DeltaCell value={r.mom} />
                </td>
                <td>
                  <TrendCell pct={r.trendPct} tone={r.trendTone} />
                </td>
                <td>
                  <Pill tone={r.status.tone}>{r.status.text}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
