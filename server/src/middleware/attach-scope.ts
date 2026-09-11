import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { prisma } from '../lib/prisma'
import { resolveScope } from './scope'
import { scopeStore } from './scope-context'

/**
 * 解析当前用户数据范围并注入请求上下文（ALS），供全局 Prisma 扩展（scopeContext）消费。
 * 须挂在 authenticate 之后：未鉴权请求不建 store，由 requirePermission 统一拒绝。
 *
 * 独立成文件以保持导入 DAG 无环：
 *   attach-scope → { lib/prisma, scope }；lib/prisma → { scope, soft-delete }；scope → scope-context
 */
export function attachScope(): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authUser = req.authUser
    if (!authUser) {
      next()
      return
    }
    try {
      // 此处尚未进入 store，resolveScope 自身的查询不被过滤，无递归风险
      const scope = await resolveScope(prisma, authUser)
      req.dataScope = scope
      scopeStore.run(scope, () => next())
    } catch (err) {
      next(err)
    }
  }
}
