import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import { api } from '@/lib/api'
import { getCurrentVersion } from '@/lib/app-version'
import { resolveHomePath } from '@/lib/permissions'

/** 记住用户名：仅本地保存用户名（凭证不落盘） */
const REMEMBER_KEY = 'login-remembered-username'

/** 演示态文案（v6 设计稿静态截图）：
 *  - demoError: 错误条 demo 文案（点击登录触发真实校验时优先用真实错误覆盖）
 *  - demoHint: 首次登录提示 demo 文案
 * 仅在 URL 携带 ?demo=1 时展示，避免污染真实生产态首屏。 */
const DEMO_ERROR_TEXT = '账号或密码错误，还可重试 4 次（演示态）'
const DEMO_HINT_TEXT = '首次登录或密码过期将被引导到修改密码流程'

/** 版本标签：生产读构建注入的 app-version meta（v2026.09.1 → V2026.09.1）；开发态无 meta 显示 DEV */
const VERSION_LABEL = (() => {
  const v = getCurrentVersion()
  return v === 'dev' ? 'DEV' : `V${v.replace(/^v/, '')}`
})()

interface FieldErrors {
  username?: string
  password?: string
}

function validateUsername(value: string): string | undefined {
  if (!value.trim()) return '请输入用户名'
  return undefined
}

function validatePassword(value: string): string | undefined {
  if (!value) return '请输入密码'
  return undefined
}

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<{ username?: boolean; password?: boolean }>({})
  const [capsLockOn, setCapsLockOn] = useState(false)
  // 防抖：提交进行中时拦截重复提交（Enter 连按 / 双击按钮 / 自动续登期间避免手动表单覆盖）
  const submittingRef = useRef(false)
  // 自动续登进行中：避免和手动提交竞争，覆盖表单
  const autoLoggingInRef = useRef(false)

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const login = useAuthStore((state) => state.login)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const user = useAuthStore((state) => state.user)
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
      navigate(resolveHomePath(response.user.permissions) ?? '/no-access')
    } catch {
      // 静默失败：清空持久令牌；用户停留在登录页时仍可手动输入密码
      setPersistentLoginToken(null)
    } finally {
      submittingRef.current = false
      setIsLoading(false)
      autoLoggingInRef.current = false
    }
  }

  // 初始化：
  // 1) 回填记住的用户名
  // 2) 若 localStorage 中存在持久令牌（7 天免登录），挂载时静默续登
  useEffect(() => {
    const remembered = localStorage.getItem(REMEMBER_KEY)
    if (remembered) {
      setUsername(remembered)
      setRememberMe(true)
    }
    if (persistentLoginToken && !isAuthenticated) {
      void runAutoLogin(persistentLoginToken)
    }
    // 仅挂载时执行一次；后续状态变化不重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 已登录用户访问登录页时直接回到权限感知首页（所有 hooks 之后早退，保证调用顺序稳定）
  if (isAuthenticated) {
    return <Navigate to={resolveHomePath(user?.permissions) ?? '/no-access'} replace />
  }

  const runValidate = (field: 'username' | 'password', value: string) => {
    const message = field === 'username' ? validateUsername(value) : validatePassword(value)
    setFieldErrors((prev) => ({ ...prev, [field]: message }))
    return message
  }

  const handleUsernameChange = (value: string) => {
    setUsername(value)
    if (touched.username) runValidate('username', value)
  }

  const handlePasswordChange = (value: string) => {
    setPassword(value)
    if (touched.password) runValidate('password', value)
  }

  const handleBlur = (field: 'username' | 'password') => {
    setTouched((prev) => ({ ...prev, [field]: true }))
    runValidate(field, field === 'username' ? username : password)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submittingRef.current || isLoading) return

    // 提交时全量校验
    setTouched({ username: true, password: true })
    const usernameError = runValidate('username', username)
    const passwordError = runValidate('password', password)
    if (usernameError || passwordError) return

    submittingRef.current = true
    setIsLoading(true)
    setError('')

    try {
      const response = await api.login({
        username: username.trim(),
        password,
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
      navigate(resolveHomePath(response.user.permissions) ?? '/no-access')
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试')
    } finally {
      submittingRef.current = false
      setIsLoading(false)
    }
  }

  return (
    // 粉彩淡雅版（用户定稿）：双栏 + 左侧粉彩品牌区（随 4 主题联动）+ 右侧登录表单
    // 样式由 globals.css 基础 .login-shell 块驱动（勿加 login-shell-v6 修饰类，那会切回深蓝 v6 门面）
    <div className="login-shell">
      {/* ========== 左侧：品牌区（仅桌面端 ≥1025px 显示，粉彩渐变随主题联动） ========== */}
      <aside className="login-side">
        {/* 版本号在 stack 之外（同级）：absolute 定位锚定 .login-side，固定距底 30px，不参与居中布局流 */}
        <div className="login-brand-stack">
          <div className="login-brand">
            <img className="login-brand-logo" src="/logo.png" alt="浙江壹品慧" />
            <span className="login-brand-text">浙江壹品慧经营分析平台</span>
          </div>
        </div>
        <div className="login-version">{VERSION_LABEL}</div>
      </aside>

      {/* ========== 右侧：登录区（≤1024px 时品牌块并入表单上方，单栏布局） ========== */}
      <main className="login-form-wrap">
        <div className="login-brand-mobile login-brand">
          <img
            className="login-brand-logo login-brand-logo-dark"
            src="/logo.png"
            alt="浙江壹品慧"
          />
          <span className="login-brand-text">浙江壹品慧经营分析平台</span>
        </div>
        <form className="login-form" onSubmit={handleSubmit} noValidate>
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
              onChange={(e) => handleUsernameChange(e.target.value)}
              onBlur={() => handleBlur('username')}
              autoComplete="username"
              disabled={isLoading}
              aria-invalid={!!fieldErrors.username}
              aria-describedby={fieldErrors.username ? 'username-error' : undefined}
              className={cn(
                'login-input h-10',
                fieldErrors.username && 'login-input-error'
              )}
            />
            {fieldErrors.username && (
              <p id="username-error" className="login-field-err">
                {fieldErrors.username}
              </p>
            )}
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
                onChange={(e) => handlePasswordChange(e.target.value)}
                onBlur={() => {
                  handleBlur('password')
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
                tabIndex={-1}
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
            {fieldErrors.password && (
              <p id="password-error" className="login-field-err">
                {fieldErrors.password}
              </p>
            )}
            {capsLockOn && !fieldErrors.password && (
              <p className="login-field-tip">大写锁定已开启</p>
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
            <a
              role="button"
              tabIndex={0}
              className="login-link"
              onClick={(e) => e.preventDefault()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
              }}
            >
              忘记密码？
            </a>
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
        </form>
      </main>
    </div>
  )
}
