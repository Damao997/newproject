import { prisma } from '../lib/prisma'
import { verifyPassword, hashPassword } from '../lib/password'
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
} from '../lib/jwt'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { loadConfig } from '../config/env'

/**
 * 认证服务：登录 / 刷新（轮转）/ 登出 / 资料 / 改密。
 * DB→前端映射：role.code→role、display_name→name、company/BU/scope→dataScope，
 * 对齐 web/src/types 的 User / LoginResponse。
 */

// 与前端 web/src/types 对齐的对外用户结构
export interface FrontendUser {
  id: string
  username: string
  name: string
  role: string
  /** 角色权限码列表（`resource:action`），前端 usePermission 优先使用 */
  permissions: string[]
  dataScope: string
  status: 'active' | 'inactive'
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
}

export interface LoginResult {
  accessToken: string
  refreshToken: string
  user: FrontendUser
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

interface AuditMeta {
  ip?: string | null
  traceId?: string
}

// Prisma user + role 组合类型（避免引入生成类型的显式命名）
type UserWithRole = NonNullable<Awaited<ReturnType<typeof findUserWithRole>>>

function findUserWithRole(where: { id: string } | { username: string }) {
  return prisma.user.findUnique({
    where: where as { id: string },
    include: { role: { include: { permissions: true } } },
  })
}

function toFrontendUser(user: UserWithRole): FrontendUser {
  let dataScope: string
  if (user.companyCode) {
    dataScope = user.companyCode
  } else if (user.role.scopeValue === '*') {
    dataScope = '全部'
  } else {
    dataScope = '无'
  }

  // permission.resource 已是完整权限码（如 admin:users:view），去重后下发
  const permissions = Array.from(new Set(user.role.permissions.map((p) => p.resource)))

  return {
    id: user.id,
    username: user.username,
    name: user.displayName,
    role: user.role.code,
    permissions,
    dataScope,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

export const AuthService = {
  /** 登录：校验凭证 → 签发令牌 → 记录 refresh jti → 审计 */
  async login(username: string, password: string, meta: AuditMeta = {}): Promise<LoginResult> {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { role: { include: { permissions: true } } },
    })

    // 用户不存在 / 已停用 / 密码错误：统一返回同一错误，避免用户枚举
    const ok = user && user.status === 'active' && (await verifyPassword(password, user.passwordHash))
    if (!user || !ok) {
      await recordAudit(
        {
          userId: user?.id ?? null,
          module: 'auth',
          action: 'login_failed',
          targetId: username,
          ip: meta.ip ?? null,
        },
        meta.traceId,
      )
      throw errors.unauthorized('用户名或密码错误')
    }

    const accessToken = signAccessToken({
      userId: user.id,
      username: user.username,
      roleCode: user.role.code,
    })
    const { token: refreshToken, jti } = signRefreshToken(user.id)

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenJti: jti },
    })

    await recordAudit(
      { userId: user.id, module: 'auth', action: 'login', targetId: user.id, ip: meta.ip ?? null },
      meta.traceId,
    )

    return { accessToken, refreshToken, user: toFrontendUser(user) }
  },

  /** 刷新：验签 + 比对 jti + 黑名单 → 轮转（旧 jti 入黑名单，签发新对） */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload
    try {
      payload = verifyRefreshToken(refreshToken)
    } catch {
      throw errors.unauthorized('刷新令牌无效或已过期')
    }

    // 黑名单校验（已登出/已轮转的旧令牌）
    const blacklisted = await prisma.tokenBlacklist.findUnique({ where: { jti: payload.jti } })
    if (blacklisted) {
      throw errors.unauthorized('刷新令牌已失效')
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    })
    if (!user || user.status !== 'active') {
      throw errors.unauthorized('用户不存在或已停用')
    }

    // 轮转防重放：仅当前记录的 jti 有效，防止旧 refresh 复用
    if (user.refreshTokenJti !== payload.jti) {
      throw errors.unauthorized('刷新令牌已失效')
    }

    const newAccess = signAccessToken({
      userId: user.id,
      username: user.username,
      roleCode: user.role.code,
    })
    const { token: newRefresh, jti: newJti } = signRefreshToken(user.id)

    // 事务：旧 jti 入黑名单 + 更新为新 jti
    await prisma.$transaction([
      prisma.tokenBlacklist.create({
        data: {
          jti: payload.jti,
          userId: user.id,
          expiredAt: getRefreshTokenExpiry(refreshToken),
        },
      }),
      prisma.user.update({ where: { id: user.id }, data: { refreshTokenJti: newJti } }),
    ])

    return { accessToken: newAccess, refreshToken: newRefresh }
  },

  /** 登出：当前 refresh jti 入黑名单 + 清空，记录审计 */
  async logout(userId: string, meta: AuditMeta = {}): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      // 幂等：用户不存在也视为已登出
      return
    }
    if (user.refreshTokenJti) {
      const ttlDays = 7
      const expiredAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
      await prisma.$transaction([
        prisma.tokenBlacklist.upsert({
          where: { jti: user.refreshTokenJti },
          create: { jti: user.refreshTokenJti, userId: user.id, expiredAt },
          update: {},
        }),
        prisma.user.update({ where: { id: user.id }, data: { refreshTokenJti: null } }),
      ])
    }
    await recordAudit(
      { userId, module: 'auth', action: 'logout', targetId: userId, ip: meta.ip ?? null },
      meta.traceId,
    )
  },

  /** 获取当前用户资料（映射为前端结构） */
  async getProfile(userId: string): Promise<FrontendUser> {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: { include: { permissions: true } } } })
    if (!user || user.status !== 'active') {
      throw errors.unauthorized('用户不存在或已停用')
    }
    return toFrontendUser(user)
  },

  /** 修改密码：校验原密码 → bcrypt 更新 */
  async changePassword(userId: string, oldPassword: string, newPassword: string, meta: AuditMeta = {}): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.status !== 'active') {
      throw errors.unauthorized('用户不存在或已停用')
    }
    const matched = await verifyPassword(oldPassword, user.passwordHash)
    if (!matched) {
      throw errors.badRequest('原密码不正确')
    }
    // 复用配置校验（确保 bcryptCost 合法）
    loadConfig()
    const passwordHash = await hashPassword(newPassword)
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, refreshTokenJti: null },
    })
    await recordAudit(
      { userId, module: 'auth', action: 'update', targetId: userId, detail: { field: 'password' }, ip: meta.ip ?? null },
      meta.traceId,
    )
  },
}
