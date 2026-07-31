import type { Request, Response, NextFunction } from 'express'
import type { PermissionAction } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit, clientIp, clientUserAgent } from './audit'

/**
 * 权限中间件工厂：requirePermission(resource, action)。
 * 默认拒绝：无 req.authUser → 401；角色无对应 permission 记录 → 403。
 * 权限判定统一走 permission 表，禁止硬编码 if(role==='admin')。
 * action 为 Prisma 枚举 PermissionAction，值域错误在编译期即被拦截。
 * 403 拒绝时补记审计（规范 §3.3），使越权尝试可追溯；审计失败不影响主流程。
 */
export function requirePermission(resource: string, action: PermissionAction) {
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
        // 审计失败（含 IP 提取异常）不得阻断拒绝主流程
        try {
          await recordAudit(
            {
              userId: authUser.userId,
              module: 'permission',
              action: 'denied',
              detail: { resource, action },
              ip: clientIp(req),
              userAgent: clientUserAgent(req),
            },
            req.traceId,
          )
        } catch { /* ignore */ }
        throw errors.forbidden(`无权限：${resource}:${action}`)
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
