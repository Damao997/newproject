import { useExpenseAnalysis } from '@/hooks/api-queries'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { TipLabel } from '@/components/ui/tip-label'
import { totalMetrics } from './budget-total'
import { RateBar } from '@/components/ui/rate-bar'
import { formatMoneyWan, formatPercent, cn } from '@/lib/utils'
import type { ExpenseAnalysisRow } from '@/types'

interface ExpenseAnalysisCardProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
}

/** 预警红绿灯圆点：使用率 <75 绿 / 75-100 黄 / >100 红；无预算（null）灰灯 */
function RateLight({ rate }: { rate: number | null }) {
  const cls = rate === null ? 'bg-muted-foreground/40'
    : rate < 75 ? 'bg-success-strong'
    : rate <= 100 ? 'bg-warning'
    : 'bg-destructive'
  return <span className={cn('inline-block h-2.5 w-2.5 rounded-full', cls)} title={rate === null ? '无预算' : `使用率 ${formatPercent(rate / 100)}`} />
}

/** 同比单元格：红涨绿跌（A 股/国内财报习惯），持平灰；正值不带 "+"，负值保留 "-" */
function YoYBadge({ value }: { value: number }) {
  const isFlat = value === 0
  const isPositive = value > 0
  return (
    <span
      className={cn(
        'inline-flex items-center text-sm font-medium',
        isFlat ? 'text-muted-foreground' : isPositive ? 'text-finance-red' : 'text-finance-green',
      )}
    >
      <span className="font-num">{value === 0 ? '-' : `${value < 0 ? '-' : ''}${(Math.abs(value) * 100).toFixed(1)}%`}</span>
    </span>
  )
}

// 表头对齐《统一表格设计标准》：13px/500 黑字居中（数值列表头同样居中）；TD 保持右对齐 font-num
const TH_CLS = 'px-3 py-2 text-center text-body font-medium text-foreground'
const TD_CLS = 'px-3 py-2 text-right font-num text-sm text-foreground'

/** 单行指标组（ExpenseAnalysisRow 去掉 code/name 即指标组字段） */
type MetricOf = Omit<ExpenseAnalysisRow, 'code' | 'name'>

/**
 * 运营费用分析内容（综合分析卡「运营费用」页，单期间）：按映射配置（映射管理 > 运营费用映射）聚合的运营费用科目，
 * 同时展示月度完成情况（月度预算/本月金额/使用率/预警/同期金额/同比）与
 * 财年累计完成情况（年度预算/累计金额/使用率/预警/同期累计金额/财年同比）。
 * 使用率以橙色进度条展示；预警按费用类红绿灯：使用率 <75 绿 / 75-100 黄 / >100 红，
 * 月度用月度使用率、累计用累计预算口径使用率（ytdCumRate）判断。主体口径跟随看板顶部筛选；
 * 外层 Card 由 AnalysisTabsCard 统一提供。
 */
export function ExpenseAnalysisCard({ period, companyCode }: ExpenseAnalysisCardProps) {
  const { data, isLoading } = useExpenseAnalysis({ period, companyCode })
  const rows = data?.rows ?? []
  const isEmpty = !isLoading && rows.length === 0

  /** 月度完成情况 6 列（月度预算=占比拆分后的当月预算/本月金额/使用率/预警/同期金额/同比） */
  const renderMonthCells = (m: MetricOf) => (
    <>
      <td className={TD_CLS}>{formatMoneyWan(m.monthBudget ?? m.budget / 12)}</td>
      <td className={TD_CLS}>{formatMoneyWan(m.monthActual)}</td>
      <td className={TD_CLS}><RateBar rate={m.monthRate} /></td>
      <td className={cn(TD_CLS, 'text-center')}><RateLight rate={m.monthRate} /></td>
      <td className={TD_CLS}>{formatMoneyWan(m.monthSame)}</td>
      <td className={TD_CLS}><YoYBadge value={m.monthYoy} /></td>
    </>
  )

  /** 财年累计完成情况 6 列（年度预算/累计金额/使用率/预警/同期累计金额/财年同比）；
   * 预警按累计预算口径使用率（ytdCumRate）判断（费用类反向规则） */
  const renderYtdCells = (m: MetricOf) => (
    <>
      <td className={cn(TD_CLS, 'border-l border-border/60')}>{formatMoneyWan(m.budget)}</td>
      <td className={TD_CLS}>{formatMoneyWan(m.ytdActual)}</td>
      <td className={TD_CLS}><RateBar rate={m.ytdRate} /></td>
      <td className={cn(TD_CLS, 'text-center')}><RateLight rate={m.ytdCumRate} /></td>
      <td className={TD_CLS}>{formatMoneyWan(m.ytdSame)}</td>
      <td className={TD_CLS}><YoYBadge value={m.ytdYoy} /></td>
    </>
  )

  return (
    <TooltipProvider>
      {isEmpty ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm font-medium text-foreground">暂无运营费用数据</p>
            <p className="text-xs text-muted-foreground">配置运营费用映射并导入经营数据后，将按映射展示费用使用情况</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table-report data-table-report--striped">
              <thead>
                <tr className="border-b border-border">
                  <th rowSpan={2} className="text-left w-[10em]">指标名称</th>
                  <th colSpan={6} className="text-center font-semibold">月度完成情况</th>
                  <th colSpan={6} className="text-center font-semibold">财年累计完成情况</th>
                </tr>
                <tr>
                  <th className={TH_CLS}>月度预算</th>
                  <th className={TH_CLS}>本月金额</th>
                  <th className={TH_CLS}><TipLabel label="使用率" tip="本月金额÷当月预算（月度）" /></th>
                  <th className={TH_CLS}><TipLabel label="预警" tip="按使用率红黄绿三档：<75 绿 / 75-100 黄 / >100 红" /></th>
                  <th className={TH_CLS}>同期金额</th>
                  <th className={TH_CLS}><TipLabel label="同比" tip="（本期-去年同期）÷去年同期" /></th>
                  <th className={cn(TH_CLS, 'border-l border-border')}>年度预算</th>
                  <th className={TH_CLS}>累计金额</th>
                  <th className={TH_CLS}><TipLabel label="使用率" tip="累计金额÷年度预算（累计）" /></th>
                  <th className={TH_CLS}><TipLabel label="预警" tip="按使用率红黄绿三档：<75 绿 / 75-100 黄 / >100 红" /></th>
                  <th className={TH_CLS}>同期累计金额</th>
                  <th className={TH_CLS}><TipLabel label="财年同比" tip="（累计金额-同期累计）÷同期累计" /></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { code, name, ...metric } = row
                  return (
                    <tr key={code}>
                      {/* 指标名单行截断（空格不计入 10 字符判定）：固定 w-[10em] + truncate，Tooltip 悬停显示完整名称 */}
                      <td className="px-3 py-2 text-left text-sm font-medium text-foreground w-[10em]">
                        {name.replace(/\s/g, '').length > 10 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block w-[10em] truncate">{name}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top">{name}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="block w-[10em] truncate">{name}</span>
                        )}
                      </td>
                      {renderMonthCells(metric)}
                      {renderYtdCells(metric)}
                    </tr>
                  )
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  {(() => {
                    const total = totalMetrics(rows)
                    return (
                      <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                        <td className="px-3 py-2 text-left text-sm font-semibold text-foreground">合计</td>
                        {renderMonthCells(total)}
                        {renderYtdCells(total)}
                      </tr>
                    )
                  })()}
                </tfoot>
              )}
            </table>
          </div>
        )}
    </TooltipProvider>
  )
}
