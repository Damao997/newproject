import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useExpenseAnalysis } from '@/hooks/api-queries'
import { totalMetrics } from './budget-total'
import { formatMoneyWan, formatPercent, cn } from '@/lib/utils'
import type { ExpenseAnalysisRow } from '@/types'

interface ExpenseAnalysisCardProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
  /** 当前主体显示名（标题下说明口径） */
  subjectName?: string
}

/** 费用类使用率红绿灯三档（与收入类达成率规则相反：费用越低越安全）：<75 绿 / 75-100 黄 / >100 红；无预算灰 */
function rateColorClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground'
  if (rate < 75) return 'text-success-strong'
  if (rate <= 100) return 'text-warning-strong'
  return 'text-destructive'
}

/** 预警红绿灯圆点：使用率 <75 绿 / 75-100 黄 / >100 红；无预算（null）灰灯 */
function RateLight({ rate }: { rate: number | null }) {
  const cls = rate === null ? 'bg-muted-foreground/40'
    : rate < 75 ? 'bg-success-strong'
    : rate <= 100 ? 'bg-warning-strong'
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
      <span className="font-num">{value < 0 ? '-' : ''}{(Math.abs(value) * 100).toFixed(1)}%</span>
    </span>
  )
}

/** 使用率单元格：null（无预算）显示 "–" */
function rateText(rate: number | null): string {
  return rate === null ? '–' : formatPercent(rate / 100)
}

const TH_CLS = 'px-3 py-2 text-right text-xs font-medium text-muted-foreground'
const TD_CLS = 'px-3 py-2 text-right font-num text-sm text-foreground'

/** 单行指标组（ExpenseAnalysisRow 去掉 code/name 即指标组字段） */
type MetricOf = Omit<ExpenseAnalysisRow, 'code' | 'name'>

/**
 * 运营费用分析卡（单期间）：按映射配置（看板管理 > 运营费用映射）聚合的运营费用科目，
 * 同时展示月度完成情况（月度预算/本月金额/使用率/预警/同期金额/同比）与
 * 财年累计完成情况（年度预算/累计金额/使用率/预警/同期累计金额/财年同比）。
 * 预警按费用类红绿灯：使用率 <75 绿 / 75-100 黄 / >100 红。主体口径跟随看板顶部筛选。
 */
export function ExpenseAnalysisCard({ period, companyCode, subjectName }: ExpenseAnalysisCardProps) {
  const { data, isLoading } = useExpenseAnalysis({ period, companyCode })
  const rows = data?.rows ?? []
  const isEmpty = !isLoading && rows.length === 0

  /** 月度完成情况 6 列（月度预算=占比拆分后的当月预算/本月金额/使用率/预警/同期金额/同比） */
  const renderMonthCells = (m: MetricOf) => (
    <>
      <td className={TD_CLS}>{formatMoneyWan(m.monthBudget ?? m.budget / 12)}</td>
      <td className={TD_CLS}>{formatMoneyWan(m.monthActual)}</td>
      <td className={cn(TD_CLS, rateColorClass(m.monthRate))}>{rateText(m.monthRate)}</td>
      <td className={cn(TD_CLS, 'text-center')}><RateLight rate={m.monthRate} /></td>
      <td className={TD_CLS}>{formatMoneyWan(m.monthSame)}</td>
      <td className={TD_CLS}><YoYBadge value={m.monthYoy} /></td>
    </>
  )

  /** 财年累计完成情况 6 列（年度预算/累计金额/使用率/预警/同期累计金额/财年同比） */
  const renderYtdCells = (m: MetricOf) => (
    <>
      <td className={cn(TD_CLS, 'border-l border-border/60')}>{formatMoneyWan(m.budget)}</td>
      <td className={TD_CLS}>{formatMoneyWan(m.ytdActual)}</td>
      <td className={cn(TD_CLS, rateColorClass(m.ytdRate))}>{rateText(m.ytdRate)}</td>
      <td className={cn(TD_CLS, 'text-center')}><RateLight rate={m.ytdRate} /></td>
      <td className={TD_CLS}>{formatMoneyWan(m.ytdSame)}</td>
      <td className={TD_CLS}><YoYBadge value={m.ytdYoy} /></td>
    </>
  )

  return (
    <Card className="animate-fade-in border border-border shadow-sm" style={{ animationDelay: '200ms' }}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-5">
        <div>
          <CardTitle className="text-lg font-semibold text-foreground">运营费用分析</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            期间 {data?.period ?? period ?? '—'} · 单位：万元{subjectName ? ` · 当前主体：${subjectName}` : ''}
          </p>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        {isEmpty ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm font-medium text-foreground">暂无运营费用数据</p>
            <p className="text-xs text-muted-foreground">配置运营费用映射并导入经营数据后，将按映射展示费用使用情况</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th rowSpan={2} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">指标名称</th>
                  <th colSpan={6} className="border-l border-border px-3 py-2 text-center text-xs font-semibold text-foreground">月度完成情况</th>
                  <th colSpan={6} className="border-l border-border px-3 py-2 text-center text-xs font-semibold text-foreground">财年累计完成情况</th>
                </tr>
                <tr className="border-b border-border">
                  <th className={TH_CLS}>月度预算</th>
                  <th className={TH_CLS}>本月金额</th>
                  <th className={TH_CLS}>使用率</th>
                  <th className={TH_CLS}>预警</th>
                  <th className={TH_CLS}>同期金额</th>
                  <th className={TH_CLS}>同比</th>
                  <th className={cn(TH_CLS, 'border-l border-border')}>年度预算</th>
                  <th className={TH_CLS}>累计金额</th>
                  <th className={TH_CLS}>使用率</th>
                  <th className={TH_CLS}>预警</th>
                  <th className={TH_CLS}>同期累计金额</th>
                  <th className={TH_CLS}>财年同比</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const { code, name, ...metric } = row
                  return (
                    <tr key={code} className={cn('border-b border-border/60', i % 2 === 1 && 'bg-muted/30')}>
                      <td className="px-3 py-2 text-left text-sm font-medium text-foreground">{name}</td>
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
      </CardContent>
    </Card>
  )
}
