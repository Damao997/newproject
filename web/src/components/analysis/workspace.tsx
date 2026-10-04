import { useAnalysisWorkspace } from './analysis-context'
import { sortComparisons, type ComparisonItem } from './comparison-data'
import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { formatMoneyWan } from '@/lib/utils'
import { defaultAnalysisState, type AnalysisState } from '@/stores/pageStateStore'

/** 原独立组件保持完整报表；经营分析入口首次使用重点视图。 */
export function AnalysisSection({ kind, children }: { kind: 'focus' | 'report'; children: ReactNode }) {
  const workspace = useAnalysisWorkspace()
  if (!workspace && kind === 'focus') return null
  if (workspace && (workspace.state.view === 'focus' ? kind !== 'focus' : kind !== 'report')) return null
  return <div className={kind === 'report' ? 'analysis-report' : undefined} data-analysis-section={kind}>{children}</div>
}
export function AnalysisFailure({ title, retry }: { title: string; retry: () => unknown }) {
  return <div role="alert" className="analysis-failure"><p>{title}</p><Button size="sm" variant="outline" onClick={() => { void retry() }}>重试</Button></div>
}
export function AnalysisModeSwitch() {
  const workspace = useAnalysisWorkspace()
  if (!workspace) return null
  return <Tabs value={workspace.state.amountMode} onValueChange={value => workspace.update({ amountMode: value as 'month' | 'ytd' })}><TabsList variant="segmented"><TabsTrigger value="month">月度</TabsTrigger><TabsTrigger value="ytd">累计</TabsTrigger></TabsList></Tabs>
}
/** 比较行是可聚焦按钮；选中后的数据明细与报表消费同一查询结果。 */
export function AnalysisComparison({ title, items, note, expense = false }: { title: string; items: ComparisonItem[]; note?: string; expense?: boolean }) {
  const workspace = useAnalysisWorkspace()
  const [local, setLocal] = useState(defaultAnalysisState)
  const state = workspace?.state ?? local
  const update = workspace?.update ?? ((patch: Partial<AnalysisState>) => setLocal(previous => ({ ...previous, ...patch })))
  const selectionRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!state.selected) return
    selectionRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [state.selected])
  const filtered = sortComparisons(items.filter(item => item.label.toLocaleLowerCase().includes(state.keyword.trim().toLocaleLowerCase())), state.sort)
  const pages = Math.max(1, Math.ceil(filtered.length / 10)), page = Math.min(Math.max(state.page, 1), pages)
  const selected = items.find(item => item.id === state.selected)
  const maximum = Math.max(1, ...items.flatMap(item => [Math.abs(item.amount), Math.abs(item.budget ?? 0)]))
  return <Card className="analysis-comparison"><CardContent className="p-6">
    <div className="analysis-section-head"><div><h3>{title}</h3><p>{note ?? '单位：万元'}</p></div>
      <div className="analysis-comparison-controls"><Input className="h-9" value={state.keyword} placeholder="搜索名称" aria-label="搜索比较项目" onChange={event => update({ keyword: event.target.value, page: 1 })} />
        <Select value={state.sort} onValueChange={value => update({ sort: value as AnalysisState['sort'], page: 1 })}><SelectTrigger className="h-9 w-[140px]" aria-label="比较排序"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="amount">金额从高到低</SelectItem><SelectItem value="gap">差距从小到大</SelectItem><SelectItem value="rate">达成率从高到低</SelectItem><SelectItem value="name">名称排序</SelectItem></SelectContent></Select>
      </div>
    </div>
    {filtered.length === 0 ? <EmptyState compact title="没有匹配的项目" description="请调整搜索条件" /> : <div className="analysis-comparison-list">
      {filtered.slice((page - 1) * 10, page * 10).map(item => <button type="button" className="analysis-comparison-item" key={item.id} aria-pressed={item.id === state.selected} onClick={() => update({ selected: item.id === state.selected ? '' : item.id })}>
        <span className="analysis-comparison-label">{item.label}</span>
        <span className="analysis-comparison-numbers"><strong>{formatMoneyWan(item.amount)}</strong><span>{item.share != null ? '贡献 ' + item.share.toFixed(1) + '%' : item.rate != null ? (expense || item.expense ? '使用率 ' : '达成率 ') + item.rate.toFixed(1) + '%' : item.budget !== undefined ? '无预算' : '查看明细'}</span></span>
        <span className="analysis-comparison-bars"><span className="analysis-comparison-bar" style={{ width: Math.abs(item.amount) / maximum * 100 + '%', background: item.amount < 0 ? 'hsl(var(--destructive))' : undefined }} />{item.budget != null && <span className="analysis-comparison-budget" style={{ width: Math.abs(item.budget) / maximum * 100 + '%' }} />}</span>
        {item.budget != null && <span className="analysis-comparison-gap">预算 {formatMoneyWan(item.budget)} · 差距 <strong>{formatMoneyWan(item.amount - item.budget)}</strong></span>}
      </button>)}
    </div>}
    <div className="analysis-comparison-footer"><span>{filtered.length} 项{items.some(item => item.budget != null) ? ' · 实色：实际 / 浅色：预算' : ''}</span>{pages > 1 && <div className="flex items-center gap-2"><Button size="sm" variant="ghost" disabled={page === 1} onClick={() => update({ page: page - 1 })}>上一页</Button><span>{page} / {pages}</span><Button size="sm" variant="ghost" disabled={page === pages} onClick={() => update({ page: page + 1 })}>下一页</Button></div>}</div>
    {selected && <section ref={selectionRef} className="analysis-selection" aria-label="选中项目明细"><div className="analysis-section-head"><h4>{selected.label} · 数据明细</h4><Button size="sm" variant="ghost" onClick={() => update({ selected: '' })}>清除选择</Button></div>{selected.detail ?? <p>金额 {formatMoneyWan(selected.amount)} 万元</p>}</section>}
  </CardContent></Card>
}
