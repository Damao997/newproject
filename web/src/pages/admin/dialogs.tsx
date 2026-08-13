import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronDown, Search } from 'lucide-react'
import { FlashMessage } from '@/components/ui/flash-message'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useCreateUser,
  useUpdateUser,
  useResetPassword,
  useCreateRole,
  useUpdateRole,
  useCloneRole,
  useUpdateRolePermissions,
  useUpdateRolePermissionsBatch,
  usePermissions,
  useCompanies,
  type RoleItem,
} from '@/hooks/api-queries'
import { PERMISSION_LABELS, PERMISSION_MODULE_LABELS } from '@/lib/constants'
import { HIGH_RISK_PERMISSIONS } from '@/lib/permissions'
import type { Company, User } from '@/types'

/** 密码规则校验（与后端一致）：至少 8 位且含字母与数字，返回错误文案或 null */
function validatePassword(password: string): string | null {
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
function DataScopeSelect({ value, onChange }: DataScopeSelectProps) {
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

// ==================== 用户新增/编辑 ====================
interface UserDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  user?: User | null
  roles: { code: string; name: string }[]
  onClose: () => void
  /** 保存成功回调（name 为保存后的展示名），页面用于展示成功反馈 */
  onSaved?: (name: string) => void
}

export function UserDialog({ open, mode, user, roles, onClose, onSaved }: UserDialogProps) {
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('viewer')
  const [dataScopeCodes, setDataScopeCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (mode === 'edit' && user) {
      setUsername(user.username)
      setName(user.name)
      setRole(user.role)
      // 优先用后端下发的编码数组；旧数据回退：从 dataScope 展示串解析（'全部'/'无' 视为空）
      if (user.dataScopeCodes && user.dataScopeCodes.length > 0) {
        setDataScopeCodes(user.dataScopeCodes)
      } else if (user.dataScope && !['全部', '无', '*'].includes(user.dataScope)) {
        setDataScopeCodes(user.dataScope.split(',').filter(Boolean))
      } else {
        setDataScopeCodes([])
      }
      setPassword('')
    } else {
      setUsername('')
      setName('')
      setPassword('')
      setRole('viewer')
      setDataScopeCodes([])
    }
  }, [open, mode, user])

  const pending = createUser.isPending || updateUser.isPending

  const submit = async () => {
    // 前置校验：必填项与密码规则，避免空表单提交靠后端报错
    if (mode === 'create') {
      if (!username.trim()) return setError('请输入用户名')
      const pwdError = validatePassword(password)
      if (pwdError) return setError(pwdError)
    } else if (!name.trim()) {
      return setError('请输入姓名')
    }
    setError(null)
    try {
      if (mode === 'create') {
        // 姓名留空时后端默认使用用户名
        await createUser.mutateAsync({ username: username.trim(), name: name.trim() || undefined, password, role, dataScopeCodes })
      } else if (user) {
        await updateUser.mutateAsync({ id: user.id, data: { name: name.trim(), role, dataScopeCodes } })
      }
      onClose()
      onSaved?.(name.trim() || username.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '新增用户' : '编辑用户'}</DialogTitle>
          <DialogDescription>{mode === 'create' ? '创建一个新用户并分配角色' : `编辑 ${user?.username}`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="user-username">用户名</Label>
            <Input id="user-username" value={username} onChange={(e) => setUsername(e.target.value)} disabled={mode === 'edit'} placeholder="登录用户名" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-name">姓名</Label>
            <Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="显示名称" />
          </div>
          {mode === 'create' && (
            <div className="space-y-1">
              <Label htmlFor="user-password">初始密码（首次登录后须修改）</Label>
              <Input id="user-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 8 位，含字母与数字" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="user-role">角色</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="user-role"><SelectValue placeholder="选择角色" /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.code} value={r.code}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>数据范围（可多选单体公司，留空为按角色默认；汇总主体按成员全有或全无自动推导）</Label>
            <DataScopeSelect value={dataScopeCodes} onChange={setDataScopeCodes} />
          </div>
          {error && <FlashMessage type="error">{error}</FlashMessage>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={pending}>{pending ? '保存中...' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ==================== 角色新增/编辑 ====================
interface RoleDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  role?: RoleItem | null
  onClose: () => void
  /** 保存成功回调（name 为保存后的角色名），页面用于展示成功反馈 */
  onSaved?: (name: string) => void
}

export function RoleDialog({ open, mode, role, onClose, onSaved }: RoleDialogProps) {
  const createRole = useCreateRole()
  const updateRole = useUpdateRole()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (mode === 'edit' && role) {
      setCode(role.code)
      setName(role.name)
      setDescription(role.description ?? '')
    } else {
      setCode('')
      setName('')
      setDescription('')
    }
  }, [open, mode, role])

  const pending = createRole.isPending || updateRole.isPending

  const submit = async () => {
    // 前置校验：编码/名称必填
    if (mode === 'create' && !code.trim()) return setError('请输入角色编码')
    if (!name.trim()) return setError('请输入角色名称')
    setError(null)
    try {
      if (mode === 'create') {
        await createRole.mutateAsync({ code: code.trim(), name: name.trim(), description })
      } else if (role) {
        await updateRole.mutateAsync({ id: role.id, data: { name: name.trim(), description } })
      }
      onClose()
      onSaved?.(name.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '新增角色' : '编辑角色'}</DialogTitle>
          <DialogDescription>{mode === 'create' ? '创建自定义角色（非系统预置）' : `编辑 ${role?.name}`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="role-code">角色编码</Label>
            <Input id="role-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={mode === 'edit'} placeholder="如 auditor" />
            {mode === 'create' && <p className="text-xs text-muted-foreground">字母/数字/下划线，创建后不可修改</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-name">角色名称</Label>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 审计员" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-description">描述</Label>
            <Input id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="角色说明" />
          </div>
          {error && <FlashMessage type="error">{error}</FlashMessage>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={pending}>{pending ? '保存中...' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
function PermissionMatrix({ perms, selected, onToggle, onSetAll, locked = false }: PermissionMatrixProps) {
  const [keyword, setKeyword] = useState('')
  const permKey = (p: { resource: string; action: string }) => `${p.resource}#${p.action}`

  const allKeys = useMemo(() => perms.map(permKey), [perms])
  const totalCount = perms.length
  const selectedCount = selected.size
  const highRiskSelected = useMemo(
    () => perms.filter((p) => HIGH_RISK_PERMISSIONS.includes(p.resource) && selected.has(permKey(p))).length,
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
                      {HIGH_RISK_PERMISSIONS.includes(p.resource) && (
                        <Badge variant="destructive" className="px-1 py-0 text-[10px] leading-4">高危</Badge>
                      )}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">{p.resource}</span>
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

// ==================== 角色权限编辑 ====================
interface PermissionDialogProps {
  open: boolean
  role?: RoleItem | null
  onClose: () => void
  /** 保存成功回调（name 为角色名），页面用于展示成功反馈 */
  onSaved?: (name: string) => void
}

interface PermItem {
  id: string
  resource: string
  action: string
}

export function PermissionDialog({ open, role, onClose, onSaved }: PermissionDialogProps) {
  const { data: allPerms } = usePermissions()
  const updatePerms = useUpdateRolePermissions()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const { confirm, element: confirmElement } = useConfirm()

  // 系统失管保护：superadmin 角色权限集固定为全量，前后端均禁止修改；其余角色（含预置）可编辑
  const locked = role?.code === 'superadmin'
  const perms = useMemo(() => (allPerms ?? []) as PermItem[], [allPerms])

  const permKey = (p: { resource: string; action: string }) => `${p.resource}#${p.action}`

  useEffect(() => {
    if (!open || !role) return
    setError(null)
    setSelected(new Set((role.permissions ?? []).map(permKey)))
  }, [open, role])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** 批量勾选/取消：用于模块内全选清除与全局全选全不选 */
  const setAll = (keys: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (checked) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  const save = async () => {
    if (!role) return
    setError(null)
    const permissions = perms
      .filter((p) => selected.has(permKey(p)))
      .map((p) => ({ resource: p.resource, action: p.action }))
    // 高危权限汇总确认：相比原角色新增的高危项需二次确认后再提交（勾选时不打断）
    if (!locked) {
      const origin = new Set((role.permissions ?? []).map(permKey))
      const newHighRisk = perms.filter(
        (p) => HIGH_RISK_PERMISSIONS.includes(p.resource) && selected.has(permKey(p)) && !origin.has(permKey(p)),
      )
      if (newHighRisk.length > 0) {
        const names = newHighRisk.map((p) => PERMISSION_LABELS[p.resource] ?? p.resource).join('、')
        const ok = await confirm({
          title: '确认授予高危权限',
          description: `角色「${role.name}」将新增 ${newHighRisk.length} 项高危权限：${names}。高危权限可导致数据不可恢复操作，确认授予？`,
          danger: true,
          confirmText: '确认授予',
        })
        if (!ok) return
      }
    }
    try {
      await updatePerms.mutateAsync({ roleId: role.id, permissions })
      onClose()
      onSaved?.(role.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>权限配置 · {role?.name}</DialogTitle>
            <DialogDescription>
              {locked ? '超级管理员角色固定拥有全部权限，不可修改' : '勾选该角色拥有的权限项，支持按模块批量操作'}
            </DialogDescription>
          </DialogHeader>
          <PermissionMatrix perms={perms} selected={selected} onToggle={toggle} onSetAll={setAll} locked={locked} />
          {error && <FlashMessage type="error">{error}</FlashMessage>}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={save} disabled={updatePerms.isPending || locked}>
              {updatePerms.isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmElement}
    </>
  )
}

// ==================== 角色批量权限（表格视图行选择） ====================
interface BatchPermissionDialogProps {
  open: boolean
  /** 批量目标角色（表格视图中选中的角色列表，不可为空） */
  roles?: RoleItem[] | null
  onClose: () => void
  /** 保存成功回调（names 为角色名列表），页面用于展示成功反馈 */
  onSaved?: (names: string[]) => void
}

export function BatchPermissionDialog({ open, roles, onClose, onSaved }: BatchPermissionDialogProps) {
  const { data: allPerms } = usePermissions()
  const updateBatch = useUpdateRolePermissionsBatch()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const { confirm, element: confirmElement } = useConfirm()

  const perms = useMemo(() => (allPerms ?? []) as PermItem[], [allPerms])
  const permKey = (p: { resource: string; action: string }) => `${p.resource}#${p.action}`

  useEffect(() => {
    if (!open) return
    setError(null)
    setSelected(new Set())
  }, [open])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const setAll = (keys: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (checked) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  const save = async () => {
    if (!roles || roles.length === 0) return
    setError(null)
    const permissions = perms
      .filter((p) => selected.has(permKey(p)))
      .map((p) => ({ resource: p.resource, action: p.action }))
    // 高危权限汇总确认：批量从空集开始勾选，勾选的高危项即新增，需二次确认后再提交
    const highRisk = perms.filter((p) => HIGH_RISK_PERMISSIONS.includes(p.resource) && selected.has(permKey(p)))
    if (highRisk.length > 0) {
      const names = highRisk.map((p) => PERMISSION_LABELS[p.resource] ?? p.resource).join('、')
      const ok = await confirm({
        title: '确认授予高危权限',
        description: `将为 ${roles.length} 个角色批量授予 ${highRisk.length} 项高危权限：${names}。高危权限可导致数据不可恢复操作，确认授予？`,
        danger: true,
        confirmText: '确认授予',
      })
      if (!ok) return
    }
    try {
      await updateBatch.mutateAsync({ roleIds: roles.map((r) => r.id), permissions })
      onClose()
      onSaved?.(roles.map((r) => r.name))
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>批量配置权限</DialogTitle>
            <DialogDescription>为 {roles?.length ?? 0} 个角色设置相同权限集（覆盖原权限），支持按模块批量操作</DialogDescription>
          </DialogHeader>
          {/* 目标角色摘要：前 5 个 + 溢出计数 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">目标角色：</span>
            {roles?.slice(0, 5).map((r) => (
              <Badge key={r.id} variant="secondary">{r.name}</Badge>
            ))}
            {(roles?.length ?? 0) > 5 && <Badge variant="outline">+{roles!.length - 5} 个</Badge>}
          </div>
          <PermissionMatrix perms={perms} selected={selected} onToggle={toggle} onSetAll={setAll} />
          {error && <FlashMessage type="error">{error}</FlashMessage>}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={save} disabled={updateBatch.isPending}>
              {updateBatch.isPending ? '保存中...' : `应用到 ${roles?.length ?? 0} 个角色`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmElement}
    </>
  )
}

// ==================== 角色克隆 ====================
interface CloneRoleDialogProps {
  open: boolean
  role?: RoleItem | null
  onClose: () => void
  /** 克隆成功回调（name 为克隆出的角色名），页面用于展示成功反馈 */
  onSaved?: (name: string) => void
}

export function CloneRoleDialog({ open, role, onClose, onSaved }: CloneRoleDialogProps) {
  const cloneRole = useCloneRole()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setName(role ? `${role.name}-副本` : '')
  }, [open, role])

  const submit = async () => {
    if (!role) return
    if (!name.trim()) return setError('请输入角色名称')
    setError(null)
    try {
      await cloneRole.mutateAsync({ id: role.id, name: name.trim() })
      onClose()
      onSaved?.(name.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : '克隆失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>克隆角色</DialogTitle>
          <DialogDescription>基于「{role?.name}」创建新角色，权限随原角色复制</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="clone-name">角色名称</Label>
            <Input id="clone-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 审计员-副本" autoFocus />
          </div>
          <p className="text-xs text-muted-foreground">角色编码将自动生成</p>
          {error && <FlashMessage type="error">{error}</FlashMessage>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={cloneRole.isPending}>{cloneRole.isPending ? '克隆中...' : '克隆'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ==================== 重置密码 ====================
interface ResetPasswordDialogProps {
  open: boolean
  user?: User | null
  onClose: () => void
  /** 重置成功回调，页面用于展示成功反馈（替代 window.alert） */
  onSuccess?: () => void
}

export function ResetPasswordDialog({ open, user, onClose, onSuccess }: ResetPasswordDialogProps) {
  const resetPassword = useResetPassword()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPassword('')
    setError(null)
  }, [open])

  const submit = async () => {
    if (!user) return
    const pwdError = validatePassword(password)
    if (pwdError) return setError(pwdError)
    setError(null)
    try {
      await resetPassword.mutateAsync({ id: user.id, newPassword: password })
      onClose()
      onSuccess?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : '重置失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重置密码 · {user?.name}</DialogTitle>
          <DialogDescription>为用户 {user?.username} 设置新密码，重置后其首次登录须修改密码</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="reset-password">新密码</Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位，含字母与数字"
              autoFocus
            />
          </div>
          {error && <FlashMessage type="error">{error}</FlashMessage>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={resetPassword.isPending}>
            {resetPassword.isPending ? '重置中...' : '重置密码'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
