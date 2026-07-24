import rateLimit from 'express-rate-limit'
import type { Request, Response } from 'express'
import { sendFail } from '../lib/response'

/**
 * 速率限制（见 docs/references/security.md）：
 *   - 登录接口：5 次/分钟
 *   - 通用接口：100 次/分钟
 * 超限返回统一响应 code=429 / HTTP 429。
 */

function tooManyHandler(_req: Request, res: Response): void {
  sendFail(res, 429, '请求频率超限，请稍后再试', 429)
}

/** 登录限流：5 次/分钟 */
export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyHandler,
})

/** 通用限流：100 次/分钟 */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyHandler,
})
