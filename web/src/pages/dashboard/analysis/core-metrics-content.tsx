import { AlertLight } from '@/components/ui/alert-light'
import { Button } from '@/components/ui/button'
import { DeltaTag } from '@/components/ui/delta-tag'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeleton } from '@/components/ui/skeleton-blocks'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TipLabel } from '@/components/ui/tip-label'
import { useProductMetrics } from '@/hooks/api-queries'
import { formatMoneyWan } from '@/lib/utils'
import { GapAnalysisPanel } from '../core-metrics-gap-analysis'
import { buildProductGapAnalysisItems } from './product-gap-analysis'
import type { KeyMetricsGroup, ProductMetricsRow } from '@/types'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export interface CoreMetricsContentProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
}

// 紧凑密度：19 列宽表收窄字号与留白（表头 text-micro 可两行换行、数值列 text-xs），横向宽约减 20-25%
const TH_CLS = 'px-2 py-1.5 text-center text-micro font-medium leading-tight text-foreground'
const TD_CLS = 'px-2 py-1.5 text-right font-num text-xs tabular-nums text-foreground'
const INDENT_PREFIX = '其中：'

/** 预算类单元格：无预算（null/0）显示「—」，金额行为纯数值（万元） */
function BudgetCell({ value }: { value: number | null }) {
  if (value == null || value === 0) return <span className="text-muted-foreground">—</span>
  return <>{formatMoneyWan(value)}</>
}

/** 达成类单元格：金额纯数值（万元，0 值由格式化函数统一显示「-」） */
function ActualCell({ value }: { value: number }) {
  return <>{formatMoneyWan(value)}</>
}

/** 完成率/占比单元格：入参为 ×100 百分数（禁用 formatPercent 防二次 ×100），分母缺失「—」 */
function PercentCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  return <>{`${value.toFixed(1)}%`}</>
}

/** 累计偏差额 = 财年累计达成 − Σ月度预算目标（时序累计口径，与预警灯一致），无累计预算「—」 */
function DeviationCell({ g }: { g: KeyMetricsGroup }) {
  if (g.ytdBudget == null || g.ytdBudget === 0) return <span className="text-muted-foreground">—</span>
  return <>{formatMoneyWan(g.ytdActual - g.ytdBudget)}</>
}

/** 预警灯口径（与整体核心指标总览一致）：时序达成率 = 财年累计达成 ÷ Σ月度预算目标（ytdBudget 占比前缀和），
 * 无累计预算灰灯；<60 红 / 60-75 黄 / ≥75 绿 */
function alertRateOf(g: KeyMetricsGroup): number | null {
  if (g.ytdBudget == null || g.ytdBudget === 0) return null
  return Number(((g.ytdActual / g.ytdBudget) * 100).toFixed(2))
}

/** 贡献占比 % = 该产品财年累计 ÷ 整体财年累计（分母为合计行整体节点，非产品行求和） */
function shareRateOf(rowValue: number, totalValue: number): number | null {
  if (totalValue === 0) return null
  return Number(((rowValue / totalValue) * 100).toFixed(2))
}

/** 毛利率 % = 毛利 ÷ 收入（累计或同期口径），分母为 0「—」 */
function marginRateOf(profit: number, income: number): number | null {
  if (income === 0) return null
  return Number(((profit / income) * 100).toFixed(2))
}

/**
 * 品类核心指标分析（经营分析 · 核心指标分析子页）：
 * - 数据取 GET /dashboard/analysis/product-metrics（产品配置全行，无数据行全列「—」；合计=整体收入/毛利节点）；
 * - 行：映射管理「产品配置」（KeyMetricsProduct，sortOrder 序）；「其中：」前缀行缩进一级（名称约定层级）；
 * - 列：收入完成情况（预算/本月/累计/偏差额/完成率/预警/同比/贡献占比）
 *   ｜毛利完成情况（预算/本月/累计/偏差额/完成率/预警/同比/贡献占比）｜毛利率（累计实际/去年同期）；
 * - 维度切换器：产品可用、渠道禁用占位（渠道数据能力建设中）；
 * - 金额为万元纯数值（单位见副注），比率为百分比。
 */
