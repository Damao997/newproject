import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useProductBudget } from '@/hooks/api-queries'
import { totalOf } from './budget-total'
import { RateBar } from '@/components/ui/rate-bar'
import { AlertLight } from '@/components/ui/alert-light'
import { formatMoneyWan, cn } from '@/lib/utils'
import type { ProductBudgetMetric } from '@/types'

interface ProductBudgetCardProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
  /** 当前主体显示名（标题下说明口径） */
  subjectName?: string
}

/** 金额口径：本月实际 / 本年累计（预算口径随金额口径联动：月度=占比拆分后的当月预算，累计=年度预算总额） */
type AmountMode = 'month' | 'ytd'

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
const TH_CLS = 'px-3 py-2 text-center text-[13px] font-medium text-foreground'
const TD_CLS = 'px-3 py-2 text-right font-num text-sm text-foreground'

/**
 * 品类预算达成内容（综合分析卡「品类预算达成」页，单期间）：收入/毛利品类的预算、本月/累计金额、
 * 预算达成率与同比。切换器：月度/累计（金额口径）；预算口径自动联动（月度=占比拆分后的当月预算，累计=年度预算总额）。
 * 完成率以橙色进度条展示；预警列按达成率红黄绿三档（月度用月度达成率，累计用累计预算口径达成率）。
 * 主体口径跟随看板顶部筛选；外层 Card 由 AnalysisTabsCard 统一提供。
 */
export function ProductBudgetCard({ period, companyCode, subjectName }: ProductBudgetCardProps) {
  const [amountMode, setAmountMode] = useState<AmountMode>('month')
  const { data, isLoading } = useProductBudget({ period, companyCode })
  const rows = data?.rows ?? []
  const isEmpty = !isLoading && rows.length === 0

  // 按当前金额口径取单指标组的展示值：月度金额↔占比拆分后的当月预算（缺失回退年度/12），
  // 累计金额↔年度预算总额；预警口径：月度用月度达成率，累计用累计预算口径达成率
  const displayOf = (m: ProductBudgetMetric) => ({
    budget: amountMode === 'month' ? (m.monthBudget ?? m.budget / 12) : m.budget,
    amount: amountMode === 'month' ? m.monthActual : m.ytdActual,
    same: amountMode === 'month' ? m.monthSame : m.ytdSame,
    rate: amountMode === 'month' ? m.monthRate : m.ytdRate,
    alertRate: amountMode === 'month' ? m.monthRate : m.ytdCumRate,
    yoy: amountMode === 'month' ? m.monthYoy : m.ytdYoy,
  })

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          期间 {data?.period ?? period ?? '—'} · 单位：万元{subjectName ? ` · 当前主体：${subjectName}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={amountMode} onValueChange={(v) => setAmountMode(v as AmountMode)}>
            <TabsList variant="line" className="justify-start">
              <TabsTrigger value="month">月度</TabsTrigger>
              <TabsTrigger value="ytd">累计</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
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
                  <th rowSpan={2} className="px-3 py-2 text-left text-[13px] font-medium text-foreground">品类</th>
                  <th colSpan={6} className="px-3 py-2 text-center text-[13px] font-semibold text-foreground">收入</th>
                  <th colSpan={6} className="px-3 py-2 text-center text-[13px] font-semibold text-foreground">毛利</th>
                </tr>
                <tr className="border-b border-border">
                  <th className={TH_CLS}>{amountMode === 'month' ? '月度预算' : '年度预算'}</th>
                  <th className={TH_CLS}>{amountMode === 'month' ? '本月金额' : '累计金额'}</th>
                  <th className={TH_CLS}>{amountMode === 'month' ? '同期金额' : '同期累计'}</th>
                  <th className={TH_CLS}>预算完成率</th>
                  <th className={TH_CLS}>预警</th>
                  <th className={TH_CLS}>同比增长</th>
                  <th className={cn(TH_CLS, 'border-l border-border')}>{amountMode === 'month' ? '月度预算' : '年度预算'}</th>
                  <th className={TH_CLS}>{amountMode === 'month' ? '本月金额' : '累计金额'}</th>
                  <th className={TH_CLS}>{amountMode === 'month' ? '同期金额' : '同期累计'}</th>
                  <th className={TH_CLS}>预算完成率</th>
                  <th className={TH_CLS}>预警</th>
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
                      <td className={cn(TD_CLS, 'text-muted-foreground')}>{formatMoneyWan(income.same)}</td>
                      <td className={TD_CLS}><RateBar rate={income.rate} /></td>
                      <td className={cn(TD_CLS, 'text-center')}><AlertLight rate={income.alertRate} /></td>
                      <td className={TD_CLS}><YoYBadge value={income.yoy} /></td>
                      <td className={cn(TD_CLS, 'border-l border-border/60')}>{formatMoneyWan(profit.budget)}</td>
                      <td className={TD_CLS}>{formatMoneyWan(profit.amount)}</td>
                      <td className={cn(TD_CLS, 'text-muted-foreground')}>{formatMoneyWan(profit.same)}</td>
                      <td className={TD_CLS}><RateBar rate={profit.rate} /></td>
                      <td className={cn(TD_CLS, 'text-center')}><AlertLight rate={profit.alertRate} /></td>
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
                        <td className={cn(TD_CLS, 'font-semibold text-muted-foreground')}>{formatMoneyWan(income.same)}</td>
                        <td className={TD_CLS}><RateBar rate={income.rate} /></td>
                        <td className={cn(TD_CLS, 'text-center')}><AlertLight rate={income.alertRate} /></td>
                        <td className={cn(TD_CLS, 'font-semibold')}><YoYBadge value={income.yoy} /></td>
                        <td className={cn(TD_CLS, 'border-l border-border/60 font-semibold')}>{formatMoneyWan(profit.budget)}</td>
                        <td className={cn(TD_CLS, 'font-semibold')}>{formatMoneyWan(profit.amount)}</td>
                        <td className={cn(TD_CLS, 'font-semibold text-muted-foreground')}>{formatMoneyWan(profit.same)}</td>
                        <td className={TD_CLS}><RateBar rate={profit.rate} /></td>
                        <td className={cn(TD_CLS, 'text-center')}><AlertLight rate={profit.alertRate} /></td>
                        <td className={cn(TD_CLS, 'font-semibold')}><YoYBadge value={profit.yoy} /></td>
                      </tr>
                    )
                  })()}
                </tfoot>
              )}
            </table>
          </div>
        )}
    </>
  )
}
