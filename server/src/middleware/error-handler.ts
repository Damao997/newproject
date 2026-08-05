import type { Request, Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { AppError } from '../lib/errors'
import { sendFail } from '../lib/response'
import { logger } from '../lib/logger'

/**
 * 全局错误处理中间件（挂载在所有路由之后）。
 * 分类映射：AppError → 自身 code/http；ZodError → 400；Prisma 唯一冲突 → 409；其余 → 500。
 * 500 不向客户端泄露堆栈，仅记录日志。禁止吞异常。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const traceId = req.traceId

  if (err instanceof AppError) {
    if (err.httpStatus >= 500) {
      logger.error(traceId, `AppError ${err.code}: ${err.message}`)
    } else {
      logger.warn(traceId, `AppError ${err.code}: ${err.message}`)
    }
    sendFail(res, err.code, err.message, err.httpStatus)
    return
  }

  // multer 上传错误（文件超限等）→ 400
  if (err instanceof Error && err.name === 'MulterError') {
    const code = (err as { code?: string }).code
    const message = code === 'LIMIT_FILE_SIZE' ? '文件超过 200MB 上限' : '文件上传失败'
    logger.warn(traceId, `MulterError ${code}: ${message}`)
    sendFail(res, 400, message, 400)
    return
  }

  // body-parser JSON 解析失败（非法 JSON / 超 limit）→ 400，避免落入兜底 500 误导排查
  if (err instanceof Error && err.name === 'SyntaxError' && (err as { type?: string }).type === 'entity.parse.failed') {
    logger.warn(traceId, `请求体解析失败: ${err.message}`)
    sendFail(res, 400, '请求体不是合法的 JSON', 400)
    return
  }

  if (err instanceof ZodError) {
    const first = err.errors[0]
    const message = first ? `${first.path.join('.') || '参数'}: ${first.message}` : '参数校验失败'
    logger.warn(traceId, `参数校验失败: ${message}`)
    sendFail(res, 400, message, 400)
    return
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      logger.warn(traceId, `唯一约束冲突: ${String(err.meta?.target)}`)
      sendFail(res, 409, '资源已存在或唯一约束冲突', 409)
      return
    }
    if (err.code === 'P2025') {
      logger.warn(traceId, '记录不存在')
      sendFail(res, 404, '资源不存在', 404)
      return
    }
  }

  // 未知异常：记录完整堆栈，返回通用错误
  logger.error(traceId, '未捕获异常', err)
  sendFail(res, 500, '服务器内部错误', 500)
}

/** 404 处理 */
export function notFoundHandler(_req: Request, res: Response): void {
  sendFail(res, 404, '接口不存在', 404)
}
