import 'express'

// 扩展 Express Request，注入 traceId 与鉴权上下文
declare global {
  namespace Express {
    interface Request {
      /** 每请求唯一链路 ID（UUID v4），贯穿日志与响应 */
      traceId: string
      /** 鉴权中间件注入的当前用户上下文（未登录时为 undefined） */
      authUser?: AuthUserContext
    }
  }
}

/** 鉴权后挂载到 req.authUser 的最小用户上下文 */
export interface AuthUserContext {
  userId: string
  username: string
  roleCode: string
  roleId: string
  scopeValue: string
  companyCode: string | null
  orgScopeBu: string[] | null
  /** 多选数据范围（公司编码数组，可混合单体与汇总），优先于 companyCode */
  dataScopeCodes: string[] | null
}

export {}
