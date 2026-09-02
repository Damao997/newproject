import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react'
import { useCashflowIndicators, type CashflowRow } from '@/hooks/api-queries'
import { cn, formatMoneyWan } from '@/lib/utils'

interface CashFlowContentProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，汇总主体由后端展开成员合并口径） */
  companyCode?: string
}

/** KPI 磁贴 */
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

/** 同比文案：现金流为正向指标，红涨绿跌（A 股习惯），持平灰 */
function yoyChip(v: number): { text: string; cls: string } {
  if (v === 0) return { text: '→ 持平', cls: 'text-muted-foreground' }
  return v > 0
    ? { text: `↑ ${Math.abs(v * 100).toFixed(1)}%`, cls: 'text-finance-red' }
    : { text: `↓ ${Math.abs(v * 100).toFixed(1)}%`, cls: 'text-finance-green' }
}

/** 在科目树中按名称查找行（含跨层查找，取首个命中） */
function findRow(items: CashflowRow[], name: string): CashflowRow | undefined {
  for (const it of items) {
    if (it.name === name) return it
    const hit = it.children ? findRow(it.children, name) : undefined
    if (hit) return hit
  }
  return undefined
}

/** 现金流科目树行 → { current, samePeriod, ytd, samePeriodYtd, yoy, ytdYoy } 安全取值 */
function metricsOf(row: CashflowRow | undefined) {
  return {
    current: row?.current ?? 0,
    samePeriod: row?.samePeriod ?? 0,
    ytd: row?.ytd ?? 0,
    samePeriodYtd: row?.samePeriodYtd ?? 0,
    yoy: row?.yoy ?? 0,
    ytdYoy: row?.ytdYoy ?? 0,
  }
}

/** Σ 流入（经营/投资/筹资 三类「现金流入」行求和） */
function sumRows(rows: (CashflowRow | undefined)[]) {
  return rows.reduce(
    (acc, r) => {
      const m = metricsOf(r)
      return {
        current: acc.current + m.current,
        samePeriod: acc.samePeriod + m.samePeriod,
        ytd: acc.ytd + m.ytd,
        samePeriodYtd: acc.samePeriodYtd + m.samePeriodYtd,
      }
    },
    { current: 0, samePeriod: 0, ytd: 0, samePeriodYtd: 0 },
  )
}

/** 同比（按 Σ 金额重算，|同期| 作分母） */
function yoyOf(cur: number, base: number): number {
  const abs = Math.abs(base)
  return abs ? (cur - base) / abs : 0
}

/**
 * 业务现金流分析页（真实数据：useCashflowIndicators /indicators/cashflow，跟随看板主体/期间筛选）：
 * - 接口为单期间口径（本月/同期/累计/同期累计），无逐月序列，故不虚构 12 月趋势线；
 * - 顶部 4 个 KPI 磁贴：现金流入合计 / 现金流出合计 / 净现金流 / 自由现金流（本月 + 累计，含同比 chip）；
 * - 三大活动对比：经营/投资/筹资净现金流（本月 vs 累计横向条，正负分色）；
 * - 明细表：三大活动 流入/流出/净额 行（本月/同期/同比/累计/同期累计/累计同比）+ 深链指标分析页。
 */
