import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { TipLabel } from '@/components/ui/tip-label'
import { useProductBudget } from '@/hooks/api-queries'
import { totalOf } from './budget-total'
import { RateBar } from '@/components/ui/rate-bar'
import { AlertLight } from '@/components/ui/alert-light'
import { DeltaTag } from '@/components/ui/delta-tag'
import { formatMoneyWan, cn } from '@/lib/utils'
import type { ProductBudgetMetric } from '@/types'

interface ProductBudgetCardProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
}

/** 金额口径：本月实际 / 本年累计（预算口径随金额口径联动：月度=占比拆分后的当月预算，累计=年度预算总额） */
type AmountMode = 'month' | 'ytd'

// 表头对齐《统一表格设计标准》：13px/500 黑字居中（数值列表头同样居中）；TD 保持右对齐 font-num
const TH_CLS = 'px-3 py-2 text-center text-body font-medium text-foreground'
const TD_CLS = 'px-3 py-2 text-right font-num text-sm text-foreground'

/**
 * 品类预算达成内容（综合分析卡「品类预算达成」页，单期间）：收入/毛利品类的预算、本月/累计金额、
 * 预算达成率与同比。切换器：月度/累计（金额口径）；预算口径自动联动（月度=占比拆分后的当月预算，累计=年度预算总额）。
 * 完成率以橙色进度条展示；预警列按达成率红黄绿三档（月度用月度达成率，累计用累计预算口径达成率）。
 * 主体口径跟随看板顶部筛选；外层 Card 由 AnalysisTabsCard 统一提供。
 */
export function ProductBudgetCard({ period, companyCode }: ProductBudgetCardProps) {
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
    <TooltipProvider>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={amountMode} onValueChange={(v) => setAmountMode(v as AmountMode)}>
            <TabsList variant="segmented" className="justify-start">
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
            <table className="data-table-report data-table-report--striped">
              <thead>
                <tr className="border-b border-border">
                  <th rowSpan={2} className="text-left w-[10em]">品类</th>
                  <th colSpan={6} className="text-center font-semibold">收入</th>
                  <th colSpan={6} className="text-center font-semibold">毛利</th>
                </tr>
                <tr>
                  <th className={TH_CLS}>{amountMode === 'month' ? '月度预算' : '年度预算'}</th>
                  <th className={TH_CLS}>{amountMode === 'month' ? '本月金额' : '累计金额'}</th>
                  <th className={TH_CLS}>{amountMode === 'month' ? '同期金额' : '同期累计'}</th>
                  <th className={TH_CLS}><TipLabel label="预算完成率" tip="月度=本月金额÷当月预算；累计=累计金额÷年度预算" /></th>
                  <th className={TH_CLS}><TipLabel label="预警" tip="按达成率红黄绿三档：<60 红 / 60-75 黄 / ≥75 绿" /></th>
                  <th className={TH_CLS}><TipLabel label="同比增长" tip="（本期-去年同期）÷去年同期" /></th>
                  <th className={cn(TH_CLS, 'border-l border-border')}>{amountMode === 'month' ? '月度预算' : '年度预算'}</th>
                  <th className={TH_CLS}>{amountMode === 'month' ? '本月金额' : '累计金额'}</th>
                  <th className={TH_CLS}>{amountMode === 'month' ? '同期金额' : '同期累计'}</th>
                  <th className={TH_CLS}><TipLabel label="预算完成率" tip="月度=本月金额÷当月预算；累计=累计金额÷年度预算" /></th>
                  <th className={TH_CLS}><TipLabel label="预警" tip="按达成率红黄绿三档：<60 红 / 60-75 黄 / ≥75 绿" /></th>
                  <th className={TH_CLS}><TipLabel label="同比增长" tip="（本期-去年同期）÷去年同期" /></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const income = displayOf(row.income)
                  const profit = displayOf(row.profit)
                  return (
                    <tr key={row.category}>
                      {/* 品类名单行截断（空格不计入 10 字符判定）：固定 w-[10em] + truncate，Tooltip 悬停显示完整名称 */}
                      <td className="px-3 py-2 text-left text-sm font-medium text-foreground w-[10em]">
                        {row.category.replace(/\s/g, '').length > 10 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block w-[10em] truncate">{row.category}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top">{row.category}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="block w-[10em] truncate">{row.category}</span>
                        )}
                      </td>
                      <td className={TD_CLS}>{formatMoneyWan(income.budget)}</td>
                      <td className={TD_CLS}>{formatMoneyWan(income.amount)}</td>
                      <td className={cn(TD_CLS, 'text-muted-foreground')}>{formatMoneyWan(income.same)}</td>
                      <td className={TD_CLS}><RateBar rate={income.rate} /></td>
                      <td className={cn(TD_CLS, 'text-center')}><AlertLight rate={income.alertRate} /></td>
                      <td className={TD_CLS}><DeltaTag value={income.yoy} /></td>
                      <td className={cn(TD_CLS, 'border-l border-border/60')}>{formatMoneyWan(profit.budget)}</td>
                      <td className={TD_CLS}>{formatMoneyWan(profit.amount)}</td>
                      <td className={cn(TD_CLS, 'text-muted-foreground')}>{formatMoneyWan(profit.same)}</td>
                      <td className={TD_CLS}><RateBar rate={profit.rate} /></td>
                      <td className={cn(TD_CLS, 'text-center')}><AlertLight rate={profit.alertRate} /></td>
                      <td className={TD_CLS}><DeltaTag value={profit.yoy} /></td>
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
                        <td className={cn(TD_CLS, 'font-semibold')}><DeltaTag value={income.yoy} /></td>
                        <td className={cn(TD_CLS, 'border-l border-border/60 font-semibold')}>{formatMoneyWan(profit.budget)}</td>
                        <td className={cn(TD_CLS, 'font-semibold')}>{formatMoneyWan(profit.amount)}</td>
                        <td className={cn(TD_CLS, 'font-semibold text-muted-foreground')}>{formatMoneyWan(profit.same)}</td>
                        <td className={TD_CLS}><RateBar rate={profit.rate} /></td>
                        <td className={cn(TD_CLS, 'text-center')}><AlertLight rate={profit.alertRate} /></td>
                        <td className={cn(TD_CLS, 'font-semibold')}><DeltaTag value={profit.yoy} /></td>
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
