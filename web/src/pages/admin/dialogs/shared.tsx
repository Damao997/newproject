import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronDown, Search } from 'lucide-react'
import { useCompanies } from '@/hooks/api-queries'
import { PERMISSION_LABELS, PERMISSION_MODULE_LABELS } from '@/lib/constants'
import { isHighRiskPermission } from '@/lib/permissions'
import type { Company } from '@/types'

/** 密码规则校验（与后端一致）：至少 8 位且含字母与数字，返回错误文案或 null */
export function validatePassword(password: string): string | null {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return '密码至少 8 位，且需同时包含字母与数字'
  }
  return null
}

// ==================== 数据范围多选 ====================
interface DataScopeSelectProps {
  value: string[]
  onChange: (codes: string[]) => void
}

/** 数据范围多选下拉：仅列单体公司（汇总主体不可选，其成员全量授权时由后端「全有或全无」自动推导），支持关键字过滤 */
export function DataScopeSelect({ value, onChange }: DataScopeSelectProps) {
  const { data: companiesData } = useCompanies()
  const [keyword, setKeyword] = useState('')

  const isSummary = (c: Company) => (c.entityType ?? (c.type === 'summary' ? 'summary' : 'single')) === 'summary'
  const companies = useMemo(
    () => ((companiesData ?? []) as Company[]).filter((c) => c.status === 'active' && !isSummary(c)),
    [companiesData],
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return companies
    return companies.filter((c) => c.code.toLowerCase().includes(kw) || c.name.toLowerCase().includes(kw))
  }, [companies, keyword])

  const toggle = (code: string) => {
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code])
  }

  const summary = value.length === 0
    ? '按角色默认范围（留空）'
    : value.length <= 2 ? value.join('、') : `${value.slice(0, 2).join('、')} 等 ${value.length} 项`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal">
          <span className={value.length === 0 ? 'text-muted-foreground' : ''}>{summary}</span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
        <Input placeholder="搜索编码或名称..." value={keyword} onChange={(e) => setKeyword(e.target.value)} className="mb-2 h-8" />
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {filtered.map((c) => (
            <label key={c.code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
              <Checkbox checked={value.includes(c.code)} onCheckedChange={() => toggle(c.code)} />
              <span className="font-mono text-xs">{c.code}</span>
              <span className="truncate">{c.name}</span>
            </label>
          ))}
          {filtered.length === 0 && <p className="px-1 py-2 text-sm text-muted-foreground">无匹配公司</p>}
        </div>
        {value.length > 0 && (
          <div className="mt-2 flex justify-end border-t pt-2">
            <Button variant="ghost" size="sm" onClick={() => onChange([])}>清空</Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ==================== 权限选择矩阵（单角色/批量共用） ====================
interface PermissionMatrixProps {
  /** 全部权限清单（未过滤，矩阵内部负责搜索过滤与模块分组） */
  perms: PermItem[]
  selected: Set<string>
  onToggle: (key: string) => void
  onSetAll: (keys: string[], checked: boolean) => void
  /** 只读态（superadmin 锁定）：统计/搜索/勾选展示但禁用 */
  locked?: boolean
}

/** 权限勾选矩阵：已选统计 + 搜索 + 模块分组三态勾选 + 全局/模块批量操作（PermissionDialog 与 BatchPermissionDialog 共用） */
export function PermissionMatrix({ perms, selected, onToggle, onSetAll, locked = false }: PermissionMatrixProps) {
  const [keyword, setKeyword] = useState('')
  const permKey = (p: { resource: string; action: string }) => `${p.resource}#${p.action}`

  const allKeys = useMemo(() => perms.map(permKey), [perms])
  const totalCount = perms.length
  const selectedCount = selected.size
  const highRiskSelected = useMemo(
    () => perms.filter((p) => isHighRiskPermission(p.resource) && selected.has(permKey(p))).length,
    [perms, selected],
  )

  /** 搜索过滤：按中文名 / 权限码 / 操作码匹配，命中才保留 */
  const filteredList = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return perms
    return perms.filter((p) => {
      const label = (PERMISSION_LABELS[p.resource] ?? p.resource).toLowerCase()
      return label.includes(kw) || p.resource.toLowerCase().includes(kw) || p.action.toLowerCase().includes(kw)
    })
  }, [perms, keyword])

  const grouped = useMemo(() => {
    const map = new Map<string, PermItem[]>()
    for (const p of filteredList) {
      const mod = p.resource.split(':')[0]
      if (!map.has(mod)) map.set(mod, [])
      map.get(mod)!.push(p)
    }
    return Array.from(map.entries())
  }, [filteredList])

  /** 模块勾选三态：全选 true / 部分选中 indeterminate / 未选 false */
  const moduleChecked = (modPerms: PermItem[]) => {
    const keys = modPerms.map(permKey)
    const checked = keys.filter((k) => selected.has(k)).length
    if (checked === 0) return false
    return checked === keys.length ? true : ('indeterminate' as const)
  }

  const moduleSelectedCount = (modPerms: PermItem[]) => modPerms.filter((p) => selected.has(permKey(p))).length

  return (
    <div className="space-y-4">
      {/* 工具条：已选统计 + 全局批量 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          已选 <span className="font-num font-medium text-foreground">{selectedCount}</span> / {totalCount} 项
          {highRiskSelected > 0 && (
            <span className="ml-2 text-destructive">含高危 <span className="font-num font-medium">{highRiskSelected}</span> 项</span>
          )}
        </p>
        {!locked && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onSetAll(allKeys, true)}>全选</Button>
            <Button variant="outline" size="sm" onClick={() => onSetAll(allKeys, false)}>全不选</Button>
          </div>
        )}
      </div>
      <div className="relative">
        <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索权限名称或编码..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="h-8 pl-8"
        />
      </div>
      {grouped.map(([mod, modPerms]) => (
        <div key={mod} className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={moduleChecked(modPerms)}
                onCheckedChange={(checked) => onSetAll(modPerms.map(permKey), checked === true)}
                disabled={locked}
              />
              <p className="text-sm font-semibold">{PERMISSION_MODULE_LABELS[mod] ?? mod}</p>
              <span className="font-num text-xs text-muted-foreground">{moduleSelectedCount(modPerms)}/{modPerms.length}</span>
            </div>
            {!locked && (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onSetAll(modPerms.map(permKey), true)}>全选</Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onSetAll(modPerms.map(permKey), false)}>清除</Button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {modPerms.map((p) => {
              const key = permKey(p)
              return (
                <label key={key} className="flex items-start gap-2 text-xs">
                  <Checkbox className="mt-0.5" checked={selected.has(key)} onCheckedChange={() => onToggle(key)} disabled={locked} />
                  <span className="flex flex-col">
                    <span className="flex items-center gap-1">
                      {PERMISSION_LABELS[p.resource] ?? p.resource}
                      {isHighRiskPermission(p.resource) && (
                        <Badge variant="destructive" className="px-1 py-0 text-micro leading-4">高危</Badge>
                      )}
                    </span>
                    <span className="font-mono text-micro text-muted-foreground">{p.resource}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      ))}
      {grouped.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">无匹配权限</p>}
    </div>
  )
}

// ==================== 权限项类型（PermissionDialog / BatchPermissionDialog 共用） ====================
export interface PermItem {
  id: string
  resource: string
  action: string
}
