import rateLimit, { MemoryStore } from 'express-rate-limit'
import type { Request, Response } from 'express'
import { sendFail } from '../lib/response'

/**
 * 速率限制（见 docs/references/security.md）：
 *   - 登录接口：5 次/分钟
 *   - 图形验证码：30 次/分钟（登录页每次加载/刷新拉一张）
 *   - 密码重置（申请码/重置）：5 次/分钟
 *   - 通用接口：100 次/分钟
 * 超限返回统一响应 code=429 / HTTP 429。
 */

function tooManyHandler(_req: Request, res: Response): void {
  sendFail(res, 429, '请求频率超限，请约 1 分钟后重试', 429)
}

// 各限流器独立 store（互不共享计数）；显式实例化以便测试重置（v7 不再在中间件上暴露 store）
const loginStore = new MemoryStore()
const captchaStore = new MemoryStore()
const passwordResetStore = new MemoryStore()

/** 登录限流：5 次/分钟 */
export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyHandler,
  store: loginStore,
})

/** 图形验证码限流：30 次/分钟（防批量拉图字典攻击验证码） */
export const captchaRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyHandler,
  store: captchaStore,
})

/** 密码重置限流（申请验证码 + 重置共用）：5 次/分钟 */
export const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyHandler,
  store: passwordResetStore,
})

/** 通用限流：100 次/分钟 */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyHandler,
})

/** 测试用：清空认证相关限流计数（集成测试在限流窗口内连续请求时调用） */
export function resetAuthRateLimits(): void {
  void loginStore.resetAll()
  void captchaStore.resetAll()
  void passwordResetStore.resetAll()
}