export function CoreMetricsContent({ period, companyCode }: CoreMetricsContentProps) {
  const { data, isError, isLoading, refetch } = useProductMetrics({ period, companyCode })
  if (isError && !data) {
    return (
      <section>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <p className="text-sm font-medium text-foreground">品类核心指标数据加载失败</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重试
          </Button>
        </div>
      </section>
    )
  }
  if (isLoading && !data) return <TableSkeleton rows={8} columns={12} />
  const rows = data?.rows ?? []
  const totals = data?.totals
  const analysisItems = buildProductGapAnalysisItems(rows)
  if (rows.length === 0 || !totals) {
    return (
      <section>
        <EmptyState title="暂无产品维度数据" description="当前主体或期间暂无数据，请调整筛选或先维护产品配置后重试" />
      </section>
    )
  }

  const renderRow = ({ name, income, profit }: ProductMetricsRow, isTotal = false) => {
    // 子项缩进双约定：「其中：」前缀（原样显示）或名称前导空格（半角/全角，渲染时剥掉防 HTML 空白折叠）
    const indented = name.startsWith(INDENT_PREFIX) || /^[ \u3000]/.test(name)
    const displayName = name.replace(/^[ \u3000]+/, '')
    return (
      <tr key={name} className={isTotal ? 'bg-muted/40 font-medium' : undefined}>
        <td className={`whitespace-nowrap px-2 py-1.5 text-left text-xs ${isTotal ? 'font-semibold' : 'font-medium'} text-foreground ${indented ? 'pl-8' : ''}`}>
          {displayName}
        </td>
        <td className={TD_CLS}><BudgetCell value={income.annualBudget} /></td>
        {/* 收入完成情况 */}
        <td className={TD_CLS}><ActualCell value={income.monthActual} /></td>
        <td className={TD_CLS}><ActualCell value={income.ytdActual} /></td>
        <td className={TD_CLS}><DeviationCell g={income} /></td>
        <td className={TD_CLS}><PercentCell value={income.annualRate} /></td>
        <td className={`${TD_CLS} text-center`}><AlertLight rate={alertRateOf(income)} /></td>
        <td className={TD_CLS}><DeltaTag value={income.ytdYoy} /></td>
        <td className={TD_CLS}><PercentCell value={shareRateOf(income.ytdActual, totals.income.ytdActual)} /></td>
        {/* 毛利完成情况 */}
        <td className={`${TD_CLS} border-l border-border`}><BudgetCell value={profit.annualBudget} /></td>
        <td className={TD_CLS}><ActualCell value={profit.monthActual} /></td>
        <td className={TD_CLS}><ActualCell value={profit.ytdActual} /></td>
        <td className={TD_CLS}><DeviationCell g={profit} /></td>
        <td className={TD_CLS}><PercentCell value={profit.annualRate} /></td>
        <td className={`${TD_CLS} text-center`}><AlertLight rate={alertRateOf(profit)} /></td>
        <td className={TD_CLS}><DeltaTag value={profit.ytdYoy} /></td>
        <td className={TD_CLS}><PercentCell value={shareRateOf(profit.ytdActual, totals.profit.ytdActual)} /></td>
        {/* 毛利率 */}
        <td className={`${TD_CLS} border-l border-border`}><PercentCell value={marginRateOf(profit.ytdActual, income.ytdActual)} /></td>
        <td className={TD_CLS}><PercentCell value={marginRateOf(profit.ytdSame, income.ytdSame)} /></td>
      </tr>
    )
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-foreground">品类核心指标分析</h3>
          {/* 维度切换：产品可用；渠道为预留占位（数据能力建设中） */}
          <Tabs value="product">
            <TabsList variant="segmented">
              <TabsTrigger value="product" className="h-6 px-2.5 text-xs">产品</TabsTrigger>
              <TabsTrigger value="channel" disabled title="渠道维度建设中，敬请期待" className="h-6 px-2.5 text-xs">渠道</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <span className="text-xs text-muted-foreground">金额单位：万元；比率为百分比</span>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table-report data-table-report--striped">
          <thead>
            <tr className="border-b border-border">
              <th rowSpan={2} className="w-[9.5em] text-left">产品类型</th>
              <th colSpan={8} className="text-center font-semibold">收入完成情况</th>
              <th colSpan={8} className="border-l border-border text-center font-semibold">毛利完成情况</th>
              <th colSpan={2} className="border-l border-border text-center font-semibold">毛利率</th>
            </tr>
            <tr>
              <th className={TH_CLS}>
                <TipLabel label="财年预算目标" tip="该产品匹配收入科目的财年预算总额" />
              </th>
              <th className={TH_CLS}>本月达成</th>
              <th className={TH_CLS}>财年累计达成</th>
              <th className={TH_CLS}><TipLabel label="累计偏差额" tip="累计偏差额 = 财年累计达成 − Σ月度预算目标（年初至当期累计预算，与预警同口径）" /></th>
              <th className={TH_CLS}><TipLabel label="累计完成率" tip="累计完成率 = 财年累计达成 ÷ 财年预算目标" /></th>
              <th className={TH_CLS}><TipLabel label="预警" tip="预警 = 财年累计达成 ÷ Σ月度预算目标（年初至当期累计预算）。三档：<60 红 / 60-75 黄 / ≥75 绿；无累计预算灰灯" /></th>
              <th className={TH_CLS}>财年同比</th>
              <th className={TH_CLS}><TipLabel label="贡献占比" tip="贡献占比 = 该产品财年累计 ÷ 整体财年累计（合计行为整体口径，非产品行求和）" /></th>
              <th className={`${TH_CLS} border-l border-border`}>财年预算目标</th>
              <th className={TH_CLS}>本月达成</th>
              <th className={TH_CLS}>财年累计达成</th>
              <th className={TH_CLS}><TipLabel label="累计偏差额" tip="累计偏差额 = 财年累计达成 − Σ月度预算目标（年初至当期累计预算，与预警同口径）" /></th>
              <th className={TH_CLS}><TipLabel label="累计完成率" tip="累计完成率 = 财年累计达成 ÷ 财年预算目标" /></th>
              <th className={TH_CLS}><TipLabel label="预警" tip="预警 = 财年累计达成 ÷ Σ月度预算目标（年初至当期累计预算）。三档：<60 红 / 60-75 黄 / ≥75 绿；无累计预算灰灯" /></th>
              <th className={TH_CLS}>财年同比</th>
              <th className={TH_CLS}><TipLabel label="贡献占比" tip="贡献占比 = 该产品财年累计 ÷ 整体财年累计（合计行为整体口径，非产品行求和）" /></th>
              <th className={`${TH_CLS} border-l border-border`}><TipLabel label="累计至本月实际毛利率" tip="毛利率 = 财年累计毛利 ÷ 财年累计收入" /></th>
              <th className={TH_CLS}><TipLabel label="去年同期实际毛利率" tip="去年同期毛利率 = 去年同期累计毛利 ÷ 去年同期累计收入" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => renderRow(r))}
            {renderRow({ code: '', name: '合计', income: totals.income, profit: totals.profit }, true)}
          </tbody>
        </table>
      </div>
      {/* 差距分析：由产品行数据模板化自动生成，随期间/主体筛选联动（合计行为整体口径不生成） */}
      {analysisItems.length > 0 && <GapAnalysisPanel items={analysisItems} className="mt-5" />}
    </section>
  )
}
