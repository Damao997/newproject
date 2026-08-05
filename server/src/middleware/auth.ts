import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { verifyAccessToken } from '../lib/jwt'
import { errors } from '../lib/errors'
import type { AuthUserContext } from '../types/express'

/**
 * 强制改密豁免路径：首次登录须改密的用户仅可访问这些接口（改密/登出/资料），
 * 其余业务接口一律 403（配合 user.must_change_password 标志）。
 */
const EXEMPT_AUTH_PATHS = [
  { method: 'PUT', path: '/api/v1/auth/password' },
  { method: 'POST', path: '/api/v1/auth/logout' },
  { method: 'GET', path: '/api/v1/auth/profile' },
]

function isExemptPath(req: Request): boolean {
  return EXEMPT_AUTH_PATHS.some((e) => e.method === req.method && req.originalUrl.startsWith(e.path))
}

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
      // orgScopeBu 为 Json? 字段，需显式 select（include role 时已含全部 user 字段）
    })
    if (!user || user.status !== 'active') {
      throw errors.unauthorized('用户不存在或已停用')
    }
    if (user.role.status !== 'active') {
      throw errors.forbidden('所属角色已停用')
    }

    // 首次登录强制改密：未改密前仅放行改密/登出/资料接口，其余业务接口一律 403
    if (user.mustChangePassword && !isExemptPath(req)) {
      throw errors.forbidden('首次登录须修改密码后才能继续使用')
    }

    const context: AuthUserContext = {
      userId: user.id,
      username: user.username,
      roleId: user.roleId,
      roleCode: user.role.code,
      scopeValue: user.role.scopeValue,
      companyCode: user.companyCode ?? null,
      // orgScopeBu / dataScopeCodes 为 Json? 字段，运行时校验为字符串数组后收窄类型
      orgScopeBu: Array.isArray(user.orgScopeBu) ? (user.orgScopeBu as string[]) : null,
      dataScopeCodes: Array.isArray(user.dataScopeCodes) ? (user.dataScopeCodes as string[]) : null,
      // 会话标识：登出/改密时精准轮转对应 jti（旧 token 无 jti，回退全量清理）
      tokenJti: payload.jti,
    }
    req.authUser = context
    next()
  } catch (err) {
    next(err)
  }
}
