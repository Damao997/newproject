import { Fragment } from 'react'
import { AnalysisSection, AnalysisComparison, AnalysisFailure } from '@/components/analysis/workspace'
import { useAnalysisWorkspace } from '@/components/analysis/analysis-context'
import { StatTile } from '@/components/ui/stat-tile'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Columns3 } from 'lucide-react'
import { useExpenseAnalysis } from '@/hooks/api-queries'
import { AnalysisPageSkeleton } from '@/components/ui/skeleton-blocks'
import { totalMetrics } from '../budget-total'
import { ExpenseAnalysisCard, EXPENSE_COLUMN_GROUPS, EXPENSE_COLUMN_META } from '../expense-analysis-card'
import { formatMoneyWan } from '@/lib/utils'
import { DeltaTag } from '@/components/ui/delta-tag'
import { ExpenseAlertLight } from '@/components/ui/alert-light'
import { usePageStore } from '@/stores/pageStateStore'

export function ExpenseContent({ period, companyCode }: { period?: string; companyCode?: string }) {
  const workspace = useAnalysisWorkspace(), month = workspace?.state.amountMode !== 'ytd'
  const hiddenExpenseColumns = usePageStore(s => s.dashboard.hiddenExpenseColumns), setDashboard = usePageStore(s => s.setDashboard)
  const { data, isLoading, isError, isPlaceholderData, refetch } = useExpenseAnalysis({ period, companyCode })
  if (isLoading || isPlaceholderData) return <AnalysisPageSkeleton blocks={[160, 320]} />
  if (isError && !data) return <AnalysisFailure title="运营费用加载失败" retry={refetch} />
  const rows = data?.rows ?? [], total = totalMetrics(rows)
  if (!rows.length) return <EmptyState title="暂无运营费用数据" description="请检查当前主体、期间和费用映射" />
  const budget = month ? total.monthBudget ?? total.budget / 12 : total.ytdBudget
  const overBudget = rows.filter(row => (month ? row.monthRate : row.ytdCumRate) != null && (month ? row.monthRate! : row.ytdCumRate!) > 100)
  return <div className="space-y-4">
    {isError && <AnalysisFailure title="费用刷新失败，保留当前内容" retry={refetch} />}
    <AnalysisSection kind="focus">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={month ? '本月费用' : '累计费用'} value={formatMoneyWan(month ? total.monthActual : total.ytdActual)} unit="万" tone={3} foot={<span>同比 <DeltaTag value={month ? total.monthYoy : total.ytdYoy} /></span>} />
        <StatTile label={month ? '当月预算' : '累计预算'} value={budget == null ? '—' : formatMoneyWan(budget)} unit="万" tone={1} foot="按月度预算配置" />
        <StatTile label="年度预算使用率" value={total.ytdRate == null ? '—' : total.ytdRate.toFixed(1)} unit={total.ytdRate == null ? undefined : '%'} tone={2} foot="累计金额 ÷ 年度预算" />
        <StatTile label="超支项目" value={String(overBudget.length)} unit="项" tone={4} foot={month ? '当月预算使用率 > 100%' : '累计预算使用率 > 100%'} />
      </div>
      <AnalysisComparison expense title="费用结构与预算比较" note={(month ? '月度' : '累计') + ' · 金额与同口径预算比较 · 单位：万元'} items={rows.map(row => ({ id: row.code, label: row.name, amount: month ? row.monthActual : row.ytdActual, budget: month ? row.monthBudget ?? row.budget / 12 : row.ytdBudget, rate: month ? row.monthRate : row.ytdCumRate, detail: <dl><div><dt>本月费用</dt><dd>{formatMoneyWan(row.monthActual)}</dd></div><div><dt>财年累计</dt><dd>{formatMoneyWan(row.ytdActual)}</dd></div><div><dt>年度预算</dt><dd>{formatMoneyWan(row.budget)}</dd></div><div><dt>预算使用预警</dt><dd><ExpenseAlertLight rate={month ? row.monthRate : row.ytdCumRate} /></dd></div><div><dt>同比</dt><dd><DeltaTag value={month ? row.monthYoy : row.ytdYoy} /></dd></div><div><dt>月度环比</dt><dd><DeltaTag value={row.monthMom} /></dd></div></dl> }))} />
      {overBudget.length > 0 && <Card><CardContent className="p-6"><h3 className="mb-3 text-base font-semibold">超支项目定位</h3><div className="flex flex-wrap gap-2">{overBudget.map(row => <Button key={row.code} size="sm" variant="outline" onClick={() => workspace?.update({ selected: row.code })}>{row.name}</Button>)}</div><p className="mt-3 text-xs text-muted-foreground">费用使用率超过同口径预算；本页只呈现差距，不推断原因。</p></CardContent></Card>}
    </AnalysisSection>
    <AnalysisSection kind="report">

          <div className="mb-3 flex justify-end">

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Columns3 className="mr-1 h-3.5 w-3.5" /> 列设置
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {EXPENSE_COLUMN_GROUPS.map((group, gi) => (
                  <Fragment key={group.key}>
                    {gi > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="text-xs text-muted-foreground">{group.label}</DropdownMenuLabel>
                    {EXPENSE_COLUMN_META.filter((c) => c.group === group.key).map((col) => (
                      <DropdownMenuCheckboxItem
                        key={col.key}
                        checked={!hiddenExpenseColumns.includes(col.key)}
                        onCheckedChange={(checked) => {
                          const next = checked
                            ? hiddenExpenseColumns.filter((k) => k !== col.key)
                            : [...hiddenExpenseColumns, col.key]
                          // 至少保留一列数据列（全部隐藏则表格仅剩指标名称列，无意义）
                          if (EXPENSE_COLUMN_META.length - next.length === 0) return
                          setDashboard({ hiddenExpenseColumns: next })
                        }}
                      >
                        {col.header}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ExpenseAnalysisCard period={period} companyCode={companyCode} hiddenColumns={hiddenExpenseColumns} />

      </AnalysisSection>
  </div>
}
