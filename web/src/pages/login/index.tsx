import { useFormModel, useFormValue, ModelFormFields } from '@/components/forms/form-model'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import { api } from '@/lib/api'
import { ForgotPasswordDialog } from './forgot-password-dialog'

/** 记住用户名：仅本地保存用户名（凭证不落盘） */
const REMEMBER_KEY = 'login-remembered-username'

/** 演示态文案（v6 设计稿静态截图）：
 *  - demoError: 错误条 demo 文案（点击登录触发真实校验时优先用真实错误覆盖）
 *  - demoHint: 首次登录提示 demo 文案
 * 仅在 URL 携带 ?demo=1 时展示，避免污染真实生产态首屏。 */
const DEMO_ERROR_TEXT = '账号或密码错误，还可重试 4 次（演示态）'
const DEMO_HINT_TEXT = '首次登录或密码过期将被引导到修改密码流程'

export default function LoginPage() {
  const model = useFormModel({ username: '', password: '', rememberMe: false, captcha: '' }, { username: '请输入用户名', password: '请输入密码', captcha: '请输入验证码' })
  const [username, setUsername] = useFormValue(model, 'username')
  const [password, setPassword] = useFormValue(model, 'password')
  const [rememberMe, setRememberMe] = useFormValue(model, 'rememberMe')
  const [captcha, setCaptcha] = useFormValue(model, 'captcha')
  const [showPassword, setShowPassword] = useState(false)
  // 图形验证码：答案仅存服务端内存、一次性消费；登录失败后必须换新图
  const [captchaId, setCaptchaId] = useState('')
  const [captchaSvg, setCaptchaSvg] = useState('')
  // 忘记密码入口形态：邮件未配置时降级为「联系管理员」指引，避免把用户引到必然失败的流程
  const [mailConfigured, setMailConfigured] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const fieldErrors = { username: model.form.formState.errors.username?.message, password: model.form.formState.errors.password?.message, captcha: model.form.formState.errors.captcha?.message }
  const [capsLockOn, setCapsLockOn] = useState(false)
  // 防抖：提交进行中时拦截重复提交（Enter 连按 / 双击按钮 / 自动续登期间避免手动表单覆盖）
  const submittingRef = useRef(false)
  // 自动续登进行中：避免和手动提交竞争，覆盖表单
  const autoLoggingInRef = useRef(false)

  const navigate = useNavigate()
  const location = useLocation()
  const requestedPath = (location.state as { returnTo?: unknown } | null)?.returnTo
  const loginTarget = typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//') && !requestedPath.startsWith('/login') ? requestedPath : '/'
  const [searchParams] = useSearchParams()
  const login = useAuthStore((state) => state.login)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const persistentLoginToken = useAuthStore((state) => state.persistentLoginToken)
  const setPersistentLoginToken = useAuthStore((state) => state.setPersistentLoginToken)

  // 会话过期跳转提示（api.ts 刷新失败降级后带 ?expired=1 落地）
  const sessionExpired = searchParams.get('expired') === '1'
  // 首次登录引导：URL 带 ?firstLogin=1 时展示（由后端首次登录强制改密流跳转携带）
  const showFirstLoginHint = searchParams.get('firstLogin') === '1'
  // 演示态：URL 带 ?demo=1 时同时展示错误条 + 首次登录提示 demo 文案，对齐 v6 设计稿静态截图
  const isDemo = searchParams.get('demo') === '1'
  // 错误条显示条件：真实错误 OR 会话过期 OR 演示态；文案优先级：真实错误 > 会话过期 > 演示态
  const showErrorBar = Boolean(error) || sessionExpired || isDemo
  const errorBarText = error
    || (sessionExpired ? '登录已过期，请重新登录' : null)
    || (isDemo ? DEMO_ERROR_TEXT : null)
  // 提示条显示条件：首次登录引导 OR 演示态
  const showHintBar = showFirstLoginHint || isDemo

  /**
   * 自动续登：拿本地持久令牌去服务端换新 access/refresh；服务端会旋转持久令牌。
   * 失败 / 失效：清空本地持久令牌，停在登录页（不弹错误，避免每次刷新都吵用户）。
   */
  const runAutoLogin = async (token: string) => {
    if (autoLoggingInRef.current) return
    autoLoggingInRef.current = true
    submittingRef.current = true
    setIsLoading(true)
    setError('')
    try {
      const response = await api.autoLogin(token)
      const newToken = response.persistentLoginToken ?? null
      setPersistentLoginToken(newToken)
      login(response.user, response.accessToken, response.refreshToken, {
        persistentLoginToken: newToken,
      })
      navigate(loginTarget)
    } catch (error) {
      console.error('自动续登失败，已清除本地持久令牌', error)
      // 静默失败：清空持久令牌；用户停留在登录页时仍可手动输入密码
      setPersistentLoginToken(null)
    } finally {
      submittingRef.current = false
      setIsLoading(false)
      autoLoggingInRef.current = false
    }
  }

  /** 拉取/刷新图形验证码（挂载与每次登录失败后调用）；失败则清空，避免提交空 captchaId */
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

  // 初始化：
  // 1) 回填记住的用户名
  // 2) 若 localStorage 中存在持久令牌（7 天免登录），挂载时静默续登
  useEffect(() => {
    const remembered = localStorage.getItem(REMEMBER_KEY)
    if (remembered) {
      model.form.reset({ username: remembered, password: '', rememberMe: true })
    }
    if (persistentLoginToken && !isAuthenticated) {
      void runAutoLogin(persistentLoginToken)
    }
    // 图形验证码与登录页能力探测并行拉取；失败不阻塞登录页渲染
    void refreshCaptcha()
    api.getLoginOptions().then((options) => setMailConfigured(options.mailConfigured)).catch(() => setMailConfigured(false))
    // 仅挂载时执行一次；后续状态变化不重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 已登录用户访问登录页时直接回到权限感知首页（所有 hooks 之后早退，保证调用顺序稳定）
  if (isAuthenticated) {
    return <Navigate to={loginTarget} replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submittingRef.current || isLoading) return

    if (!(await model.validate())) return

    submittingRef.current = true
    setIsLoading(true)
    setError('')

    try {
      const response = await api.login({
        username: username.trim(),
        password,
        captchaId,
        captcha,
        rememberMe,
      })
      // 记住用户名：仅持久化用户名，不保存任何凭证
      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, username.trim())
      } else {
        localStorage.removeItem(REMEMBER_KEY)
      }
      // 持久令牌：勾选免登录才落库到 store（zustand persist 写入 localStorage）
      login(response.user, response.accessToken, response.refreshToken, {
        persistentLoginToken: response.persistentLoginToken ?? null,
      })
      // 权限感知跳转：优先 dashboard，否则按模块优先级取第一个有权限的页面；无匹配 → /no-access
      navigate(loginTarget)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试')
      // 验证码一次性消费：失败后换新图，否则重试必然再次失败
      setCaptcha('')
      void refreshCaptcha()
    } finally {
      submittingRef.current = false
      setIsLoading(false)
    }
  }

  return (
    <div className="login-shell">
      <main className="login-form-wrap">
        <div className="login-brand">
          <img className="login-brand-logo" src="/logo.png" alt="" />
          <span className="login-brand-text">浙江壹品慧<span>经营分析平台</span></span>
        </div>
        <h1 className="login-heading">登录</h1>
        <ModelFormFields model={model}><form className="login-form" onSubmit={handleSubmit} noValidate onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }}>
          {/* 告警条（粉彩版：登录错误=红色 error，会话过期=黄色 warning） */}
          {showErrorBar && errorBarText && (
            <div
              role="alert"
              className={cn(
                'login-alert',
                error ? 'login-alert-error' : 'login-alert-warning'
              )}
            >
              <AlertCircle className="login-alert-icon" aria-hidden />
              <span>{errorBarText}</span>
            </div>
          )}

          {/* 账号 */}
          <div className="login-field">
            <Label htmlFor="username">账号</Label>
            <Input
              id="username"
              placeholder="请输入账号"
              value={username}
              name="username"
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={isLoading}
              aria-invalid={!!fieldErrors.username}
              aria-describedby={fieldErrors.username ? 'username-error' : undefined}
              className={cn(
                'login-input h-10',
                fieldErrors.username && 'login-input-error'
              )}
            />
          </div>

          {/* 密码（仅眼睛按钮） */}
          <div className="login-field">
            <Label htmlFor="password">密码</Label>
            <div className="login-input-wrap">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="请输入密码"
                value={password}
                name="password"
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => {
                  // 失焦时清除大写锁定提示，避免切走输入框后残留
                  setCapsLockOn(false)
                }}
                onKeyUp={(e) => setCapsLockOn(e.getModifierState?.('CapsLock') ?? false)}
                autoComplete="current-password"
                disabled={isLoading}
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                className={cn(
                  'login-input login-input-pwd h-10',
                  fieldErrors.password && 'login-input-error'
                )}
              />
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setShowPassword((v) => !v)}
                className="login-eye"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                title={showPassword ? '隐藏密码' : '显示密码'}
              >
                {/* 图标表示当前可见状态：明文=睁眼，密文=闭眼 */}
                {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>
            {capsLockOn && !fieldErrors.password && (
              <p className="login-field-tip">大写锁定已开启</p>
            )}
          </div>

          {/* 图形验证码（点击图片刷新；答案一次性消费，登录失败后自动换图） */}
          <div className="login-field">
            <Label htmlFor="captcha">验证码</Label>
            <div className="login-input-wrap">
              <Input
                id="captcha"
                placeholder="请输入验证码"
                value={captcha}
                name="captcha"
                onChange={(e) => setCaptcha(e.target.value)}
                maxLength={8}
                autoComplete="off"
                disabled={isLoading}
                aria-invalid={!!fieldErrors.captcha}
                aria-describedby={fieldErrors.captcha ? 'captcha-error' : undefined}
                className={cn(
                  'login-input h-10',
                  fieldErrors.captcha && 'login-input-error'
                )}
              />
              <button
                type="button"
                onClick={() => { setCaptcha(''); void refreshCaptcha() }}
                className="login-captcha"
                aria-label="刷新验证码"
                title="点击刷新验证码"
                /* 内容来自本服务端 svg-captcha 生成的 SVG，不含用户输入，无需额外转义 */
                dangerouslySetInnerHTML={{ __html: captchaSvg }}
              />
            </div>
            {fieldErrors.captcha && (
              <p id="captcha-error" className="login-field-tip">{fieldErrors.captcha}</p>
            )}
          </div>

          {/* 7 天免登录 + 忘记密码 */}
          <div className="login-row">
            <Checkbox
              id="remember-me"
              checked={rememberMe}
              onCheckedChange={(v) => setRememberMe(v === true)}
              disabled={isLoading}
            >
              <span className="login-check-text">7 天内免登录</span>
            </Checkbox>
            {mailConfigured ? (
              <button type="button" className="login-link" onClick={() => setForgotOpen(true)}>忘记密码？</button>
            ) : (
              <Popover>
                <PopoverTrigger asChild><button type="button" className="login-link">忘记密码？</button></PopoverTrigger>
                <PopoverContent className="w-64 p-4"><p className="text-sm leading-relaxed">请联系平台管理员重置密码。首次登录或密码重置后，系统会引导你设置新密码。</p></PopoverContent>
              </Popover>
            )}

          </div>

          {/* 登录主按钮（品牌渐变随主题联动，antd 原生 loading 单 spinner） */}
          <Button
            type="submit"
            loading={isLoading}
            className="login-submit"
          >
            {isLoading ? '登录中' : '登 录'}
          </Button>

          {/* 首次登录提示（品牌色提示块，随主题联动） */}
          {showHintBar && (
            <p className="login-hint">
              <span className="login-hint-dot" aria-hidden>
                ·
              </span>
              <span>{showFirstLoginHint && !isDemo ? '首次登录或密码过期将被引导到修改密码流程' : DEMO_HINT_TEXT}</span>
            </p>
          )}
        </form></ModelFormFields>
        <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
      </main>
    </div>
  )
}
