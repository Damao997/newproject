import { AlertLight, ExpenseAlertLight } from '@/components/ui/alert-light'
import { Button } from '@/components/ui/button'
import { DeltaTag } from '@/components/ui/delta-tag'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/skeleton-blocks'
import { TipLabel } from '@/components/ui/tip-label'
import { useKeyMetrics } from '@/hooks/api-queries'
import { formatMoneyWan, formatMetricValue } from '@/lib/utils'
import type { KeyMetricsGroup } from '@/types'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { buildGapAnalysisItems, GapAnalysisPanel } from './core-metrics-gap-analysis'

export interface CoreMetricsOverviewProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
}

/** 总览行定义：key 与后端 getKeyMetrics 行标识一一对应（行缺失时跳过，不虚构） */
const OVERVIEW_ROWS: { key: string; label: string }[] = [
  { key: 'income', label: '营业收入' },
  { key: 'profit', label: '营业毛利' },
  { key: 'expense', label: '运营费用' },
  { key: 'netProfit', label: '净利润' },
  { key: 'operating', label: '经营性现金流净值' },
  { key: 'laborEff', label: '劳效比' },
  { key: 'expenseEff', label: '费效比' },
]

const TH_CLS = 'px-3 py-2 text-center text-body font-medium text-foreground'
const TD_CLS = 'px-3 py-2 text-right font-num text-sm tabular-nums text-foreground'

/** 预算类单元格：无预算（null/0）显示「—」，比率行按百分比格式化，金额行为纯数值（万元，单位见副注） */
function BudgetCell({ value, isRatio }: { value: number | null; isRatio: boolean }) {
  if (value == null || value === 0) return <span className="text-muted-foreground">—</span>
  return <>{isRatio ? formatMetricValue(value, 'ratio') : formatMoneyWan(value)}</>
}

/** 达成类单元格：金额行为纯数值（万元），比率行按百分比格式化（0 值由格式化函数统一显示「-」） */
function ActualCell({ value, isRatio }: { value: number; isRatio: boolean }) {
  return <>{isRatio ? formatMetricValue(value, 'ratio') : formatMoneyWan(value)}</>
}

/** 完成率单元格：monthRate/annualRate 已是 ×100 百分数（禁用 formatPercent 防二次 ×100），无预算「—」 */
function RateCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  return <>{`${value.toFixed(1)}%`}</>
}

/** 预警灯统一口径：时序达成率 = 财年累计达成 ÷ Σ月度预算目标（年初至当期累计预算 ytdBudget，占比前缀和），
 * 无累计预算（null/0）灰灯；财年早期按年预算算完成率天然偏低，预警必须与预算时间进度对比 */
function alertRateOf(g: KeyMetricsGroup): number | null {
  if (g.ytdBudget == null || g.ytdBudget === 0) return null
  return Number(((g.ytdActual / g.ytdBudget) * 100).toFixed(2))
}

/** 偏差额单元格 = 财年累计达成 − 本年累计预算（时序口径，金额行纯数值万元/比率行百分比），无累计预算「—」 */
function DeviationCell({ g, isRatio }: { g: KeyMetricsGroup; isRatio: boolean }) {
  if (g.ytdBudget == null || g.ytdBudget === 0) return <span className="text-muted-foreground">—</span>
  return <>{isRatio ? formatMetricValue(g.ytdActual - g.ytdBudget, 'ratio') : formatMoneyWan(g.ytdActual - g.ytdBudget)}</>
}

/**
 * 整体核心指标总览（关键指标子页顶部的两级表头总览）：
 * - 数据取 GET /dashboard/analysis/key-metrics；
 * - 行：营业收入/营业毛利/运营费用/净利润/经营性现金流净值 + 劳效比/费效比（经营指标板块）；
 * - 列：月度完成情况（预算/达成/完成率/同比/环比）+ 财年预计完成情况（预算/累计/偏差额/完成率/预警/同比）；
 * 偏差额 = 财年累计达成 − 本年累计预算（金额行：年度预算 × 占比前缀和；比率行：直接对年度目标值，后端不拆分）；
 * 预警统一按时序口径 = 财年累计达成 ÷ Σ月度预算目标（年初至当期累计预算，完成率列的 annualRate 分母是全年预算，
 * 财年早期天然偏低、不用于预警）：收入/利润类 AlertLight 三档，运营费用为费用类反向规则 ExpenseAlertLight（超支才警示）；
 * - 金额为万元纯数值（单位见副注，不带「万」后缀）。
 */
