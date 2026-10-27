import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useFormModel, useFormValue, ModelFormFields } from '@/components/forms/form-model'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'

/**
 * 会话失效同页重新认证（FE-02）。
 *
 * - API 层确认刷新令牌失效后置 reauthRequired，本对话框收集当前账号密码重新登录，
 *   不先登出、不整页跳转，因此页面与表单输入保持原样；
 * - 登录成功且账号 ID 与失效前一致（仅同一稳定账号可恢复）：只更新令牌与资料；
 * - 账号 ID 变化（含同名账号重建）：整页跳转首页，丢弃当前页面数据与未保存输入；
 * - 不可通过 Esc/遮罩关闭：必须重新登录或明确退出；退出为整页离开，本页未保存输入不保留；
 * - 不自动重放失效期间的写请求，只重试已失败的只读查询；
 * - 整页刷新/关闭标签页后内存输入无法恢复（不新增敏感持久化）。
 */
export function SessionExpiredDialog() {
  const reauthRequired = useAuthStore((s) => s.reauthRequired)
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const model = useFormModel({ password: '' as string, captcha: '' as string }, { password: '请输入密码' })
  const [password, setPassword] = useFormValue(model, 'password')
  const [captcha, setCaptcha] = useFormValue(model, 'captcha')
  const [captchaId, setCaptchaId] = useState('')
  const [captchaSvg, setCaptchaSvg] = useState('')
  const [captchaVisible, setCaptchaVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  // 进入/离开失效态都重置输入：不保留已输入的密码
  useEffect(() => {
    model.form.reset({ password: '', captcha: '' })
    setCaptchaVisible(false)
    setCaptchaId('')
    setCaptchaSvg('')
    if (!reauthRequired) setLeaving(false)
  }, [reauthRequired, model.form])

  const refreshCaptcha = async () => {
    try {
      const result = await api.getCaptcha()
      setCaptchaId(result.captchaId)
      setCaptchaSvg(result.svg)
    } catch {
      setCaptchaId('')
      setCaptchaSvg('')
    }
  }

  const submit = model.submit(async () => {
    if (!user) return
    model.form.clearErrors('root')
    if (captchaVisible && !captcha.trim()) {
      model.form.setError('captcha', { message: '请输入验证码' })
      return
    }
    try {
      const response = await api.login({ username: user.username, password, captchaId, captcha, rememberMe: false })
      if (response.user.id !== user.id) {
        // 账号变化：当前页面可能仍显示原账号数据与未保存内容，整页跳转以彻底丢弃
        useAuthStore.getState().login(response.user, response.accessToken, response.refreshToken)
        window.location.assign('/')
        return
      }
      const scopeChanged =
        user.dataScope !== response.user.dataScope ||
        JSON.stringify(user.permissions) !== JSON.stringify(response.user.permissions)
      useAuthStore.getState().reauthenticate(response.user, response.accessToken, response.refreshToken)
      if (scopeChanged) {
        // 同账号在失效期间被调整权限/数据范围：清掉旧缓存，避免降权后仍显示原范围数据
        void queryClient.resetQueries()
      } else {
        // 只重取已失败的只读查询；失效期间的写请求不自动重放
        void queryClient.refetchQueries({ predicate: (query) => query.state.status === 'error', type: 'active' })
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 428) {
        setCaptcha('')
        setCaptchaVisible(true)
        void refreshCaptcha()
        return
      }
      if (captchaVisible) {
        setCaptcha('')
        void refreshCaptcha()
      }
      model.form.setError('root', { message: cause instanceof Error ? cause.message : '重新登录失败，请重试' })
    }
  })

  const handleLeave = async () => {
    if (leaving || model.pending) return
    setLeaving(true)
    model.form.reset({ password: '', captcha: '' })
    try {
      await api.logout()
    } catch {
      /* 令牌已失效：仍允许本地退出 */
    } finally {
      useAuthStore.getState().logout()
      // 明确离开：整页跳转登录页，本页未保存输入不保留
      window.location.assign('/login')
    }
  }

  return (
    <Dialog
      open={reauthRequired}
      busy
      onOpenChange={() => {
        /* 必须明确选择“重新登录”或“退出登录”，不接受 Esc/遮罩的模糊关闭 */
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>登录状态已过期</DialogTitle>
          <DialogDescription>
            为保护本页填写内容，页面不会刷新。请为当前账号
            {user ? `「${user.name}（${user.username}）」` : ''}
            重新输入密码。重新登录后，失效期间未完成的保存不会自动重放，请确认结果后再操作。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ModelFormFields model={model}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reauth-password">密码</Label>
                <Input
                  id="reauth-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入当前账号密码"
                />
              </div>
              {captchaVisible && (
                <div className="space-y-1.5">
                  <Label htmlFor="reauth-captcha">验证码</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="reauth-captcha"
                      name="captcha"
                      value={captcha}
                      onChange={(event) => setCaptcha(event.target.value)}
                      placeholder="请输入验证码"
                      maxLength={8}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => { setCaptcha(''); void refreshCaptcha() }}
                      aria-label="刷新验证码"
                      title="点击刷新验证码"
                      className="h-10 shrink-0 rounded-md border border-border bg-muted px-2"
                      /* 内容来自服务端 svg-captcha，不含用户输入 */
                      dangerouslySetInnerHTML={{ __html: captchaSvg }}
                    />
                  </div>
                </div>
              )}
            </div>
          </ModelFormFields>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={handleLeave} disabled={model.pending || leaving} loading={leaving}>
            退出登录
          </Button>
          <Button onClick={submit} disabled={model.pending || leaving} loading={model.pending}>
            重新登录
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
