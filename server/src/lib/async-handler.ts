import type { Request, Response, NextFunction, RequestHandler } from 'express'

/**
 * 异步路由处理包装：统一将 Promise 异常转发到全局错误处理中间件，避免未捕获拒绝。
 */
export function asyncHandler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next)
  }
}
