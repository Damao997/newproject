import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FlashMessage } from '@/components/ui/flash-message'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateUser, useUpdateUser } from '@/hooks/api-queries'
import type { User } from '@/types'
import { DataScopeSelect } from './shared'
import { validatePassword } from './password-validation'

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
