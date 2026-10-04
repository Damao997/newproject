import { useEffect, useRef, useState } from 'react'
import { Controller } from 'react-hook-form'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import { AppForm, FormError, useAppForm } from '@/components/forms/form'
import { useFormClose } from '@/components/forms/form-navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FlashMessage } from '@/components/ui/flash-message'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { validatePassword } from '@/pages/admin/dialogs/password-validation'

const schema = z.object({
  oldPassword: z.string().min(1, '请输入原密码'),
  newPassword: z.string().refine((value) => !validatePassword(value), '密码至少 8 位，且需同时包含字母与数字'),
  confirmPassword: z.string().min(1, '请再次输入新密码'),
}).superRefine((values, context) => {
  if (values.confirmPassword && values.confirmPassword !== values.newPassword)
    context.addIssue({ code: 'custom', path: ['confirmPassword'], message: '两次输入的新密码不一致' })
})
type Values = z.infer<typeof schema>
const defaults: Values = { oldPassword: '', newPassword: '', confirmPassword: '' }

/** 主动改密可放弃；首次登录只能完成改密或退出会话。 */
export function ChangePasswordDialog() {
  const { passwordDialog, closePasswordDialog, updateUser, setTokens, logout } = useAuthStore()
  const { open, force } = passwordDialog
  const form = useAppForm(schema, { defaultValues: defaults })
  const [successFlash, setSuccessFlash] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const logoutLock = useRef(false)
  const busy = form.formState.isSubmitting || loggingOut
  const close = useFormClose({ dirty: form.formState.isDirty, busy, enabled: open && !force, onClose: closePasswordDialog })
  useEffect(() => { if (open) { form.reset(defaults); setSuccessFlash(false) } }, [open, form])
  const submit = async (values: Values) => {
    form.clearErrors('root')
    try {
      const result = await api.updatePassword({ oldPassword: values.oldPassword, newPassword: values.newPassword })
      updateUser({ mustChangePassword: false })
      setTokens(result.accessToken, result.refreshToken)
      form.reset(defaults)
      closePasswordDialog()
      setSuccessFlash(true)
    } catch (error) { form.setError('root', { message: error instanceof Error ? error.message : '修改失败，请稍后重试' }) }
  }
  const handleLogout = async () => {
    if (logoutLock.current || busy) return
    logoutLock.current = true; setLoggingOut(true)
    try { await api.logout() } catch { /* 会话失效时仍允许本地退出。 */ }
    finally { logout() }
  }
  return <>
    <Dialog open={open} busy={busy || force} onOpenChange={(next) => { if (!next && !force) close.requestClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{force ? '首次登录须修改密码' : '修改密码'}</DialogTitle>
          <DialogDescription>{force ? '修改初始密码后继续使用。' : '修改后请使用新密码登录。'}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <AppForm form={form} id="change-password" onSubmit={submit}>
            <div className="space-y-5">
              <PasswordField form={form} name="oldPassword" label="原密码" autoComplete="current-password" />
              <PasswordField form={form} name="newPassword" label="新密码" autoComplete="new-password" hint="至少 8 位，含字母与数字" />
              <PasswordField form={form} name="confirmPassword" label="确认新密码" autoComplete="new-password" />
              <FormError message={form.formState.errors.root?.message} />
            </div>
          </AppForm>
        </DialogBody>
        <DialogFooter>
          {force ? <Button variant="outline" onClick={handleLogout} disabled={busy} loading={loggingOut}>退出登录</Button>
            : <Button variant="outline" onClick={close.requestClose} disabled={busy}>取消</Button>}
          <Button type="submit" form="change-password" loading={form.formState.isSubmitting} disabled={busy}>确认修改</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {close.element}
    {successFlash && <FlashMessage type="success" autoHideMs={3000} onAutoHide={() => setSuccessFlash(false)} className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-md border border-border bg-background px-4 py-2 shadow-md">密码修改成功</FlashMessage>}
  </>
}
function PasswordField({ form, name, label, autoComplete, hint }: {
  form: ReturnType<typeof useAppForm<Values>>; name: keyof Values; label: string; autoComplete: string; hint?: string
}) {
  const [show, setShow] = useState(false)
  const id = 'cp-' + name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())
  return <Controller control={form.control} name={name} render={({ field, fieldState }) => <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input {...field} id={id} className="h-11" type={show ? 'text' : 'password'} autoComplete={autoComplete}
      aria-invalid={!!fieldState.error} aria-describedby={fieldState.error ? id + '-error' : hint ? id + '-hint' : undefined}
      suffix={<button type="button" disabled={form.formState.isSubmitting} onClick={() => setShow(!show)} aria-label={show ? '隐藏密码' : '显示密码'} className="flex h-8 w-8 items-center justify-center rounded-md">{show ? <Eye size={16} /> : <EyeOff size={16} />}</button>} />
    {fieldState.error ? <p id={id + '-error'} className="text-xs text-danger">{fieldState.error.message}</p> : hint && <p id={id + '-hint'} className="text-xs text-muted-foreground">{hint}</p>}
  </div>} />
}
