import type { Request, Response, NextFunction } from 'express'
import { sendFail } from '../lib/response'
import type { AuthUserContext } from '../types/express'

/**
 * AI 接口限流（见 AI模块规范 §七）：单用户 ≤10/分钟、全局 ≤100/分钟，超限 429。
 * 内存计数，进程级；多实例部署可替换为共享存储。
 */

const USER_LIMIT = 10
const GLOBAL_LIMIT = 100
const WINDOW_MS = 60_000

interface Entry {
  count: number
  resetAt: number
}

const userBuckets = new Map<string, Entry>()
let globalBucket: Entry = { count: 0, resetAt: Date.now() + WINDOW_MS }

function take(bucket: Entry | undefined, key: string | null, limit: number): boolean {
  const now = Date.now()
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS }
    if (key) userBuckets.set(key, bucket)
    else globalBucket = bucket
  }
  if (bucket.count >= limit) return false
  bucket.count++
  return true
}

export function aiRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const userId = (req.authUser as AuthUserContext | undefined)?.userId ?? 'anonymous'

  if (globalBucket.count >= GLOBAL_LIMIT && Date.now() < globalBucket.resetAt) {
    sendFail(res, 429, 'AI 服务繁忙，请稍后再试', 429)
    return
  }
  if (!take(globalBucket, null, GLOBAL_LIMIT)) {
    sendFail(res, 429, 'AI 服务繁忙，请稍后再试', 429)
    return
  }
  if (!take(userBuckets.get(userId), userId, USER_LIMIT)) {
    sendFail(res, 429, 'AI 调用过于频繁，请稍后再试', 429)
    return
  }
  next()
}

/** 测试用：重置计数 */
export function resetAIRateLimit(): void {
  userBuckets.clear()
  globalBucket = { count: 0, resetAt: Date.now() + WINDOW_MS }
}
