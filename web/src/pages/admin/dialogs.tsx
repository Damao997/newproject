import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  useCreateRole,
  useUpdateRole,
  useUpdateRolePermissions,
  usePermissions,
  type RoleItem,
} from '@/hooks/api-queries'
import type { User } from '@/types'

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
  const [companyCode, setCompanyCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (mode === 'edit' && user) {
      setUsername(user.username)
      setName(user.name)
      setRole(user.role)
      setCompanyCode(user.dataScope === '全部' || user.dataScope === '*' ? '' : user.dataScope)
      setPassword('')
    } else {
      setUsername('')
      setName('')
      setPassword('')
      setRole('viewer')
      setCompanyCode('')
    }
  }, [open, mode, user])

  const pending = createUser.isPending || updateUser.isPending

  const submit = async () => {
    setError(null)
    try {
      if (mode === 'create') {
        await createUser.mutateAsync({ username, name, password, role, companyCode: companyCode || undefined })
      } else if (user) {
        await updateUser.mutateAsync({ id: user.id, data: { name, role, companyCode: companyCode || null } })
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
            <Label>用户名</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={mode === 'edit'} placeholder="登录用户名" />
          </div>
          <div className="space-y-1">
            <Label>姓名</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="显示名称" />
          </div>
          {mode === 'create' && (
            <div className="space-y-1">
              <Label>初始密码</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 8 位，含字母与数字" />
            </div>
          )}
          <div className="space-y-1">
            <Label>角色</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue placeholder="选择角色" /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.code} value={r.code}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>数据范围（公司编码，留空为按角色/全部）</Label>
            <Input value={companyCode} onChange={(e) => setCompanyCode(e.target.value)} placeholder="如 CO330059" />
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
    setError(null)
    try {
      if (mode === 'create') {
        await createRole.mutateAsync({ code, name, description })
      } else if (role) {
        await updateRole.mutateAsync({ id: role.id, data: { name, description } })
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
            <Label>角色编码</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={mode === 'edit'} placeholder="如 auditor" />
          </div>
          <div className="space-y-1">
            <Label>角色名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 审计员" />
          </div>
          <div className="space-y-1">
            <Label>描述</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="角色说明" />
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
      setError(e instanceof Error ? e.message : '保存失败（预置角色权限只读）')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>权限配置 · {role?.name}</DialogTitle>
          <DialogDescription>
            {role?.isSystem ? '预置角色权限只读，保存将被后端拒绝' : '勾选该角色拥有的权限项'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {grouped.map(([mod, perms]) => (
            <div key={mod} className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">{mod}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {perms.map((p) => {
                  const key = permKey(p)
                  return (
                    <label key={key} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} disabled={role?.isSystem} />
                      <span className="font-mono">{p.resource}:{p.action}</span>
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
          <Button onClick={save} disabled={updatePerms.isPending || role?.isSystem}>
            {updatePerms.isPending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
