import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FlashMessage } from '@/components/ui/flash-message'
import { api } from '@/lib/api'
import { validatePassword } from '@/pages/admin/dialogs/password-validation'

/** 重发冷却（秒），与后端 PasswordResetService RESEND_COOLDOWN_MS 对齐 */
const RESEND_COOLDOWN_SECONDS = 60
/** 验证码有效期提示（分钟），与后端 CODE_TTL_MS 对齐 */
const CODE_TTL_MINUTES = 10
/** 简易邮箱格式校验：仅当用户输入含 @ 时才按邮箱校验（否则按用户名处理） */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface ForgotPasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = 'request' | 'reset' | 'done'

/**
 * 忘记密码弹窗（登录页入口）：
 *   第一步 输入用户名/邮箱 → 申请邮件验证码（防枚举：响应与账号是否存在无关）；
 *   第二步 输入 6 位验证码 + 新密码 → 重置成功后回登录页用新密码登录。
 * 邮箱由管理员在用户管理中维护；未绑定邮箱的账号请出示错误提示引导联系管理员。
 */
export function ForgotPasswordDialog({ open, onOpenChange }: ForgotPasswordDialogProps) {
  const [step, setStep] = useState<Step>('request')
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [identifierError, setIdentifierError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)

  // 打开时重置全部状态（关闭 → 再开回到第一步）
  useEffect(() => {
    if (!open) return
    setStep('request')
    setIdentifier('')
    setCode('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    setIdentifierError(null)
    setCodeError(null)
    setNewPasswordError(null)
    setConfirmError(null)
    setResendIn(0)
  }, [open])

  // 重发倒计时
  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn((v) => v - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  const validateIdentifier = (value: string): string | null => {
    if (!value.trim()) return '请输入用户名或邮箱'
    if (value.includes('@') && !EMAIL_RE.test(value.trim())) return '邮箱格式不正确'
    return null
  }

  /** 第一步 / 重发：申请验证码 */
  const handleRequest = async () => {
    const message = validateIdentifier(identifier)
    setIdentifierError(message)
    if (message) return
    setPending(true)
    setError('')
    try {
      await api.forgotPassword({ identifier: identifier.trim() })
      setStep('reset')
      setResendIn(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  /** 第二步：验证码 + 新密码重置 */
  const handleReset = async () => {
    const codeMessage = /^\d{6}$/.test(code.trim()) ? null : '请输入 6 位数字验证码'
    const newMessage = validatePassword(newPassword)
    const confirmMessage = newPassword === confirmPassword ? null : '两次输入的密码不一致'
    setCodeError(codeMessage)
    setNewPasswordError(newMessage)
    setConfirmError(confirmMessage)
    if (codeMessage || newMessage || confirmMessage) return

    setPending(true)
    setError('')
    try {
      await api.resetPasswordByEmail({ identifier: identifier.trim(), code: code.trim(), newPassword })
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (step === 'request') void handleRequest()
    else if (step === 'reset') void handleReset()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>忘记密码</DialogTitle>
          <DialogDescription>
            {step === 'request' && '输入用户名或邮箱，验证码将发送到账号绑定的邮箱'}
            {step === 'reset' && `验证码已发送至账号绑定邮箱，${CODE_TTL_MINUTES} 分钟内有效`}
            {step === 'done' && '密码已重置'}
          </DialogDescription>
        </DialogHeader>

        {step === 'done' ? (
          <>
            <DialogBody>
              <FlashMessage type="success">
                密码重置成功，请使用新密码登录。为保障安全，该账号的所有登录会话已失效。
              </FlashMessage>
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>返回登录</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <DialogBody className="grid gap-4">
              {error && <FlashMessage type="error">{error}</FlashMessage>}

              <div className="grid gap-1.5">
                <Label htmlFor="fp-identifier">用户名或邮箱</Label>
                <Input
                  id="fp-identifier"
                  placeholder="账号用户名或绑定邮箱"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value)
                    if (identifierError) setIdentifierError(validateIdentifier(e.target.value))
                  }}
                  autoComplete="username"
                  disabled={pending || step === 'reset'}
                  aria-invalid={!!identifierError}
                  aria-describedby={identifierError ? 'fp-identifier-error' : undefined}
                  className={identifierError ? 'border-destructive' : undefined}
                />
                {identifierError && (
                  <p id="fp-identifier-error" className="text-xs text-destructive">{identifierError}</p>
                )}
              </div>

              {step === 'reset' && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="fp-code">邮箱验证码</Label>
                    <div className="flex gap-2">
                      <Input
                        id="fp-code"
                        inputMode="numeric"
                        placeholder="6 位数字验证码"
                        value={code}
                        onChange={(e) => {
                          setCode(e.target.value)
                          if (codeError) setCodeError(/^\d{6}$/.test(e.target.value.trim()) ? null : codeError)
                        }}
                        maxLength={6}
                        disabled={pending}
                        aria-invalid={!!codeError}
                        aria-describedby={codeError ? 'fp-code-error' : undefined}
                        className={`flex-1 ${codeError ? 'border-destructive' : undefined}`}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending || resendIn > 0}
                        onClick={() => void handleRequest()}
                      >
                        {resendIn > 0 ? `${resendIn}s 后重发` : '重新发送'}
                      </Button>
                    </div>
                    {codeError && (
                      <p id="fp-code-error" className="text-xs text-destructive">{codeError}</p>
                    )}
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="fp-new-password">新密码</Label>
                    <Input
                      id="fp-new-password"
                      type="password"
                      placeholder="至少 8 位，含字母与数字"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value)
                        if (newPasswordError) setNewPasswordError(validatePassword(e.target.value))
                      }}
                      autoComplete="new-password"
                      disabled={pending}
                      aria-invalid={!!newPasswordError}
                      aria-describedby={newPasswordError ? 'fp-new-password-error' : undefined}
                      className={newPasswordError ? 'border-destructive' : undefined}
                    />
                    {newPasswordError && (
                      <p id="fp-new-password-error" className="text-xs text-destructive">{newPasswordError}</p>
                    )}
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="fp-confirm-password">确认新密码</Label>
                    <Input
                      id="fp-confirm-password"
                      type="password"
                      placeholder="再次输入新密码"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value)
                        if (confirmError) setConfirmError(e.target.value === newPassword ? null : confirmError)
                      }}
                      autoComplete="new-password"
                      disabled={pending}
                      aria-invalid={!!confirmError}
                      aria-describedby={confirmError ? 'fp-confirm-error' : undefined}
                      className={confirmError ? 'border-destructive' : undefined}
                    />
                    {confirmError && (
                      <p id="fp-confirm-error" className="text-xs text-destructive">{confirmError}</p>
                    )}
                  </div>
                </>
              )}

              {step === 'reset' && (
                <p className="text-xs text-muted-foreground">
                  若未收到邮件，请检查垃圾箱；未绑定邮箱或收不到验证码时请联系管理员。
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" loading={pending}>
                {step === 'request' ? '发送验证码' : '重置密码'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
