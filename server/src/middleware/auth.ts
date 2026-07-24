import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { verifyAccessToken } from '../lib/jwt'
import { errors } from '../lib/errors'
import type { AuthUserContext } from '../types/express'

/**
 * 鉴权中间件：校验 access JWT → 加载用户与角色 → 注入 req.authUser。
 * 失败一律 401。
 * 说明：access token 短期（15min），刷新流程在 refresh 端校验 token_blacklist 与轮转。
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('Authorization')
    if (!header || !header.startsWith('Bearer ')) {
      throw errors.unauthorized('缺少访问令牌')
    }
    const token = header.slice('Bearer '.length).trim()
    if (!token) {
      throw errors.unauthorized('缺少访问令牌')
    }

    let payload
    try {
      payload = verifyAccessToken(token)
    } catch (e) {
      if (e instanceof jwt.TokenExpiredError) {
        throw errors.unauthorized('登录已过期')
      }
      throw errors.unauthorized('访问令牌无效')
    }

    // findUnique 不经软删除扩展，需手动校验用户状态
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    })
    if (!user || user.status !== 'active') {
      throw errors.unauthorized('用户不存在或已停用')
    }
    if (user.role.status !== 'active') {
      throw errors.forbidden('所属角色已停用')
    }

    const orgScopeBu = Array.isArray(user.orgScopeBu) ? (user.orgScopeBu as string[]) : null
    const context: AuthUserContext = {
      userId: user.id,
      username: user.username,
      roleId: user.roleId,
      roleCode: user.role.code,
      scopeValue: user.role.scopeValue,
      companyCode: user.companyCode ?? null,
      orgScopeBu,
    }
    req.authUser = context
    next()
  } catch (err) {
    next(err)
  }
}
