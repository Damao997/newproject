import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronDown } from 'lucide-react'
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
  useUpdateRolePermissions,
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

/** 数据范围多选下拉：单体公司 + 汇总主体分组勾选，支持关键字过滤 */
function DataScopeSelect({ value, onChange }: DataScopeSelectProps) {
  const { data: companiesData } = useCompanies()
  const [keyword, setKeyword] = useState('')
  const companies = useMemo(
    () => ((companiesData ?? []) as Company[]).filter((c) => c.status === 'active'),
    [companiesData],
  )

  const isSummary = (c: Company) => (c.entityType ?? (c.type === 'summary' ? 'summary' : 'single')) === 'summary'
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return companies
    return companies.filter((c) => c.code.toLowerCase().includes(kw) || c.name.toLowerCase().includes(kw))
  }, [companies, keyword])
  const groups = [
    { label: '单体公司', items: filtered.filter((c) => !isSummary(c)) },
    { label: '汇总主体', items: filtered.filter(isSummary) },
  ]

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
          {groups.map((g) => g.items.length > 0 && (
            <div key={g.label}>
              <p className="px-1 py-1 text-xs font-semibold text-muted-foreground">{g.label}</p>
              {g.items.map((c) => (
                <label key={c.code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                  <input type="checkbox" checked={value.includes(c.code)} onChange={() => toggle(c.code)} />
                  <span className="font-mono text-xs">{c.code}</span>
                  <span className="truncate">{c.name}</span>
                </label>
              ))}
            </div>
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
}

export function UserDialog({ open, mode, user, roles, onClose }: UserDialogProps) {
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
            <Label>数据范围（可多选单体公司/汇总主体，留空为按角色默认）</Label>
            <DataScopeSelect value={dataScopeCodes} onChange={setDataScopeCodes} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
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
}

export function RoleDialog({ open, mode, role, onClose }: RoleDialogProps) {
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
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-name">角色名称</Label>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 审计员" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-description">描述</Label>
            <Input id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="角色说明" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={pending}>{pending ? '保存中...' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ==================== 角色权限编辑 ====================
interface PermissionDialogProps {
  open: boolean
  role?: RoleItem | null
  onClose: () => void
}

interface PermItem {
  id: string
  resource: string
  action: string
}

export function PermissionDialog({ open, role, onClose }: PermissionDialogProps) {
  const { data: allPerms } = usePermissions()
  const updatePerms = useUpdateRolePermissions()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  // 系统失管保护：superadmin 角色权限集固定为全量，前后端均禁止修改；其余角色（含预置）可编辑
  const locked = role?.code === 'superadmin'

  const permKey = (p: { resource: string; action: string }) => `${p.resource}#${p.action}`

  useEffect(() => {
    if (!open || !role) return
    setError(null)
    setSelected(new Set((role.permissions ?? []).map(permKey)))
  }, [open, role])

  const grouped = useMemo(() => {
    const list = (allPerms ?? []) as PermItem[]
    const map = new Map<string, PermItem[]>()
    for (const p of list) {
      const mod = p.resource.split(':')[0]
      if (!map.has(mod)) map.set(mod, [])
      map.get(mod)!.push(p)
    }
    return Array.from(map.entries())
  }, [allPerms])

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
  const allKeys = useMemo(() => ((allPerms ?? []) as PermItem[]).map(permKey), [allPerms])

  const save = async () => {
    if (!role) return
    setError(null)
    const list = (allPerms ?? []) as PermItem[]
    const permissions = list
      .filter((p) => selected.has(permKey(p)))
      .map((p) => ({ resource: p.resource, action: p.action }))
    try {
      await updatePerms.mutateAsync({ roleId: role.id, permissions })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>权限配置 · {role?.name}</DialogTitle>
          <DialogDescription>
            {locked ? '超级管理员角色固定拥有全部权限，不可修改' : '勾选该角色拥有的权限项，支持按模块批量操作'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!locked && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAll(allKeys, true)}>全选</Button>
              <Button variant="outline" size="sm" onClick={() => setAll(allKeys, false)}>全不选</Button>
            </div>
          )}
          {grouped.map(([mod, perms]) => (
            <div key={mod} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">{PERMISSION_MODULE_LABELS[mod] ?? mod}</p>
                {!locked && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setAll(perms.map(permKey), true)}>全选</Button>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setAll(perms.map(permKey), false)}>清除</Button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {perms.map((p) => {
                  const key = permKey(p)
                  return (
                    <label key={key} className="flex items-start gap-2 text-xs">
                      <input type="checkbox" className="mt-0.5" checked={selected.has(key)} onChange={() => toggle(key)} disabled={locked} />
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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={updatePerms.isPending || locked}>
            {updatePerms.isPending ? '保存中...' : '保存'}
          </Button>
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
}

export function ResetPasswordDialog({ open, user, onClose }: ResetPasswordDialogProps) {
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
      window.alert(`用户「${user.name}」的密码已重置，首次登录须修改密码`)
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
          {error && <p className="text-sm text-destructive">{error}</p>}
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
