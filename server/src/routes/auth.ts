import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express'
import { AuthService } from '../services/AuthService'
import { authenticate } from '../middleware/auth'
import { loginRateLimiter } from '../middleware/rate-limit'
import { auditMeta } from '../middleware/audit'
import { sendOk } from '../lib/response'
import { errors } from '../lib/errors'
import { loginSchema, refreshSchema, updatePasswordSchema } from '../lib/schema'

/**
 * 认证路由（前缀 /api/v1/auth），契约对齐 web/src/lib/api.ts。
 * 公开：POST /login、POST /refresh
 * 需登录：POST /logout、GET /profile、PUT /password
 */

// 异步处理包装：统一将异常转发到全局错误处理
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next)
  }
}

const router = Router()

// POST /auth/login —— 登录（5 次/分钟限流）
router.post(
  '/login',
  loginRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.parse(req.body)
    const result = await AuthService.login(parsed.username, parsed.password, auditMeta(req))
    sendOk(res, result)
  }),
)

// POST /auth/refresh —— 刷新令牌（轮转）
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.parse(req.body)
    const result = await AuthService.refresh(parsed.refreshToken)
    sendOk(res, result)
  }),
)

// POST /auth/logout —— 登出（需登录）
router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.authUser) throw errors.unauthorized()
    await AuthService.logout(req.authUser.userId, auditMeta(req))
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

// PUT /auth/password —— 修改密码（需登录）
router.put(
  '/password',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.authUser) throw errors.unauthorized()
    const parsed = updatePasswordSchema.parse(req.body)
    await AuthService.changePassword(req.authUser.userId, parsed.oldPassword, parsed.newPassword, auditMeta(req))
    sendOk(res, null)
  }),
)

export default router
