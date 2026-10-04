import { useCallback, useEffect, useRef, useState } from 'react'
import { Building2, ChevronDown, Search, Star, X } from 'lucide-react'
import { useCompanies } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { usePeriodStore } from '@/stores/periodStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { resolveExclusiveCompanies } from '@/hooks/use-exclusive-company-filter'
import { HeaderFilterPanel } from './header-filter-panel'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { message } from 'antd'
import type { InputRef } from 'antd'

export function CompanyPill({ selectionMode = 'multiple' }: { selectionMode?: 'single' | 'multiple' }) {
  const single = selectionMode === 'single'
  const query = useCompanies()
  const { getDisplayName: getName } = useCompanyDisplayName()
  const selected = usePeriodStore(s => s.companyCodes) ?? []
  const preferences = usePreferencesStore(s => s.preferences)
  const saving = usePreferencesStore(s => s.saving)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const searchRef = useRef<InputRef>(null)
  const companies = query.data ?? []
  const changeOpen = useCallback((next: boolean) => {
    if (next) { const current = usePeriodStore.getState().companyCodes ?? []; setDraft(single && current.length > 1 ? [] : current); setSearch(''); setNotice(single ? '请选择一个单体公司或汇总主体，应用后生效' : null) }
    setOpen(next)
  }, [single])
  useEffect(() => {
    if (!query.data) return
    const codes = usePeriodStore.getState().companyCodes
    if (codes?.some(code => !query.data.some(company => company.code === code))) {
      usePeriodStore.getState().setCompanyCodes(codes.filter(code => query.data.some(company => company.code === code)))
    }
  }, [query.data])
  useEffect(() => { if (!open) return; const timer = setTimeout(() => searchRef.current?.focus(), 50); return () => clearTimeout(timer) }, [open])
  const change = (next: string[]) => {
    if (single) { setDraft(next.slice(-1)); setNotice(null); return }
    const result = resolveExclusiveCompanies({ companies, prev: draft, next })
    setDraft(result.next); setNotice(result.notice)
  }
  const favorite = async (code: string) => {
    setNotice(null)
    const current = usePreferencesStore.getState().preferences.favoriteCompanies
    try { await usePreferencesStore.getState().save({ favoriteCompanies: current.includes(code) ? current.filter(c => c !== code) : [...current, code] }) }
    catch (cause) { const text = cause instanceof Error ? cause.message : '常用公司保存失败，请重试'; setNotice(text); message.error(text) }
  }
  const filtered = companies.filter(company => [company.name, company.shortName, company.code].some(value => value?.toLowerCase().includes(search.trim().toLowerCase())))
  const groups = [
    { label: '常用公司', rows: filtered.filter(company => preferences.favoriteCompanies.includes(company.code)) },
    { label: '单体公司', rows: filtered.filter(company => company.type === 'entity' && !preferences.favoriteCompanies.includes(company.code)) },
    { label: '汇总主体', rows: filtered.filter(company => company.type === 'summary' && !preferences.favoriteCompanies.includes(company.code)) },
  ]
  const label = selected.length === 0 ? (single ? '默认主体' : '全部可见公司') : selected.length === 1 ? getName(selected[0]) : selected.length + ' 家公司'
  return <HeaderFilterPanel open={open} onOpenChange={changeOpen} title="选择公司范围"
    trigger={<button type="button" className="header-filter-trigger" aria-label="选择公司范围" aria-expanded={open} title={label}><Building2 className="h-4 w-4" /><span className="truncate">{label}</span><ChevronDown className="h-3.5 w-3.5" /></button>}
    footer={<><span className="text-xs text-muted-foreground">{draft.length ? '已选 ' + draft.length + ' 家' : '全部授权范围'}</span><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => changeOpen(false)}>取消</Button><Button size="sm" disabled={query.isPending || query.isError || !companies.length || (single && draft.length !== 1)} onClick={() => {
      usePeriodStore.getState().setCompanyCodes(draft.filter(code => companies.some(c => c.code === code))); changeOpen(false)
    }}>应用</Button></div></>}>
    <div className="space-y-3"><Input ref={searchRef} aria-label="搜索公司" placeholder="搜索名称、简称或编码" value={search} className="h-9"
      prefix={<Search className="h-4 w-4" />} onChange={event => setSearch(event.target.value)}
      suffix={search && <button type="button" aria-label="清除公司搜索" className="p-1 text-muted-foreground hover:text-foreground" onClick={() => { setSearch(''); searchRef.current?.focus() }}><X className="h-3.5 w-3.5" /></button>} />
      {!single && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={query.isPending || query.isError} onClick={() => change(companies.filter(c => c.type === 'entity').map(c => c.code))}>全选单体公司</Button>
        <Button size="sm" variant="ghost" onClick={() => change([])}>全部可见公司</Button></div>}
      <p className="text-xs text-muted-foreground">{draft.length ? draft.map(code => getName(code)).join('、') : single ? '尚未选择主体' : '当前不限制公司，展示全部授权范围'}</p>
      {notice && <p role="status" className="rounded-xl bg-muted p-3 text-sm">{notice}</p>}
    </div>
    <div className="company-option-list">
      {query.isPending ? <p role="status">正在加载公司…</p> : query.isError ? <div role="alert"><p>公司加载失败</p><Button variant="outline" size="sm" onClick={() => { void query.refetch() }}>重试</Button></div>
      : !companies.length ? <p className="text-sm text-muted-foreground">暂无可选公司</p> : !filtered.length ? <p className="text-sm text-muted-foreground">没有匹配的公司，请尝试简称或编码</p>
      : groups.filter(group => group.rows.length).map(group => <section key={group.label}><h3 className="company-group-label">{group.label}</h3>{group.rows.map(company => <div key={company.code} className={'company-option ' + (draft.includes(company.code) ? 'is-selected' : '')}>
        {single ? <label className="analysis-company-radio"><input type="radio" name="analysis-company" checked={draft.includes(company.code)} onChange={() => change([company.code])} /><span><span className="company-option-name">{getName(company.code)}</span><span className="company-option-code">{company.code}{company.type === 'summary' ? ' · 汇总' : ''}</span></span></label> : <Checkbox checked={draft.includes(company.code)} onCheckedChange={checked => change(checked ? [...draft, company.code] : draft.filter(code => code !== company.code))}>
          <span className="company-option-name">{getName(company.code)}</span><span className="company-option-code">{company.code}{company.type === 'summary' ? ' · 汇总' : ''}</span>
        </Checkbox>}
        <button type="button" disabled={saving} aria-label={(preferences.favoriteCompanies.includes(company.code) ? '取消常用：' : '设为常用：') + company.name}
          aria-pressed={preferences.favoriteCompanies.includes(company.code)} className="company-favorite" onClick={() => { void favorite(company.code) }}><Star className="h-4 w-4" fill={preferences.favoriteCompanies.includes(company.code) ? 'currentColor' : 'none'} /></button>
      </div>)}</section>)}
    </div>
  </HeaderFilterPanel>
}
