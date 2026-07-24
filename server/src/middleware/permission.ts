import type { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'

/**
 * 权限中间件工厂：requirePermission(resource, action)。
 * 默认拒绝：无 req.authUser → 401；角色无对应 permission 记录 → 403。
 * 权限判定统一走 permission 表，禁止硬编码 if(role==='admin')。
 */
export function requirePermission(resource: string, action: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const authUser = req.authUser
      if (!authUser) {
        throw errors.unauthorized('未登录')
      }

      const permission = await prisma.permission.findFirst({
        where: { roleId: authUser.roleId, resource, action },
        select: { id: true },
      })
      if (!permission) {
        throw errors.forbidden(`无权限：${resource}:${action}`)
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
