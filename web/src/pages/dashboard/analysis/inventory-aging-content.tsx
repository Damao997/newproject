import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ArrowRight, Info, RefreshCw } from 'lucide-react'
import { useInventoryDetails, useInventoryOverview } from '@/hooks/api-queries'
import { AnalysisPageSkeleton } from '@/components/ui/skeleton-blocks'
import { DeltaTag } from '@/components/ui/delta-tag'
import { cn, formatMoneyWan } from '@/lib/utils'
import { getChartSeries } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'

interface InventoryAgingContentProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选） */
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

/** 同比（总额）：（本期 − 同期）/ |同期|，小数比率（存货为占用类指标，增长红=占用上升） */
function yoyRatio(current: number, samePeriod: number): number {
  const base = Math.abs(samePeriod)
  return base ? (current - samePeriod) / base : 0
}

/**
 * 存货库龄分析页（真实数据：useInventoryOverview + useInventoryDetails，跟随看板主体/期间筛选）：
 * - 后端暂无库龄（账龄段）专用端点，本页展示库存结构与周转的真实数据，不虚构库龄分布；
 * - 顶部 4 个 KPI 磁贴：库存总额（含同比）/ 周转天数（本期 vs 同期）/ 覆盖公司数 / 品类数；
 * - 库存品类结构：按本期金额占比横向条 + 同比；
 * - 公司 × 品类明细表（useInventoryDetails）；
 * - 说明条：库龄明细需库存数据源补充账龄字段后上线 + 跳转库存管理页。
 */
