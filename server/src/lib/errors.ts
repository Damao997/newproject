/**
 * 统一错误码与应用异常。
 * code 与 HTTP 状态码映射见 docs/references/errorcode.md：
 *   0=成功 / 400=参数 / 401=未认证 / 403=无权限 / 409=冲突 / 429=限流 / 500=系统
 */

export class AppError extends Error {
  readonly code: number
  readonly httpStatus: number

  constructor(code: number, httpStatus: number, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

export const errors = {
  /** 400 参数校验失败 */
  badRequest: (message = '参数校验失败') => new AppError(400, 400, message),
  /** 401 未登录 / Token 失效 */
  unauthorized: (message = '未登录或登录已失效') => new AppError(401, 401, message),
  /** 403 权限不足 / scope 不覆盖 */
  forbidden: (message = '权限不足') => new AppError(403, 403, message),
  /** 404 资源不存在 */
  notFound: (message = '资源不存在') => new AppError(404, 404, message),
  /** 409 资源冲突（唯一约束 / 重复导入 / 版本冲突） */
  conflict: (message = '资源冲突') => new AppError(409, 409, message),
  /** 429 请求频率超限 */
  tooManyRequests: (message = '请求频率超限，请稍后再试') => new AppError(429, 429, message),
  /** 500 系统内部错误 */
  internal: (message = '服务器内部错误') => new AppError(500, 500, message),
}
