import type { Response } from 'express'

/**
 * 统一响应结构：{ code, data, message, traceId }
 * code=0 表示成功，非 0 表示错误（见 docs/references/errorcode.md）。
 */
export interface ApiResponse<T> {
  code: number
  data: T | null
  message: string
  traceId: string
}

/** 成功响应 */
export function sendOk<T>(res: Response, data: T, message = 'success', httpStatus = 200): void {
  const body: ApiResponse<T> = {
    code: 0,
    data,
    message,
    traceId: res.req.traceId,
  }
  res.status(httpStatus).json(body)
}

/** 失败响应（业务错误码 + HTTP 状态码分离） */
export function sendFail(res: Response, code: number, message: string, httpStatus: number): void {
  const body: ApiResponse<null> = {
    code,
    data: null,
    message,
    traceId: res.req.traceId,
  }
  res.status(httpStatus).json(body)
}
