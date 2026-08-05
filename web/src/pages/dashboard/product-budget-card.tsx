import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useProductBudget } from '@/hooks/api-queries'
import { totalOf } from './budget-total'
import { formatMoneyWan, formatPercent, cn } from '@/lib/utils'
import type { ProductBudgetMetric } from '@/types'

interface ProductBudgetCardProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
  /** 当前主体显示名（标题下说明口径） */
  subjectName?: string
}

/** 金额口径：本月实际 / 本年累计（预算口径随金额口径联动：月度=年度/12，累计=年度总额） */
type AmountMode = 'month' | 'ytd'

/** 达成率红绿灯三档（与 kpi-card 一致）：≥75 达标绿 / 60-75 预警黄 / <60 未达标红；无预算灰 */
function rateColorClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground'
  if (rate >= 75) return 'text-success-strong'
  if (rate >= 60) return 'text-warning-strong'
  return 'text-destructive'
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

/** 达成率单元格：null（无预算）显示 "–" */
function rateText(rate: number | null): string {
  return rate === null ? '–' : formatPercent(rate / 100)
}

const TH_CLS = 'px-3 py-2 text-right text-xs font-medium text-muted-foreground'
const TD_CLS = 'px-3 py-2 text-right font-num text-sm text-foreground'

/**
 * 品类预算达成分析卡（单期间）：收入/毛利品类的预算、本月/累计金额、预算达成率与同比。
 * 切换器：月度/累计（金额口径）；预算口径自动联动（月度=年度预算/12，累计=年度预算）。主体口径跟随看板顶部筛选。
 */
export function ProductBudgetCard({ period, companyCode, subjectName }: ProductBudgetCardProps) {
  const [amountMode, setAmountMode] = useState<AmountMode>('month')
  const { data, isLoading } = useProductBudget({ period, companyCode })
  const rows = data?.rows ?? []
  const isEmpty = !isLoading && rows.length === 0

  // 按当前金额口径取单指标组的展示值：月度金额↔月度预算（年度/12），累计金额↔年度预算
  const displayOf = (m: ProductBudgetMetric) => ({
    budget: amountMode === 'month' ? m.budget / 12 : m.budget,
    amount: amountMode === 'month' ? m.monthActual : m.ytdActual,
    rate: amountMode === 'month' ? m.monthRate : m.ytdRate,
    yoy: amountMode === 'month' ? m.monthYoy : m.ytdYoy,
  })

  return (
    <Card className="animate-fade-in border border-border shadow-sm" style={{ animationDelay: '160ms' }}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-5">
        <div>
          <CardTitle className="text-lg font-semibold text-foreground">品类预算达成分析</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            期间 {data?.period ?? period ?? '—'} · 单位：万元{subjectName ? ` · 主体：${subjectName}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={amountMode} onValueChange={(v) => setAmountMode(v as AmountMode)}>
            <TabsList className="bg-muted p-1">
              <TabsTrigger value="month" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">月度</TabsTrigger>
              <TabsTrigger value="ytd" className="rounded-lg px-3 py-1.5 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">累计</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        {isEmpty ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm font-medium text-foreground">暂无品类数据</p>
            <p className="text-xs text-muted-foreground">导入并激活经营数据后，将按收入/毛利品类展示预算达成情况</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th rowSpan={2} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">品类</th>
                  <th colSpan={4} className="border-l border-border px-3 py-2 text-center text-xs font-semibold text-foreground">收入</th>
                  <th colSpan={4} className="border-l border-border px-3 py-2 text-center text-xs font-semibold text-foreground">毛利</th>
                </tr>
                <tr className="border-b border-border">
                  <th className={TH_CLS}>{amountMode === 'month' ? '月度预算' : '年度预算'}</th>
                  <th className={TH_CLS}>{amountMode === 'month' ? '本月金额' : '累计金额'}</th>
                  <th className={TH_CLS}>预算完成率</th>
                  <th className={TH_CLS}>同比增长</th>
                  <th className={cn(TH_CLS, 'border-l border-border')}>{amountMode === 'month' ? '月度预算' : '年度预算'}</th>
                  <th className={TH_CLS}>{amountMode === 'month' ? '本月金额' : '累计金额'}</th>
                  <th className={TH_CLS}>预算完成率</th>
                  <th className={TH_CLS}>同比增长</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const income = displayOf(row.income)
                  const profit = displayOf(row.profit)
                  return (
                    <tr key={row.category} className={cn('border-b border-border/60', i % 2 === 1 && 'bg-muted/30')}>
                      <td className="px-3 py-2 text-left text-sm font-medium text-foreground">{row.category}</td>
                      <td className={TD_CLS}>{formatMoneyWan(income.budget)}</td>
                      <td className={TD_CLS}>{formatMoneyWan(income.amount)}</td>
                      <td className={cn(TD_CLS, rateColorClass(income.rate))}>{rateText(income.rate)}</td>
                      <td className={TD_CLS}><YoYBadge value={income.yoy} /></td>
                      <td className={cn(TD_CLS, 'border-l border-border/60')}>{formatMoneyWan(profit.budget)}</td>
                      <td className={TD_CLS}>{formatMoneyWan(profit.amount)}</td>
                      <td className={cn(TD_CLS, rateColorClass(profit.rate))}>{rateText(profit.rate)}</td>
                      <td className={TD_CLS}><YoYBadge value={profit.yoy} /></td>
                    </tr>
                  )
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  {(() => {
                    const total = totalOf(rows)
                    const income = displayOf(total.income)
                    const profit = displayOf(total.profit)
                    return (
                      <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                        <td className="px-3 py-2 text-left text-sm font-semibold text-foreground">合计</td>
                        <td className={cn(TD_CLS, 'font-semibold')}>{formatMoneyWan(income.budget)}</td>
                        <td className={cn(TD_CLS, 'font-semibold')}>{formatMoneyWan(income.amount)}</td>
                        <td className={cn(TD_CLS, 'font-semibold', rateColorClass(income.rate))}>{rateText(income.rate)}</td>
                        <td className={cn(TD_CLS, 'font-semibold')}><YoYBadge value={income.yoy} /></td>
                        <td className={cn(TD_CLS, 'border-l border-border/60 font-semibold')}>{formatMoneyWan(profit.budget)}</td>
                        <td className={cn(TD_CLS, 'font-semibold')}>{formatMoneyWan(profit.amount)}</td>
                        <td className={cn(TD_CLS, 'font-semibold', rateColorClass(profit.rate))}>{rateText(profit.rate)}</td>
                        <td className={cn(TD_CLS, 'font-semibold')}><YoYBadge value={profit.yoy} /></td>
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