export function CashFlowContent({ period, companyCode }: CashFlowContentProps) {
  const { data, isLoading, isError, refetch } = useCashflowIndicators({ companyCode, period })
  const items = useMemo(() => data?.items ?? [], [data])

  const inflowSum = useMemo(
    () =>
      sumRows([
        findRow(items, '经营活动产生的现金流入'),
        findRow(items, '投资活动产生的现金流入'),
        findRow(items, '筹资活动产生的现金流入'),
      ]),
    [items],
  )
  const outflowSum = useMemo(
    () =>
      sumRows([
        findRow(items, '经营活动产生的现金流出'),
        findRow(items, '投资活动产生的现金流出'),
        findRow(items, '筹资活动产生的现金流出'),
      ]),
    [items],
  )
  const operating = useMemo(() => metricsOf(findRow(items, '经营活动产生的现金流量')), [items])
  const investing = useMemo(() => metricsOf(findRow(items, '投资活动产生的现金流量')), [items])
  const financing = useMemo(() => metricsOf(findRow(items, '筹资活动产生的现金流量')), [items])
  const fcf = useMemo(() => metricsOf(findRow(items, '自由现金流')), [items])

  const hasAny = items.length > 0

  /** 三大活动净额条形：正=绿（净流入）/ 负=红（净流出），按最大绝对值归一 */
  const activityRows = [
    { name: '经营活动', ...operating },
    { name: '投资活动', ...investing },
    { name: '筹资活动', ...financing },
  ]
  const actMax = Math.max(...activityRows.map((r) => Math.max(Math.abs(r.current), Math.abs(r.ytd))), 0)

  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-[108px] rounded-card" />
          ))}
        </div>
        <div className="skeleton h-[220px] rounded-card" />
        <div className="skeleton h-[240px] rounded-card" />
      </div>
    )
  }

  if (isError && !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <p className="text-sm font-medium text-foreground">现金流数据加载失败</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          重试
        </Button>
      </div>
    )
  }

  if (!hasAny) {
    return (
      <EmptyState
        title="暂无现金流数据"
        description="导入并激活现金流量表数据后，将展示流入/流出/净额与三大活动对比"
      />
    )
  }

  const net = {
    current: inflowSum.current - outflowSum.current,
    ytd: inflowSum.ytd - outflowSum.ytd,
  }
  const inYoy = yoyOf(inflowSum.ytd, inflowSum.samePeriodYtd)
  const outYoy = yoyOf(outflowSum.ytd, outflowSum.samePeriodYtd)
  const netYoy = yoyOf(net.ytd, inflowSum.samePeriodYtd - outflowSum.samePeriodYtd)
  const inMonthYoy = yoyOf(inflowSum.current, inflowSum.samePeriod)
  const outMonthYoy = yoyOf(outflowSum.current, outflowSum.samePeriod)

  // 明细行（流入/流出/净额 × 三大活动 + 自由现金流）
  const detailRows: { name: string; indent?: boolean; m: ReturnType<typeof metricsOf> }[] = [
    { name: '经营活动产生的现金流入', indent: true, m: metricsOf(findRow(items, '经营活动产生的现金流入')) },
    { name: '经营活动产生的现金流出', indent: true, m: metricsOf(findRow(items, '经营活动产生的现金流出')) },
    { name: '经营活动产生的现金流量（净额）', m: operating },
    { name: '投资活动产生的现金流入', indent: true, m: metricsOf(findRow(items, '投资活动产生的现金流入')) },
    { name: '投资活动产生的现金流出', indent: true, m: metricsOf(findRow(items, '投资活动产生的现金流出')) },
    { name: '投资活动产生的现金流量（净额）', m: investing },
    { name: '筹资活动产生的现金流入', indent: true, m: metricsOf(findRow(items, '筹资活动产生的现金流入')) },
    { name: '筹资活动产生的现金流出', indent: true, m: metricsOf(findRow(items, '筹资活动产生的现金流出')) },
    { name: '筹资活动产生的现金流量（净额）', m: financing },
    { name: '自由现金流', m: fcf },
  ]

  return (
    <div className="animate-fade-in space-y-4">
      {/* 顶部工具条：口径摘要 + 指标分析深链 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {period ? `期间 ${period} · ` : ''}现金流量表口径 · 本月 / 同期 / 财年累计 · 单位：万元
        </p>
        <Button asChild variant="outline" size="sm" className="h-8 gap-1">
          <Link to="/indicators/cashflow">
            前往现金流指标分析
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {/* KPI 磁贴（真实 Σ 口径 + 同比 chip） */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="现金流入合计"
          value={formatMoneyWan(inflowSum.ytd)}
          unit="万"
          foot={`本月 ${formatMoneyWan(inflowSum.current)}万 · 同比 ${
            inYoy === 0 ? '持平' : `${inYoy > 0 ? '+' : ''}${(inYoy * 100).toFixed(1)}%`
          }`}
          accent="before:bg-info-500"
        />
        <StatTile
          label="现金流出合计"
          value={formatMoneyWan(outflowSum.ytd)}
          unit="万"
          foot={`本月 ${formatMoneyWan(outflowSum.current)}万 · 同比 ${
            outYoy === 0 ? '持平' : `${outYoy > 0 ? '+' : ''}${(outYoy * 100).toFixed(1)}%`
          }`}
          accent="before:bg-blue-8"
        />
        <StatTile
          label="净现金流（累计）"
          value={formatMoneyWan(net.ytd)}
          unit="万"
          foot={`本月 ${formatMoneyWan(net.current)}万 · 同比 ${
            netYoy === 0 ? '持平' : `${netYoy > 0 ? '+' : ''}${(netYoy * 100).toFixed(1)}%`
          }`}
          accent={net.ytd >= 0 ? 'before:bg-success-500' : 'before:bg-destructive'}
          valueClass={net.ytd < 0 ? 'text-destructive' : undefined}
        />
        <StatTile
          label="自由现金流"
          value={formatMoneyWan(fcf.ytd)}
          unit="万"
          foot={`本月 ${formatMoneyWan(fcf.current)}万 · 经营净额 − 投资流出`}
          accent={fcf.ytd >= 0 ? 'before:bg-success-500' : 'before:bg-destructive'}
          valueClass={fcf.ytd < 0 ? 'text-destructive' : undefined}
        />
      </div>

      {/* 三大活动净现金流对比（本月 vs 累计，正负分色横向条） */}
      <Card className="border border-border shadow-antd-1">
        <CardContent className="p-5">
          <h3 className="mb-3 text-base font-semibold text-foreground">
            三大活动净现金流对比
            <span className="ml-2 text-xs font-normal text-muted-foreground">正=净流入（绿）/ 负=净流出（红）· 单位：万元</span>
          </h3>
          <div className="space-y-4">
            {activityRows.map((r) => {
              const monthYoy = yoyChip(yoyOf(r.current, r.samePeriod))
              const ytdYoy = yoyChip(yoyOf(r.ytd, r.samePeriodYtd))
              const bar = (v: number) => ({
                width: `${actMax > 0 ? Math.max(Math.abs(v) > 0 ? 2 : 0, (Math.abs(v) / actMax) * 100) : 0}%`,
              })
              return (
                <div key={r.name} className="grid grid-cols-[72px_minmax(0,1fr)_92px_minmax(0,1fr)_92px] items-center gap-3">
                  <span className="text-body text-foreground">{r.name}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', r.current >= 0 ? 'bg-success-500' : 'bg-destructive')}
                      style={bar(r.current)}
                    />
                  </div>
                  <span className="text-right text-xs text-muted-foreground">
                    本月 <span className={cn('font-num font-semibold', r.current >= 0 ? 'text-foreground' : 'text-destructive')}>{formatMoneyWan(r.current)}</span>
                    <span className={cn('ml-1 inline-block font-num', monthYoy.cls)}>{monthYoy.text}</span>
                  </span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', r.ytd >= 0 ? 'bg-success-500' : 'bg-destructive')}
                      style={bar(r.ytd)}
                    />
                  </div>
                  <span className="text-right text-xs text-muted-foreground">
                    累计 <span className={cn('font-num font-semibold', r.ytd >= 0 ? 'text-foreground' : 'text-destructive')}>{formatMoneyWan(r.ytd)}</span>
                    <span className={cn('ml-1 inline-block font-num', ytdYoy.cls)}>{ytdYoy.text}</span>
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            现金流指标为单期间口径（本月/同期/累计/同期累计），无逐月序列；如需逐月趋势请前往现金流指标分析。
          </p>
        </CardContent>
      </Card>

      {/* 现金流明细表 */}
      <Card className="border border-border shadow-antd-1">
        <CardContent className="p-5">
          <h3 className="mb-3 text-base font-semibold text-foreground">
            现金流明细
            <span className="ml-2 text-xs font-normal text-muted-foreground">本月 / 同比 / 累计 / 累计同比 · 单位：万元</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-2 text-left text-body font-medium text-foreground">科目</th>
                  <th className="px-3 py-2 text-right text-body font-medium text-foreground">本月</th>
                  <th className="px-3 py-2 text-right text-body font-medium text-foreground">上年同月</th>
                  <th className="px-3 py-2 text-right text-body font-medium text-foreground">本月同比</th>
                  <th className="px-3 py-2 text-right text-body font-medium text-foreground">财年累计</th>
                  <th className="px-3 py-2 text-right text-body font-medium text-foreground">同期累计</th>
                  <th className="px-3 py-2 text-right text-body font-medium text-foreground">累计同比</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((r, i) => {
                  const myoy = yoyChip(r.m.yoy)
                  const yyoy = yoyChip(r.m.ytdYoy)
                  return (
                    <tr
                      key={r.name}
                      className={cn(
                        'border-b border-border/60',
                        i % 2 === 1 && 'bg-muted/30',
                        !r.indent && 'font-semibold',
                      )}
                    >
                      <td className={cn('px-3 py-2 text-left text-body text-foreground', r.indent && 'pl-8 font-normal text-muted-foreground')}>
                        {r.name}
                      </td>
                      <td className={cn('px-3 py-2 text-right font-num text-sm', r.m.current < 0 && 'text-destructive')}>
                        {formatMoneyWan(r.m.current)}
                      </td>
                      <td className="px-3 py-2 text-right font-num text-sm text-muted-foreground">{formatMoneyWan(r.m.samePeriod)}</td>
                      <td className={cn('px-3 py-2 text-right font-num text-sm', myoy.cls)}>{myoy.text}</td>
                      <td className={cn('px-3 py-2 text-right font-num text-sm', r.m.ytd < 0 && 'text-destructive')}>
                        {formatMoneyWan(r.m.ytd)}
                      </td>
                      <td className="px-3 py-2 text-right font-num text-sm text-muted-foreground">{formatMoneyWan(r.m.samePeriodYtd)}</td>
                      <td className={cn('px-3 py-2 text-right font-num text-sm', yyoy.cls)}>{yyoy.text}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            本月流入 {formatMoneyWan(inflowSum.current)}万（同比 {inMonthYoy === 0 ? '持平' : `${(inMonthYoy * 100).toFixed(1)}%`}）·
            本月流出 {formatMoneyWan(outflowSum.current)}万（同比 {outMonthYoy === 0 ? '持平' : `${(outMonthYoy * 100).toFixed(1)}%`}）
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
