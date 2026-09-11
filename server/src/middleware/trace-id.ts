import type { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'

/**
 * 链路追踪中间件：为每个请求生成/透传 traceId（UUID v4），注入 req.traceId，
 * 并回写响应头 X-Request-Id，贯穿日志与响应体（见 docs/references/observability.md）。
 *
 * 说明：以内建 crypto.randomUUID 实现，等价于规范中 express-request-id 的职责，
 * 避免额外依赖与 ESM 互操作风险。
 */
export function traceId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('X-Request-Id')
  const id = incoming && incoming.trim() !== '' ? incoming.trim() : randomUUID()
  req.traceId = id
  res.setHeader('X-Request-Id', id)
  next()
}
