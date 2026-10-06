import multer from 'multer'
import { PersonalSettingsService } from '../services/PersonalSettingsService'
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express'
import { AuthService } from '../services/AuthService'
import { PasswordResetService } from '../services/PasswordResetService'
import { generateCaptcha } from '../services/CaptchaService'
import { authenticate } from '../middleware/auth'
import { loginRateLimiter, captchaRateLimiter, passwordResetRateLimiter } from '../middleware/rate-limit'
import { auditMeta } from '../middleware/audit'
import { sendOk } from '../lib/response'
import { errors } from '../lib/errors'
import { loadConfig } from '../config/env'
import {
  loginSchema,
  refreshSchema,
  updatePasswordSchema,
  autoLoginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../lib/schema'

/**
 * 认证路由（前缀 /api/v1/auth），契约对齐 web/src/lib/api.ts。
 * 公开：GET /login-options、GET /captcha、POST /login、POST /refresh、POST /auto-login、POST /forgot-password、POST /reset-password
 * 需登录：POST /logout、GET /profile、PUT /password
 */

// 异步处理包装：统一将异常转发到全局错误处理
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next)
  }
}

const router = Router()

// GET /auth/login-options —— 登录页能力探测（公开、无副作用）：邮件是否已配置决定「忘记密码」入口形态
router.get(
  '/login-options',
  asyncHandler(async (_req, res) => {
    const config = loadConfig()
    sendOk(res, { mailConfigured: Boolean(config.smtpHost && config.mailFrom), captchaRequired: true })
  }),
)

// GET /auth/captcha —— 登录图形验证码（公开；30 次/分钟）。答案仅存服务端内存，一次性消费
router.get(
  '/captcha',
  captchaRateLimiter,
  asyncHandler(async (_req, res) => {
    sendOk(res, generateCaptcha())
  }),
)

// POST /auth/login —— 登录（5 次/分钟限流；请求体需携带图形验证码）
router.post(
  '/login',
  loginRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.parse(req.body)
    const result = await AuthService.login(
      parsed.username,
      parsed.password,
      auditMeta(req),
      { rememberMe: parsed.rememberMe === true, captcha: { id: parsed.captchaId, code: parsed.captcha } },
    )
    sendOk(res, result)
  }),
)

// POST /auth/forgot-password —— 忘记密码第一步：申请重置验证码（公开；防枚举统一响应）
router.post(
  '/forgot-password',
  passwordResetRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = forgotPasswordSchema.parse(req.body)
    await PasswordResetService.requestCode(parsed.identifier, auditMeta(req))
    sendOk(res, null)
  }),
)

// POST /auth/reset-password —— 忘记密码第二步：验码 + 重置密码（公开；成功后吊销全部会话）
router.post(
  '/reset-password',
  passwordResetRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.parse(req.body)
    await PasswordResetService.reset(parsed.identifier, parsed.code, parsed.newPassword, auditMeta(req))
    sendOk(res, null)
  }),
)

// POST /auth/auto-login —— 「7 天内免登录」凭持久令牌续登（公开，受登录限流保护防暴力）
router.post(
  '/auto-login',
  loginRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = autoLoginSchema.parse(req.body)
    const result = await AuthService.autoLogin(parsed.persistentLoginToken, auditMeta(req))
    sendOk(res, result)
  }),
)

// POST /auth/refresh —— 刷新令牌（轮转）
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.parse(req.body)
    const result = await AuthService.refresh(parsed.refreshToken, auditMeta(req))
    sendOk(res, result)
  }),
)

// POST /auth/logout —— 登出（需登录；仅吊销当前会话）
router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.authUser) throw errors.unauthorized()
    await AuthService.logout(req.authUser.userId, req.authUser.tokenJti, auditMeta(req))
    sendOk(res, null)
  }),
)

// GET /auth/profile —— 当前用户资料（需登录）
router.get(
  '/profile',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.authUser) throw errors.unauthorized()
    const user = await AuthService.getProfile(req.authUser.userId)
    sendOk(res, user)
  }),
)

// PUT /auth/password —— 修改密码（需登录；成功返回新令牌对供前端静默续期）
router.put(
  '/password',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.authUser) throw errors.unauthorized()
    const parsed = updatePasswordSchema.parse(req.body)
    const result = await AuthService.changePassword(req.authUser.userId, parsed.oldPassword, parsed.newPassword, auditMeta(req), req.authUser.tokenJti)
    sendOk(res, result)
  }),
)


router.patch('/profile', authenticate, asyncHandler(async (req, res) => {
  if (!req.authUser) throw errors.unauthorized()
  sendOk(res, await PersonalSettingsService.updateProfile(req.authUser.userId, req.body, auditMeta(req)))
}))
router.get('/preferences', authenticate, asyncHandler(async (req, res) => {
  if (!req.authUser) throw errors.unauthorized()
  sendOk(res, await PersonalSettingsService.getPreferences(req.authUser))
}))
router.patch('/preferences', authenticate, asyncHandler(async (req, res) => {
  if (!req.authUser) throw errors.unauthorized()
  sendOk(res, await PersonalSettingsService.updatePreferences(req.authUser, req.body, auditMeta(req)))
}))
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } }).single('avatar')
router.post('/avatar', authenticate, (req, res, next) => {
  avatarUpload(req, res, cause => next(cause ? errors.badRequest('请选择 2MB 以内的图片文件') : undefined))
}, asyncHandler(async (req, res) => {
  if (!req.authUser) throw errors.unauthorized()
  sendOk(res, await PersonalSettingsService.updateAvatar(req.authUser.userId, req.file, auditMeta(req)))
}))
router.delete('/avatar', authenticate, asyncHandler(async (req, res) => {
  if (!req.authUser) throw errors.unauthorized()
  sendOk(res, await PersonalSettingsService.removeAvatar(req.authUser.userId, auditMeta(req)))
}))
router.get('/avatar', authenticate, asyncHandler(async (req, res) => {
  if (!req.authUser) throw errors.unauthorized()
  const buffer = await PersonalSettingsService.getAvatar(req.authUser.userId)
  res.setHeader('Cache-Control', 'private, no-store')
  res.type('image/webp').send(buffer)
}))
export default router
