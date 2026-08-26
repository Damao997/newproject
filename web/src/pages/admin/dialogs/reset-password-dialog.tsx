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
import { useResetPassword } from '@/hooks/api-queries'
import type { User } from '@/types'
import { validatePassword } from './password-validation'

// ==================== 重置密码 ====================
interface ResetPasswordDialogProps {
  open: boolean
  user?: User | null
  onClose: () => void
  /** 重置成功回调，页面用于展示成功反馈 */
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
