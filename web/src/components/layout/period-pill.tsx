import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Calendar, ChevronDown } from 'lucide-react'
import { useAvailablePeriods } from '@/hooks/api-queries'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HeaderFilterPanel } from './header-filter-panel'

export function PeriodPill() {
  const query = useAvailablePeriods()
  const period = usePeriodStore(s => s.period)
  const fiscalYear = usePeriodStore(s => s.fiscalYear)
  const [open, setOpen] = useState(false)
  const [browsedYear, setBrowsedYear] = useState<string | null>(null)
  const data = query.data
  const periods = data?.periods ?? []
  const fiscalYears = data?.fiscalYears ?? []
  const startMonth = data?.fiscalStartMonth ?? 1
  const findYear = useCallback((value: string) => data?.fiscalYears.find(year => filterPeriodsByFiscalYear([value], year, data.fiscalStartMonth).length > 0) ?? null, [data])
  const commit = (value: string) => { usePeriodStore.getState().setRange(findYear(value), value); setOpen(false) }
  useEffect(() => {
    if (!data || query.isPending || query.isError) return
    const latest = data.periods.at(-1) ?? null
    const latestRequested = usePreferencesStore.getState().latestPending
    const current = usePeriodStore.getState()
    if (latestRequested || !current.period || !data.periods.includes(current.period)) {
      const currentMonths = filterPeriodsByFiscalYear(data.periods, current.fiscalYear, data.fiscalStartMonth)
      const next = latestRequested ? latest : currentMonths.at(-1) ?? latest
      usePeriodStore.getState().setRange(next ? findYear(next) : null, next)
    } else if (findYear(current.period) !== current.fiscalYear) usePeriodStore.getState().setRange(findYear(current.period), current.period)
    usePreferencesStore.setState({ latestPending: false })
  }, [data, findYear, query.isError, query.isPending])
  const changeOpen = useCallback((next: boolean) => { if (next) setBrowsedYear(usePeriodStore.getState().fiscalYear); setOpen(next) }, [])
  const year = browsedYear ?? fiscalYear ?? fiscalYears[0] ?? null
  const baseYear = Number(year?.replace(/^FY/, ''))
  const months = Array.from({ length: 12 }, (_, offset) => {
    const month = (startMonth - 1 + offset) % 12 + 1
    const calendarYear = baseYear + Math.floor((startMonth - 1 + offset) / 12)
    return { value: calendarYear + '-' + String(month).padStart(2, '0'), label: month + '月', year: calendarYear }
  })
  const index = period ? periods.indexOf(period) : -1
  const label = period ? period.replace('-', '年') + '月' : query.isPending ? '期间加载中' : '选择期间'
  return <HeaderFilterPanel open={open} onOpenChange={changeOpen} title="选择期间"
    trigger={<button type="button" aria-label="选择期间" aria-expanded={open} className="header-filter-trigger header-period-trigger"><Calendar className="h-4 w-4" /><span>{label}</span><ChevronDown className="h-3.5 w-3.5" /></button>}
    footer={<><div className="flex gap-1"><Button variant="ghost" size="sm" aria-label="上一有数据期间" disabled={query.isError || index <= 0} onClick={() => commit(periods[index - 1])}><ArrowLeft className="h-4 w-4" /></Button>
      <Button variant="ghost" size="sm" aria-label="下一有数据期间" disabled={query.isError || index < 0 || index >= periods.length - 1} onClick={() => commit(periods[index + 1])}><ArrowRight className="h-4 w-4" /></Button></div>
      <Button size="sm" variant="outline" disabled={!periods.length || query.isError} onClick={() => commit(periods[periods.length - 1])}>最新期间</Button></>}>
    {query.isPending ? <p role="status">正在加载期间…</p> : query.isError ? <div role="alert"><p>期间加载失败，已保留当前选择</p><Button variant="outline" size="sm" onClick={() => { void query.refetch() }}>重试</Button></div>
      : !fiscalYears.length ? <p className="text-sm text-muted-foreground">暂无可用期间，请先导入并激活数据</p> : <>
      <div className="flex items-center gap-3"><span className="text-sm text-muted-foreground">所属财年</span><Select value={year ?? ''} onValueChange={setBrowsedYear}>
        <SelectTrigger aria-label="浏览财年" className="h-9 flex-1"><SelectValue /></SelectTrigger><SelectContent>{fiscalYears.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
      <div className="period-month-grid">{months.map(month => <button type="button" key={month.value} aria-label={month.year + '年' + month.label} aria-pressed={period === month.value}
        disabled={!periods.includes(month.value)} className={'period-month ' + (period === month.value ? 'is-selected' : '')} onClick={() => commit(month.value)}>
        <span>{month.label}</span><small>{month.year}</small></button>)}</div>
      <p className="text-xs text-muted-foreground">财年从 {startMonth} 月开始 · 灰色月份暂无数据</p>
    </>}
  </HeaderFilterPanel>
}
