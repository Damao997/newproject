import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'

/** 密码规则校验（与后端 assertPasswordRule 一致）：至少 8 位且含字母与数字 */
function validatePassword(password: string): string | null {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return '密码至少 8 位，且需同时包含字母与数字'
  }
  return null
}

interface FieldErrors {
  oldPassword?: string
  newPassword?: string
  confirmPassword?: string
}

interface PasswordFieldProps {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  placeholder: string
  autoComplete: string
  disabled?: boolean
}

/** 密码输入字段：独立可见性切换 + 错误提示 */
function PasswordField({ id, label, value, onChange, error, placeholder, autoComplete, disabled }: PasswordFieldProps) {
  const [show, setShow] = useState(false)
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn('pr-10', error && 'border-destructive focus-visible:ring-destructive')}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => setShow((v) => !v)}
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50"
          aria-label={show ? '隐藏密码' : '显示密码'}
        >
          {show ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="animate-fade-in text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * 修改密码对话框：右上角用户菜单主动改密 + 首次登录强制改密（force 模式不可关闭）。
 * 成功后清除强制改密标志并登出（后端已吊销 refresh token，须重新登录）。
 */
export function ChangePasswordDialog() {
  const { user, passwordDialog, closePasswordDialog, updateUser, logout } = useAuthStore()
  const navigate = useNavigate()
  const { open, force } = passwordDialog

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 每次打开时重置表单
  useEffect(() => {
    if (open) {
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setError(null)
      setFieldErrors({})
    }
  }, [open])

  const submit = async () => {
    // 前置校验：必填 + 强度规则 + 两次一致，避免空表单靠后端报错
    const errors: FieldErrors = {}
    if (!oldPassword) errors.oldPassword = '请输入原密码'
    if (!newPassword) errors.newPassword = '请输入新密码'
    else {
      const pwdError = validatePassword(newPassword)
      if (pwdError) errors.newPassword = pwdError
    }
    if (!confirmPassword) errors.confirmPassword = '请再次输入新密码'
    else if (confirmPassword !== newPassword) errors.confirmPassword = '两次输入的新密码不一致'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setError(null)
    setIsSubmitting(true)
    try {
      // 后端 AuthService.changePassword：校验原密码 → bcrypt 更新 → 吊销 refresh token → 审计
      await api.updatePassword({ oldPassword, newPassword })
      updateUser({ mustChangePassword: false })
      closePasswordDialog()
      window.alert('密码修改成功，请使用新密码重新登录')
      logout()
      navigate('/login')
    } catch (e) {
      setError(e instanceof Error ? e.message : '修改失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      // force 模式不可关闭（防 Esc/遮罩/X 绕过强制改密），仅提交成功或登出时关闭
      onOpenChange={(o) => {
        if (!o && !force) closePasswordDialog()
      }}
    >
      {/* force 模式隐藏右上角 X 关闭按钮（Radix Close 为 DialogContent 直接子 button） */}
      <DialogContent className={cn(force && '[&>button]:hidden')}>
        <DialogHeader>
          <DialogTitle>{force ? '首次登录须修改密码' : '修改密码'}</DialogTitle>
          <DialogDescription>
            {force
              ? '为保障账号安全，首次登录请先修改初始密码后再继续使用'
              : `用户 ${user?.name ?? ''}，修改后需使用新密码重新登录`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <PasswordField
            id="cp-old-password"
            label="原密码"
            value={oldPassword}
            onChange={setOldPassword}
            error={fieldErrors.oldPassword}
            placeholder="请输入当前使用的密码"
            autoComplete="current-password"
            disabled={isSubmitting}
          />
          <PasswordField
            id="cp-new-password"
            label="新密码"
            value={newPassword}
            onChange={setNewPassword}
            error={fieldErrors.newPassword}
            placeholder="至少 8 位，含字母与数字"
            autoComplete="new-password"
            disabled={isSubmitting}
          />
          <PasswordField
            id="cp-confirm-password"
            label="确认新密码"
            value={confirmPassword}
            onChange={setConfirmPassword}
            error={fieldErrors.confirmPassword}
            placeholder="再次输入新密码"
            autoComplete="new-password"
            disabled={isSubmitting}
          />
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="flex animate-fade-in items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          {!force && (
            <Button variant="outline" onClick={closePasswordDialog} disabled={isSubmitting}>
              取消
            </Button>
          )}
          <Button onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                提交中...
              </>
            ) : (
              '确认修改'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
