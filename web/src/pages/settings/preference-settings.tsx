import { useEffect, useRef, useState } from 'react'
import { Palette } from 'lucide-react'
import { z } from 'zod'
import { AppForm, FormField, FormSection, FormError, useAppForm } from '@/components/forms/form'
import { useFormNavigation } from '@/components/forms/form-navigation'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { preferenceSchema, type PersonalPreferences } from '@/lib/personal-settings'
import { api, ApiError } from '@/lib/api'
import { APP_THEMES, APP_STYLE_KEYS } from '@/lib/app-theme'
import { HOME_ROUTE_PRIORITY } from '@/lib/permissions'
import { usePermission } from '@/hooks/usePermission'
import { useCompanies } from '@/hooks/api-queries'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { resolveExclusiveCompanies } from '@/hooks/use-exclusive-company-filter'
const schema = preferenceSchema.superRefine((value, context) => {
  if (value.companyStartup === 'fixed' && !value.defaultCompanies.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultCompanies'], message: '请选择默认公司范围' })
})
const routeNames: Record<string, string> = { '/dashboard': '首页看板', '/indicators/operating': '财务指标', '/reports': '报告中心', '/transactions/overview': '往来分析', '/inventory': '存货管理', '/data/browse': '数据浏览', '/admin/users': '用户管理' }
export function PreferenceSettings() {
  const snapshot = usePreferencesStore(s => s.preferences)
  const revision = usePreferencesStore(s => s.revision)
  const storeError = usePreferencesStore(s => s.error)
  const saving = usePreferencesStore(s => s.saving)
  const accountId = usePreferencesStore(s => s.accountId)
  const baseRevision = useRef(revision)
  const form = useAppForm(schema, { defaultValues: snapshot })
  const { reset, formState: { isDirty, isSubmitting } } = form
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [saved, setSaved] = useState(false)
  const { confirm, element } = useConfirm()
  const { permissions } = usePermission()
  const companies = useCompanies()
  const mode = form.watch('companyStartup')
  useFormNavigation(isDirty, isSubmitting)
  useEffect(() => { if (!isDirty) { reset(snapshot); baseRevision.current = revision } }, [snapshot, revision, reset, isDirty])
  const submit = async (values: PersonalPreferences, overrideRevision?: number) => {
    setError(null); setSaved(false); setConflict(false)
    try { const result = await usePreferencesStore.getState().save(values, overrideRevision ?? baseRevision.current); reset(result.preferences); baseRevision.current = result.revision; setSaved(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '设置保存失败，请重试'); setConflict(cause instanceof ApiError && cause.status === 409) }
  }
  const reload = async (discard = false) => {
    if (discard && isDirty && !await confirm({ title: '载入已保存的设置？', description: '将放弃本页未保存的使用习惯。', confirmText: '载入设置' })) return
    try { const result = await api.getPreferences(); if (accountId) usePreferencesStore.getState().install(accountId, result); reset(result.preferences); baseRevision.current = result.revision; setError(null); setConflict(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '设置加载失败，请重试') }
  }
  const choose = (name: keyof PersonalPreferences, label: string, options: [string, string][], hint?: string) =>
    <FormField control={form.control} name={name} label={label} hint={hint}>{field => <Select {...field} value={String(field.value)} onValueChange={value => field.onChange(name === "showShortName" || name === "sidebarCollapsed" ? value === "true" : value)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{options.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent></Select>}</FormField>
  const chooseCompanies = (name: 'favoriteCompanies' | 'defaultCompanies', label: string) =>
    <FormField control={form.control} name={name} label={label} hint={name === 'defaultCompanies' ? '单体公司可多选，汇总主体只能选一个' : '常用公司将在顶栏选择器中置顶'}>
      {field => <div id={field.id} ref={field.ref} tabIndex={-1} role="group" aria-label={label} aria-invalid={field['aria-invalid']} aria-describedby={field['aria-describedby']} className="settings-company-options" onBlur={field.onBlur}>
        {companies.isPending ? <p role="status">正在加载公司…</p> : companies.isError ? <div role="alert"><p>公司加载失败</p><Button variant="outline" size="sm" onClick={() => { void companies.refetch() }}>重试</Button></div> : !companies.data?.length ? <p className="text-muted-foreground">暂无可选公司</p> : companies.data.map(company => {
          const current = field.value as string[]
          return <Checkbox key={company.code} disabled={isSubmitting || saving} checked={current.includes(company.code)} onCheckedChange={checked => {
            const next = checked ? [...current, company.code] : current.filter(code => code !== company.code)
            if (name === 'defaultCompanies') {
              const result = resolveExclusiveCompanies({ companies: companies.data, prev: current, next }); field.onChange(result.next); setError(result.notice)
            } else field.onChange(next)
          }}><span>{company.name}</span><small className="block text-muted-foreground">{company.code}{company.type === 'summary' ? ' · 汇总' : ''}</small></Checkbox>
        })}
      </div>}
    </FormField>
  return <Card className="settings-form-card"><div className="settings-card-heading"><Palette className="h-6 w-6 text-primary" /><div><h2>使用习惯</h2><p>保存后，在其他设备登录也能继续使用</p></div></div>
    <AppForm form={form} id="personal-preferences-form" onSubmit={values => submit(values)}><FormError message={error ?? storeError} />
      {(storeError || conflict || (isDirty && revision !== baseRevision.current)) && <div className="settings-conflict"><p className="text-sm">{conflict || revision !== baseRevision.current ? '已保存设置有更新，你的编辑仍在本页保留。' : '暂时无法同步设置。'}</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={isSubmitting || saving} onClick={() => { void reload(true) }}>重新载入</Button>
        {conflict && <Button size="sm" variant="outline" disabled={isSubmitting || saving} onClick={async () => {
          if (!await confirm({ title: '用本页设置更新？', description: '将以你当前编辑的使用习惯覆盖最新保存设置。', confirmText: '确认重新提交' })) return
          try { const latest = await api.getPreferences(); baseRevision.current = latest.revision; await form.handleSubmit(values => submit(values, latest.revision))() }
          catch (cause) { setError(cause instanceof Error ? cause.message : '读取最新设置失败') }
        }}>确认重新提交</Button>}</div></div>}
      <FormSection title="外观"><FormField control={form.control} name="theme" label="工作台主题">{field => <div className="settings-themes" role="radiogroup" aria-label="工作台主题">{APP_STYLE_KEYS.map(key => <button key={key} type="button" role="radio" aria-checked={field.value === key} tabIndex={field.value === key ? 0 : -1} onKeyDown={event => {
        const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
        if (!offset && event.key !== 'Home' && event.key !== 'End') return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? APP_STYLE_KEYS.length - 1 : (APP_STYLE_KEYS.indexOf(key) + offset + APP_STYLE_KEYS.length) % APP_STYLE_KEYS.length
        field.onChange(APP_STYLE_KEYS[next]); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus()
      }} onBlur={field.onBlur} ref={field.value === key ? field.ref : undefined} disabled={isSubmitting} className={'settings-theme ' + (field.value === key ? 'is-selected' : '')} onClick={() => field.onChange(key)}>
        <span className="settings-theme-preview" style={{ background: APP_THEMES[key].page }}><i style={{ background: APP_THEMES[key].primary }} /><b style={{ background: APP_THEMES[key].surface }} /><em style={{ background: APP_THEMES[key].primary }} /></span><span>{APP_THEMES[key].label}</span>
      </button>)}</div>}</FormField><div className="settings-field-grid">
        {choose('showShortName', '公司名称', [['false', '完整名称'], ['true', '简称']])}
        {choose('sidebarCollapsed', '桌面导航', [['false', '展开'], ['true', '收起']], '手机与小窗口自动适配')}
      </div></FormSection>
      <FormSection title="进入工作台"><div className="settings-field-grid">
        {choose('homePath', '默认入口', [['auto', '自动选择'], ...HOME_ROUTE_PRIORITY.filter(route => permissions.includes(route.resource)).map(route => [route.path, routeNames[route.path]] as [string, string])])}
        {choose('periodStartup', '启动期间', [['remember', '记住本设备上次期间'], ['latest', '最新有数据期间']])}
        {choose('companyStartup', '启动公司范围', [['remember', '记住本设备上次范围'], ['all', '全部可见公司'], ['fixed', '指定公司范围']])}
      </div>{mode === 'fixed' && chooseCompanies('defaultCompanies', '默认公司范围')}</FormSection>
      <FormSection title="数据阅读">{choose('indicatorDensity', '财务指标密度', [['default', '标准'], ['dense', '紧凑'], ['compact', '极简']], '与财务指标页的视图设置保持一致')}</FormSection>
      <FormSection title="常用公司">{chooseCompanies('favoriteCompanies', '置顶公司')}</FormSection>
    </AppForm><div className="settings-save-bar"><span role="status" className="text-sm text-muted-foreground">{isDirty ? '有未保存的修改' : saved ? '设置已保存' : '按账号同步'}</span><div className="flex gap-2"><Button variant="outline" disabled={!isDirty || isSubmitting || saving} onClick={() => { reset(snapshot); setError(null); baseRevision.current = revision }}>还原</Button><Button form="personal-preferences-form" type="submit" disabled={!isDirty || isSubmitting || saving} loading={isSubmitting}>保存设置</Button></div></div>{element}
  </Card>
}