export function InventoryAgingContent({ period, companyCode }: InventoryAgingContentProps) {
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const companyCodes = companyCode ? [companyCode] : undefined
  const { data, isLoading, isError, refetch } = useInventoryOverview({ period, companyCodes })
  const { data: detailData, isLoading: detailLoading } = useInventoryDetails({ period, companyCodes })
  const detailRows = useMemo(() => detailData?.rows ?? [], [detailData])
  const categories = useMemo(() => data?.categories ?? [], [data])
  const palette = getChartSeries(sidebarStyle)

  // 同比（总额）：（本期 − 同期）/ |同期|，小数比率
  const totalYoy = useMemo(() => {
    if (!data) return 0
    return yoyRatio(data.total.current, data.total.samePeriod)
  }, [data])
  const maxCategory = useMemo(() => categories.reduce((m, c) => Math.max(m, c.current), 0), [categories])

  if (isLoading || (detailLoading && !detailData)) {
    return <AnalysisPageSkeleton blocks={[280, 260]} />
  }

  if (isError && !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <p className="text-sm font-medium text-foreground">库存数据加载失败</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          重试
        </Button>
      </div>
    )
  }

  if (!data || (categories.length === 0 && data.total.current === 0)) {
    return (
      <EmptyState
        title="暂无存货数据"
        description="导入并激活静态（资产负债表）数据后，将按品类展示库存结构与周转情况"
      />
    )
  }

  return (
    <div className="animate-fade-in space-y-4">
      {/* 库龄数据源说明（后端无库龄专用端点，不虚构账龄数据） */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-info/30 bg-info/5 px-4 py-2.5 text-sm">
        <span className="inline-flex items-center gap-2 text-info-700">
          <Info className="h-4 w-4 shrink-0" />
          库龄（账龄段）明细暂无数据源，本页展示库存结构与周转的真实数据；库龄明细待库存数据补充账龄字段后上线
        </span>
        <Button asChild variant="outline" size="sm" className="h-8 gap-1">
          <Link to="/inventory">
            前往库存管理
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {/* 顶部 4 个 KPI 磁贴（真实口径） */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="库存总额"
          value={formatMoneyWan(data.total.current)}
          unit="万"
          foot={`${period ? `期间 ${period} · ` : ''}同比 ${totalYoy === 0 ? '持平' : `${totalYoy > 0 ? '+' : ''}${(totalYoy * 100).toFixed(1)}%`}`}
          accent="before:bg-info-500"
        />
        <StatTile
          label="存货周转天数"
          value={data.turnoverDays.current > 0 ? String(Math.round(data.turnoverDays.current)) : '–'}
          unit={data.turnoverDays.current > 0 ? '天' : ''}
          foot={data.turnoverDays.samePeriod > 0 ? `上年同期 ${Math.round(data.turnoverDays.samePeriod)} 天` : '暂无同期数据'}
          accent="before:bg-blue-8"
        />
        <StatTile
          label="覆盖公司数"
          value={String(data.companyCount)}
          unit="家"
          foot={companyCode ? '单体/汇总合并口径' : '数据权限内全部公司'}
          accent="before:bg-chart-5"
        />
        <StatTile
          label="品类数"
          value={String(categories.length)}
          unit="类"
          foot="存货品类（科目映射）"
          accent="before:bg-success-500"
        />
      </div>

      {/* 库存品类结构（真实占比 + 同比） */}
      <Card className="border border-border shadow-antd-1">
        <CardContent className="p-5">
          <h3 className="mb-3 text-base font-semibold text-foreground">
            库存品类结构
            <span className="ml-2 text-xs font-normal text-muted-foreground">本期金额占比 · 单位：万元</span>
          </h3>
          {categories.length === 0 ? (
            <EmptyState compact className="py-10" title="暂无品类数据" />
          ) : (
            <div className="space-y-2.5">
              {categories.map((c, i) => (
                  <div key={c.code} className="flex items-center gap-3">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                      style={{ background: palette[i % palette.length] }}
                      aria-hidden
                    />
                    <span className="w-[9em] shrink-0 truncate text-body text-foreground" title={c.name}>{c.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${maxCategory > 0 ? Math.max(c.current > 0 ? 2 : 0, (c.current / maxCategory) * 100) : 0}%`,
                          background: palette[i % palette.length],
                        }}
                      />
                    </div>
                    <span className="w-[80px] shrink-0 text-right font-num text-body text-foreground">
                      {formatMoneyWan(c.current)}
                    </span>
                    <span className="w-[56px] shrink-0 text-right font-num text-xs text-muted-foreground">
                      {c.share.toFixed(1)}%
                    </span>
                    <span className="w-[76px] shrink-0 text-right">
                      {/* 库存接口 yoy 为百分数（×100），转小数传入 */}
                      <DeltaTag value={c.yoy / 100} />
                    </span>
                  </div>
                ))}
              {/* 合计行 */}
              <div className="flex items-center gap-3 border-t-2 border-border pt-2.5 font-semibold">
                <span className="w-[9em] shrink-0 text-body">合计</span>
                <div className="flex-1" />
                <span className="w-[80px] shrink-0 text-right font-num text-body">{formatMoneyWan(data.total.current)}</span>
                <span className="w-[56px] shrink-0 text-right font-num text-xs text-muted-foreground">100.0%</span>
                <span className="w-[76px] shrink-0 text-right">
                  <DeltaTag value={totalYoy} />
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 公司 × 品类 明细表 */}
      <Card className="border border-border shadow-antd-1">
        <CardContent className="p-5">
          <h3 className="mb-3 text-base font-semibold text-foreground">
            公司 × 品类明细
            <span className="ml-2 text-xs font-normal text-muted-foreground"> {detailRows.length} 行 · 单位：万元</span>
          </h3>
          {detailRows.length === 0 ? (
            <EmptyState compact className="py-10" title="暂无明细数据" />
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="data-table-report data-table-report--striped">
                <thead className="sticky top-0 z-[1] bg-ink-2">
                  <tr>
                    <th className="text-left">公司</th>
                    <th className="text-left">品类</th>
                    <th className="text-right">本期</th>
                    <th className="text-right">年初</th>
                    <th className="text-right">同期</th>
                    <th className="text-right">同比</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((r) => (
                      <tr key={`${r.companyCode}-${r.categoryCode}`}>
                        <td className="max-w-[12em] truncate text-left text-body text-foreground" title={r.companyName}>
                          {r.companyShortName ?? r.companyName}
                        </td>
                        <td className="text-left text-body text-foreground">{r.categoryName}</td>
                        <td className="text-right font-num text-sm text-foreground">{formatMoneyWan(r.current)}</td>
                        <td className="text-right font-num text-sm text-muted-foreground">{formatMoneyWan(r.yearStart)}</td>
                        <td className="text-right font-num text-sm text-muted-foreground">{formatMoneyWan(r.samePeriod)}</td>
                        {/* 库存接口 yoy 为百分数（×100），转小数传入 */}
                        <td className="text-right"><DeltaTag value={r.yoy / 100} /></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
