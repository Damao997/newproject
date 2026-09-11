import 'express'
import type { DataScope } from '../middleware/scope'

// 扩展 Express Request，注入 traceId 与鉴权上下文
declare global {
  namespace Express {
    interface Request {
      /** 每请求唯一链路 ID（UUID v4），贯穿日志与响应 */
      traceId: string
      /** 鉴权中间件注入的当前用户上下文（未登录时为 undefined） */
      authUser?: AuthUserContext
      /** attachScope 解析出的数据范围（未鉴权或未挂载 attachScope 时为 undefined） */
      dataScope?: DataScope
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
  /** 当前 access token 的会话标识（jti），用于精准登出/改密轮转；旧 token 可能缺失 */
  tokenJti?: string
}

export {}
