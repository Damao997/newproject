import { useCallback, useMemo, useState } from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { FilterBar } from '@/components/layout/filter-bar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { EmptyState } from '@/components/ui/empty-state'
import { AnalysisDrawer, type AnalysisTarget } from '@/components/indicators/analysis-drawer'
import { useInventoryOverview, useInventoryDetails, useCompanies, type InventoryCategoryRow } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { usePeriodStore } from '@/stores/periodStore'
import { usePermission } from '@/hooks/usePermission'
import { cn, formatMoneyWan } from '@/lib/utils'
import { CategoryPieCard } from './category-pie-card'
import { CategoryRankCard } from './category-rank-card'
import { CompanyShareCard } from './company-share-card'
import { InventoryTrendCard } from './trend-card'
import { DetailTable, QueryError } from './detail-table'
import { EMPTY_ROWS, formatDays } from './inventory-utils'
import { CalendarDays, RefreshCw } from 'lucide-react'

/** 空品类稳定引用：避免 `?? []` 每次渲染新建数组导致图表 memo 失效 */
const EMPTY_CATEGORIES: InventoryCategoryRow[] = []

/**
 * 存货管理页：顶部四维 KPI（总额/品类占比/No.1 品类/周转天数）+ 品类占比饼图 +
 * 品类排名条形图 + 成员单体公司占比饼图 + 财年趋势卡 + 公司×品类明细表（含导出/单项分析）。
 * 筛选：公司/期间跟随顶部 Header 全局筛选（periodStore：companyCodes null/[] = 全部公司，
 * period 必填 YYYY-MM；inventory API 期间未选择时显示空态）；页面特有筛选（品类钻取/明细维度）
 * 持久化 pageStateStore。饼图/排名图点击钻取品类 → 联动明细表。
 */

// ───────────────────── KPI 磁贴（沿用设计稿视觉） ─────────────────────
interface KpiTile {
  label: string
  icon: string
  valueText: string
  unit: string
  tone: 'orange' | 'cyan' | 'violet' | 'green'
  emphasis?: boolean
  chip: { direction: '↑' | '↓' | '→'; text: string; tone: 'up' | 'down' | 'flat' }
  foot: string
}

const TONE_PRE: Record<KpiTile['tone'], string> = {
  orange: 'before:bg-[#fa8c16]',
  cyan: 'before:bg-[#13c2c2]',
  violet: 'before:bg-[#722ed1]',
  green: 'before:bg-[#52c41a]',
}

const TONE_ICON: Record<KpiTile['tone'], { bg: string; fg: string }> = {
  orange: { bg: 'bg-[#fff7e6]', fg: 'text-[#fa8c16]' },
  cyan: { bg: 'bg-[#e6fffb]', fg: 'text-[#13c2c2]' },
  violet: { bg: 'bg-[#f9f0ff]', fg: 'text-[#722ed1]' },
  green: { bg: 'bg-[#f6ffed]', fg: 'text-[#52c41a]' },
}

const CHIP_CLS: Record<'up' | 'down' | 'flat', string> = {
  up: 'bg-[#fff1f0] text-[#ff4d4f]',
  down: 'bg-[#f6ffed] text-[#52c41a]',
  flat: 'bg-muted text-muted-foreground',
}

/** 变动率 → 红涨绿跌徽标（无口径/零变动显示 '-'） */
function rateChip(rate: number): KpiTile['chip'] {
  if (!Number.isFinite(rate)) return { direction: '→', text: '-', tone: 'flat' }
  if (rate === 0) return { direction: '→', text: '0.0%', tone: 'flat' }
  return rate > 0
    ? { direction: '↑', text: `${rate.toFixed(1)}%`, tone: 'up' }
    : { direction: '↓', text: `${Math.abs(rate).toFixed(1)}%`, tone: 'down' }
}

