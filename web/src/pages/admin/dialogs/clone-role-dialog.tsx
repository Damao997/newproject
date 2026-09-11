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
import { useCloneRole, type RoleItem } from '@/hooks/api-queries'

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
