import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FlashMessage } from '@/components/ui/flash-message'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateRole, useUpdateRole, type RoleItem } from '@/hooks/api-queries'

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