function StatTile({ tile }: { tile: KpiTile }) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-5',
        "before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:content-['']",
        TONE_PRE[tile.tone],
        tile.emphasis && 'border-[#ffc069] bg-gradient-to-br from-[#ffe7ba] to-[#fff7e6]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-secondary-foreground">{tile.label}</span>
        <span
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold',
            TONE_ICON[tile.tone].bg,
            TONE_ICON[tile.tone].fg,
          )}
        >
          {tile.icon}
        </span>
      </div>
      <div
        className={cn(
          'truncate font-mono text-[28px] font-semibold leading-tight tabular-nums',
          tile.emphasis ? 'text-[#d46b08]' : 'text-foreground',
        )}
      >
        {tile.valueText}
        {tile.unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{tile.unit}</span>}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={cn(
            'inline-flex h-5 items-center rounded-sm px-1.5 font-mono text-xs tabular-nums',
            CHIP_CLS[tile.chip.tone],
          )}
        >
          {tile.chip.direction} {tile.chip.text}
        </span>
        <span className="truncate text-muted-foreground">{tile.foot}</span>
      </div>
    </div>
  )
}

// ───────────────────── 主页面 ─────────────────────
export default function InventoryPage() {
  // 页面特有筛选持久化：品类钻取/明细维度（公司/期间跟随顶部 Header 全局筛选）
  const setInventory = usePageStore((s) => s.setInventory)
  const categoryCode = usePageStore((s) => s.inventory.categoryCode)
  const detailDim = usePageStore((s) => s.inventory.detailDim)
  const companies = usePeriodStore((s) => s.companyCodes)
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const period = usePeriodStore((s) => s.period)

  const { can } = usePermission()
  const { data: companiesData } = useCompanies()

  // 查询参数：companyCodes null/[] = 全部公司（不传由后端取全部）；period 必填，未选期间不启用查询
  const companyCodesParam = companies && companies.length > 0 ? companies : undefined
  const overviewQuery = useInventoryOverview({ period: period ?? undefined, companyCodes: companyCodesParam })
  const detailsQuery = useInventoryDetails({ period: period ?? undefined, companyCodes: companyCodesParam })

  // 公司占比卡仅当恰好选中一个汇总主体时渲染（明细按成员单体展开，单选主体下占比才有意义）
  const showShareCard = useMemo(() => {
    if (!companies || companies.length !== 1) return false
    return companiesData?.some((c) => c.code === companies[0] && c.type === 'summary') ?? false
  }, [companies, companiesData])

  // 钻取品类显示名：优先总览品类表，退化明细行，最终显示编码
  const categoryName = useMemo(() => {
    if (!categoryCode) return ''
    return (
      overviewQuery.data?.categories.find((c) => c.code === categoryCode)?.name
      ?? detailsQuery.data?.rows.find((r) => r.categoryCode === categoryCode)?.categoryName
      ?? categoryCode
    )
  }, [categoryCode, overviewQuery.data, detailsQuery.data])

  // 品类钻取：点击饼图/排名条形 → 写入持久化筛选，再点同品类取消
  const handleCategoryClick = useCallback(
    (code: string) => {
      setInventory({ categoryCode: usePageStore.getState().inventory.categoryCode === code ? '' : code })
    },
    [setInventory],
  )

  // 行级「分析」抽屉目标（明细表行内触发，构建上下文在 DetailTable 内完成）
  const [analysisTarget, setAnalysisTarget] = useState<AnalysisTarget | null>(null)

  // ===== 四维 KPI：总额 / 品类占比 / No.1 品类 / 周转天数 =====
  const kpiTiles = useMemo<KpiTile[]>(() => {
    const total = overviewQuery.data?.total
    const top = overviewQuery.data?.categories[0]
    const days = overviewQuery.data?.turnoverDays
    const vsYearStart = total && total.yearStart ? ((total.current - total.yearStart) / total.yearStart) * 100 : Number.NaN
    const daysDelta = days && days.samePeriod ? ((days.current - days.samePeriod) / days.samePeriod) * 100 : Number.NaN
    return [
      {
        label: '库存总额',
        icon: '¥',
        valueText: formatMoneyWan(total?.current ?? 0),
        unit: '万',
        tone: 'orange',
        emphasis: true,
        chip: rateChip(vsYearStart),
        foot: '较年初',
      },
      {
        label: '品类占比',
        icon: '%',
        valueText: top ? top.share.toFixed(1) : '-',
        unit: '%',
        tone: 'cyan',
        chip: { direction: '→', text: top?.name ?? '-', tone: 'flat' },
        foot: '最大品类',
      },
      {
        label: 'No.1 品类',
        icon: '类',
        valueText: top ? formatMoneyWan(top.current) : '-',
        unit: top ? '万' : '',
        tone: 'violet',
        chip: { direction: '→', text: top ? `No.${top.rank}` : '-', tone: 'flat' },
        foot: top?.name ?? '暂无品类数据',
      },
      {
        label: '库存周转天数',
        icon: '天',
        valueText: days && days.current > 0 ? days.current.toFixed(1) : '-',
        unit: '天',
        tone: 'green',
        chip: rateChip(daysDelta),
        foot: `同期 ${formatDays(days?.samePeriod ?? 0)}`,
      },
    ]
  }, [overviewQuery.data])

  const anyFetching = overviewQuery.isFetching || detailsQuery.isFetching
  const detailRows = detailsQuery.data?.rows ?? EMPTY_ROWS
  const categories = overviewQuery.data?.categories ?? EMPTY_CATEGORIES

  return (
    <PageContainer
      title="存货管理"
      description="覆盖品类占比、库存排名、公司分布与财年趋势 · 期间与财年跟随顶部导航选择"
      actions={
        <Button variant="outline" size="sm" disabled={anyFetching} onClick={() => { overviewQuery.refetch(); detailsQuery.refetch() }}>
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', anyFetching && 'animate-spin')} />
          刷新
        </Button>
      }
    >
      {/* 筛选条：全局公司/期间已上收顶部 Header，此处仅保留明细条数反馈 */}
      <Card className="rounded-card border border-border p-4">
        <FilterBar>
          {period && <Pill tone="blue">明细 {detailRows.length} 条</Pill>}
        </FilterBar>
      </Card>

      {!period ? (
        // 无数据期间：API 期间必填，等待顶部导航选择（PeriodPill 会自动归一化到最新月份）
        <EmptyState
          icon={CalendarDays}
          title="未选择期间"
          description="存货数据按月快照提供，请先在顶部导航选择期间"
          compact
        />
      ) : (
        <>
          {/* 四维 KPI 摘要行 */}
          {overviewQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="加载中">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-[136px] rounded-lg border border-border" />
              ))}
            </div>
          ) : overviewQuery.isError ? (
            <QueryError
              message={overviewQuery.error instanceof Error ? overviewQuery.error.message : undefined}
              onRetry={() => overviewQuery.refetch()}
              fetching={overviewQuery.isFetching}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {kpiTiles.map((t) => (
                <StatTile key={t.label} tile={t} />
              ))}
            </div>
          )}

          {/* 2×2 网格：品类占比 / 品类排名 / 公司占比（条件渲染）/ 财年趋势 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CategoryPieCard
              categories={categories}
              loading={overviewQuery.isLoading}
              onCategoryClick={handleCategoryClick}
            />
            <CategoryRankCard
              categories={categories}
              loading={overviewQuery.isLoading}
              onCategoryClick={handleCategoryClick}
            />
            {showShareCard && (
              <CompanyShareCard rows={detailRows} loading={detailsQuery.isLoading} />
            )}
            <div className={cn(!showShareCard && 'lg:col-span-2')}>
              <InventoryTrendCard companyCodes={companyCodesParam ?? []} fiscalYear={fiscalYear} />
            </div>
          </div>

          {/* 存货明细表（公司×品类：本期/年初/同期，维度切换/搜索/排序/导出/单项分析） */}
          <DetailTable
            detailDim={detailDim}
            setDetailDim={(d) => setInventory({ detailDim: d })}
            rows={detailRows}
            loading={detailsQuery.isLoading}
            isError={detailsQuery.isError}
            error={detailsQuery.error}
            fetching={detailsQuery.isFetching}
            onRetry={() => detailsQuery.refetch()}
            period={period}
            categoryCode={categoryCode}
            categoryName={categoryName}
            canAnalyze={can('reports', 'create')}
            onAnalyze={setAnalysisTarget}
          />

          <AnalysisDrawer open={analysisTarget !== null} target={analysisTarget} onClose={() => setAnalysisTarget(null)} />
        </>
      )}
    </PageContainer>
  )
}
