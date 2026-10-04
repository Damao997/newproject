import { useFormModel, useFormValue, ModelFormFields } from '@/components/forms/form-model'
import { useFormClose } from '@/components/forms/form-navigation'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FlashMessage } from '@/components/ui/flash-message'
import {
  Dialog,
  DialogContent, DialogBody,
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
  const model = useFormModel({ password: '' }, {}, z.object({ password: z.string().refine((value) => !validatePassword(value), '密码至少 8 位，且需同时包含字母与数字') }))
  const [password, setPassword] = useFormValue(model, "password")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    model.form.reset({ password: '' })
    setError(null)
  }, [open, user?.id, model.form])

  const submit = async () => {
    if (!user) return
    setError(null)
    try {
      await resetPassword.mutateAsync({ id: user.id, newPassword: password })
      onClose()
      onSuccess?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : '重置失败')
    }
  }

  const formClose = useFormClose({ dirty: model.form.formState.isDirty, busy: model.pending || resetPassword.isPending, enabled: open, onClose: onClose })

  return (
    <><Dialog open={open} busy={model.pending || resetPassword.isPending} onOpenChange={(next) => { if (!next) formClose.requestClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重置密码 · {user?.name}</DialogTitle>
          <DialogDescription>为用户 {user?.username} 设置新密码，重置后其首次登录须修改密码</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4"><ModelFormFields model={model}>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="reset-password">新密码</Label>
              <Input name="password"
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
        </ModelFormFields></DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={formClose.requestClose}>取消</Button>
          <Button onClick={model.submit(submit)} disabled={resetPassword.isPending}>
            {resetPassword.isPending ? '重置中...' : '重置密码'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>{formClose.element}</>
  )
}
