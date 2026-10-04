import { Card, CardContent } from '@/components/ui/card'
import { DistributionBar } from '@/components/charts/distribution-bar'
import { AnalysisComparison } from './workspace'
import { useAnalysisWorkspace } from './analysis-context'
import { StatTile } from '@/components/ui/stat-tile'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DeltaTag } from '@/components/ui/delta-tag'
import { AlertLight } from '@/components/ui/alert-light'
import { totalOf } from '@/pages/dashboard/budget-total'
import { formatMoneyWan } from '@/lib/utils'
import type { ProductBudgetMetric } from '@/types'

export function BudgetFocus({ rows, company = false }: { rows: { id: string; label: string; income: ProductBudgetMetric; profit: ProductBudgetMetric; netProfit?: ProductBudgetMetric }[]; company?: boolean }) {
  const workspace = useAnalysisWorkspace()
  const metric = workspace?.state.metric === 'netProfit' && !company ? 'income' : workspace?.state.metric ?? 'income'
  const month = workspace?.state.amountMode !== 'ytd'
  const total = totalOf(rows), group = total[metric] ?? total.income
  const actual = month ? group.monthActual : group.ytdActual
  const budget = month ? group.monthBudget ?? group.budget / 12 : group.ytdBudget
  const rate = month ? group.monthRate : group.ytdCumRate
  const name = metric === 'income' ? '收入' : metric === 'profit' ? '毛利' : '净利润'
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{month ? '本月实际与当月预算比较' : '累计实际与累计预算比较（按月度预算累加）'}</p><Tabs value={metric} onValueChange={value => workspace?.update({ metric: value as 'income' | 'profit' | 'netProfit', selected: '' })}><TabsList variant="segmented"><TabsTrigger value="income">收入</TabsTrigger><TabsTrigger value="profit">毛利</TabsTrigger>{company && <TabsTrigger value="netProfit">净利润</TabsTrigger>}</TabsList></Tabs></div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile label={name + (month ? '本月实际' : '累计实际')} value={formatMoneyWan(actual)} unit="万" tone={1} foot={<span>同比 <DeltaTag value={month ? group.monthYoy : group.ytdYoy} /></span>} />
      <StatTile label={month ? '当月预算' : '累计预算'} value={budget == null ? '—' : formatMoneyWan(budget)} unit="万" tone={2} foot={company ? rows.length + ' 个成员主体' : rows.length + ' 个品类'} />
      <StatTile label="预算差距" value={budget ? formatMoneyWan(actual - budget) : '—'} unit="万" tone={3} foot="实际 − 同口径预算" />
      <StatTile label={month ? '月度预算达成率' : '累计预算达成率'} value={rate == null ? '—' : rate.toFixed(1)} unit={rate == null ? undefined : '%'} tone={4} foot={month ? '实际 ÷ 当月预算' : '实际 ÷ 累计预算（区别于年度完成率）'} />
    </div>
    {!company && <Card><CardContent className="p-6"><div className="analysis-section-head"><h3>预算构成</h3><p>年度预算 · 正预算金额占比 · 单位：万元</p></div><div className="distribution-list max-h-[300px] overflow-auto">{rows.map(row => {
      const value = (row[metric] ?? row.income).budget
      const sum = rows.reduce((sum, row) => sum + Math.max(0, (row[metric] ?? row.income).budget), 0)
      return <DistributionBar key={row.id} variant="ranking" label={row.label} value={formatMoneyWan(value)} width={sum ? Math.max(0, value) / sum * 100 : 0} meta={sum > 0 ? (Math.max(0, value) / sum * 100).toFixed(1) + '%' : '无预算'} />
    })}</div></CardContent></Card>}
    <AnalysisComparison title={company ? '公司预算比较' : '品类预算比较'} note={name + ' · ' + (month ? '月度' : '累计') + ' · 单位：万元 · 点击查看明细'} items={rows.map(row => {
      const g = row[metric] ?? row.income, b = month ? g.monthBudget ?? g.budget / 12 : g.ytdBudget
      const r = month ? g.monthRate : g.ytdCumRate
      return { id: row.id, label: row.label, amount: month ? g.monthActual : g.ytdActual, budget: b, rate: r, detail: <dl><div><dt>本月实际</dt><dd>{formatMoneyWan(g.monthActual)}</dd></div><div><dt>财年累计</dt><dd>{formatMoneyWan(g.ytdActual)}</dd></div><div><dt>年度预算</dt><dd>{formatMoneyWan(g.budget)}</dd></div><div><dt>年度预算完成率</dt><dd>{g.ytdRate == null ? '—' : g.ytdRate.toFixed(1) + '%'}</dd></div><div><dt>累计预算达成率</dt><dd>{g.ytdCumRate == null ? '—' : g.ytdCumRate.toFixed(1) + '%'}</dd></div><div><dt>预警（沿用原规则）</dt><dd><AlertLight rate={r} /></dd></div><div><dt>同期金额</dt><dd>{formatMoneyWan(month ? g.monthSame : g.ytdSame)}</dd></div><div><dt>同比</dt><dd><DeltaTag value={month ? g.monthYoy : g.ytdYoy} /></dd></div></dl> }
    })} />
  </>
}