export function CoreMetricsOverview({ period, companyCode }: CoreMetricsOverviewProps) {
  const { data, isError, isLoading, refetch } = useKeyMetrics({ period, companyCode })
  if (isError && !data) {
    return (
      <section className="shrink-0">
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <p className="text-sm font-medium text-foreground">整体核心指标数据加载失败</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重试
          </Button>
        </div>
      </section>
    )
  }
  if (isLoading && !data) return <TableSkeleton rows={7} columns={12} />
  const rows = OVERVIEW_ROWS
    .map(({ key, label }) => {
      const row = data?.rows.find((r) => r.key === key)
      return row ? { key, label, valueType: row.valueType, g: row.values } : null
    })
    .filter((r): r is { key: string; label: string; valueType: 'amount' | 'quantity' | 'ratio'; g: KeyMetricsGroup } => r !== null)
  const analysisItems = buildGapAnalysisItems(rows, period)
  if (rows.length === 0) {
    return (
      <section className="shrink-0">
        <EmptyState title="暂无经营数据" description="当前主体或期间暂无数据，请调整筛选后重试" />
      </section>
    )
  }

  return (
    <section className="shrink-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">整体核心指标总览</h3>
        <span className="text-xs text-muted-foreground">金额单位：万元；比率为百分比</span>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table-report data-table-report--striped">
          <thead>
            <tr className="border-b border-border">
              <th rowSpan={2} className="text-left w-[10em]">指标名称</th>
              <th colSpan={5} className="text-center font-semibold">月度完成情况</th>
              <th colSpan={6} className="border-l border-border text-center font-semibold">财年预计完成情况</th>
            </tr>
            <tr>
              <th className={TH_CLS}>月度预算目标</th>
              <th className={TH_CLS}>本月达成</th>
              <th className={TH_CLS}>完成率</th>
              <th className={TH_CLS}>月度同比</th>
              <th className={TH_CLS}>月度环比</th>
              <th className={`${TH_CLS} border-l border-border`}>财年预算目标</th>
              <th className={TH_CLS}>财年累计达成</th>
              <th className={TH_CLS}>偏差额</th>
              <th className={TH_CLS}>完成率</th>
              <th className={TH_CLS}><TipLabel label="预警" tip="预警 = 财年累计达成 ÷ Σ月度预算目标（年初至当期累计预算）。收入/利润类三档：<60 红 / 60-75 黄 / ≥75 绿；运营费用反向三档（超支才警示）：<75 绿 / 75-100 黄 / >100 红" /></th>
              <th className={TH_CLS}>财年同比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, valueType, g }) => {
              const isRatio = valueType === 'ratio'
              // 预警灯统一按时序口径（财年累计达成 ÷ Σ月度预算目标）；运营费用为费用类指标用反向规则（超支才警示）
              const isExpense = key === 'expense'
              const alertRate = alertRateOf(g)
              return (
                <tr key={key}>
                  <td className="whitespace-nowrap px-3 py-2 text-left text-sm font-medium text-foreground">{label}</td>
                  <td className={TD_CLS}><BudgetCell value={g.monthBudget} isRatio={isRatio} /></td>
                  <td className={TD_CLS}><ActualCell value={g.monthActual} isRatio={isRatio} /></td>
                  <td className={TD_CLS}><RateCell value={g.monthRate} /></td>
                  <td className={TD_CLS}><DeltaTag value={g.monthYoy} /></td>
                  <td className={TD_CLS}><DeltaTag value={g.monthMom} /></td>
                  <td className={`${TD_CLS} border-l border-border`}><BudgetCell value={g.annualBudget} isRatio={isRatio} /></td>
                  <td className={TD_CLS}><ActualCell value={g.ytdActual} isRatio={isRatio} /></td>
                  <td className={TD_CLS}><DeviationCell g={g} isRatio={isRatio} /></td>
                  <td className={TD_CLS}><RateCell value={g.annualRate} /></td>
                  <td className={`${TD_CLS} text-center`}>
                    {isExpense ? <ExpenseAlertLight rate={alertRate} /> : <AlertLight rate={alertRate} />}
                  </td>
                  <td className={TD_CLS}><DeltaTag value={g.ytdYoy} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* 差距分析：由上表数据模板化自动生成，随期间/主体筛选联动 */}
      {analysisItems.length > 0 && (
        <div className="mt-4 pb-6">
          <GapAnalysisPanel items={analysisItems} />
        </div>
      )}
    </section>
  )
}
