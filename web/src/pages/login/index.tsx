import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { AlertCircle, Eye, EyeOff, Loader2, Lock, User } from 'lucide-react'
import { api } from '@/lib/api'
import { resolveHomePath } from '@/lib/permissions'

/** 记住我：仅记住用户名（凭证不落盘） */
const REMEMBER_KEY = 'login-remembered-username'

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
  // 防抖：提交进行中时拦截重复提交（Enter 连按 / 双击按钮）
  const submittingRef = useRef(false)

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const login = useAuthStore((state) => state.login)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const user = useAuthStore((state) => state.user)

  // 会话过期跳转提示（api.ts 刷新失败降级后带 ?expired=1 落地）
  const sessionExpired = searchParams.get('expired') === '1'

  // 初始化：回填记住的用户名
  useEffect(() => {
    const remembered = localStorage.getItem(REMEMBER_KEY)
    if (remembered) {
      setUsername(remembered)
      setRememberMe(true)
    }
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
      const response = await api.login({ username: username.trim(), password })
      // 记住我：仅持久化用户名，不保存任何凭证
      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, username.trim())
      } else {
        localStorage.removeItem(REMEMBER_KEY)
      }
      login(response.user, response.accessToken, response.refreshToken)
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-primary/[0.06] via-background to-secondary p-4 sm:p-6">
      {/* 品牌氛围装饰（纯视觉，不参与交互） */}
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-warning/10 blur-3xl" />

      <div className="w-full max-w-[400px] animate-fade-in">
        <Card className="rounded-xl border-border/70 shadow-xl shadow-primary/[0.07] hover:shadow-xl">
          <CardHeader className="space-y-3 pb-4 text-center">
            <div className="flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-primary/20">
                <img src="/logo.png" alt="壹品慧" className="h-9 w-9 object-contain" />
              </div>
            </div>
            <div className="space-y-1.5">
              <CardTitle className="text-xl font-bold tracking-tight sm:text-2xl">浙江壹品慧经营分析平台</CardTitle>
              <CardDescription>欢迎回来，请登录您的账号</CardDescription>
            </div>
          </CardHeader>
          <form onSubmit={handleSubmit} noValidate>
            <CardContent className="space-y-4">
              {sessionExpired && (
                <div
                  role="alert"
                  className="flex animate-fade-in items-start gap-2 rounded-md border border-warning/20 bg-warning/10 p-3 text-sm text-warning-strong"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>登录已过期，请重新登录</span>
                </div>
              )}
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
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <div className="group relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                  <Input
                    id="username"
                    placeholder="请输入用户名"
                    value={username}
                    onChange={(e) => handleUsernameChange(e.target.value)}
                    onBlur={() => handleBlur('username')}
                    autoComplete="username"
                    disabled={isLoading}
                    aria-invalid={!!fieldErrors.username}
                    aria-describedby={fieldErrors.username ? 'username-error' : undefined}
                    className={cn(
                      'h-10 pl-10 transition-shadow duration-200',
                      fieldErrors.username && 'border-destructive focus-visible:ring-destructive'
                    )}
                  />
                </div>
                {fieldErrors.username && (
                  <p id="username-error" className="animate-fade-in text-xs text-destructive">
                    {fieldErrors.username}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <div className="group relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
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
                      'h-10 pl-10 pr-10 transition-shadow duration-200',
                      fieldErrors.password && 'border-destructive focus-visible:ring-destructive'
                    )}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={isLoading}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {/* 图标表示当前可见状态：明文=睁眼，密文=闭眼 */}
                    {showPassword ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p id="password-error" className="animate-fade-in text-xs text-destructive">
                    {fieldErrors.password}
                  </p>
                )}
                {capsLockOn && !fieldErrors.password && (
                  <p className="animate-fade-in text-xs text-warning">大写锁定已开启</p>
                )}
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="remember-me"
                    checked={rememberMe}
                    onCheckedChange={setRememberMe}
                    disabled={isLoading}
                  />
                  <Label htmlFor="remember-me" className="cursor-pointer text-sm font-normal text-muted-foreground">
                    记住我
                  </Label>
                </div>
              </div>
            </CardContent>
            <CardFooter className="pt-2">
              <Button type="submit" className="h-11 w-full text-base font-medium" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    登录中...
                  </>
                ) : (
                  '登录'
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* 底部：公司信息 + 版本号（frontend-design-proposal 5.2） */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          壹品慧 · 数据分析平台 © 2026
        </p>
      </div>
    </div>
  )
}
