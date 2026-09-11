import { prisma } from '../lib/prisma'
import { Prisma } from '@prisma/client'
import { verifyPassword, hashPassword } from '../lib/password'
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
  generatePersistentLoginToken,
  hashPersistentLoginToken,
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
  /** 首次登录强制改密：true 时业务接口被拦截，须先改密 */
  mustChangePassword: boolean
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
}

export interface LoginResult {
  accessToken: string
  refreshToken: string
  user: FrontendUser
  /**
   * 「7 天内免登录」明文令牌（base64url）。仅在 rememberMe=true 时下发；
   * 客户端需存入 localStorage；服务端只保留 SHA-256 哈希。
   */
  persistentLoginToken?: string
  /** 持久令牌剩余有效期（毫秒），仅在有 persistentLoginToken 时返回 */
  persistentLoginExpiresInMs?: number
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

interface AuditMeta {
  ip?: string | null
  /** 客户端 User-Agent（已由 auditMeta() 截断至 512 字符） */
  userAgent?: string | null
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

/** 多会话上限：同账号最多同时保留的 refresh jti 数，超限淘汰最旧会话 */
const MAX_SESSIONS = 10

/** 读取 jti 列表（旧单值/空值兼容为 []） */
function readJtiList(user: { refreshTokenJtiList?: unknown }): string[] {
  return Array.isArray(user.refreshTokenJtiList) ? (user.refreshTokenJtiList as string[]) : []
}

/** 追加 jti（超限淘汰最旧） */
function appendJti(list: string[], jti: string): string[] {
  const next = [...list, jti]
  return next.length > MAX_SESSIONS ? next.slice(next.length - MAX_SESSIONS) : next
}

/** 移除指定 jti（精准登出/轮转） */
function removeJti(list: string[], jti: string): string[] {
  return list.filter((x) => x !== jti)
}

function toFrontendUser(user: UserWithRole): FrontendUser {
  const scopeCodes = Array.isArray(user.dataScopeCodes) ? (user.dataScopeCodes as string[]) : []
  let dataScope: string
  if (scopeCodes.length > 0) {
    dataScope = scopeCodes.join(',')
  } else if (user.companyCode) {
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
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

export const AuthService = {
  /** 登录：校验凭证 → 签发令牌 → 记录 refresh jti → 审计；rememberMe=true 时额外签发持久令牌 */
  async login(
    username: string,
    password: string,
    meta: AuditMeta = {},
    options: { rememberMe?: boolean } = {},
  ): Promise<LoginResult> {
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
          userAgent: meta.userAgent ?? null,
        },
        meta.traceId,
      )
      throw errors.unauthorized('用户名或密码错误')
    }

    const { token: refreshToken, jti } = signRefreshToken(user.id)
    const accessToken = signAccessToken({
      userId: user.id,
      username: user.username,
      roleCode: user.role.code,
      // 与 refresh token 共享会话 jti，登出/改密时可精准定位本会话
      jti,
    })

    // 多会话模型：追加而非覆盖，避免后登录会话把已登录会话踢下线
    const updateData: Prisma.UserUpdateInput = { refreshTokenJtiList: appendJti(readJtiList(user), jti) }
    let persistentLoginToken: string | undefined
    let persistentLoginExpiresInMs: number | undefined
    if (options.rememberMe) {
      const { raw, hash } = generatePersistentLoginToken()
      const ttlDays = loadConfig().persistentLoginTtlDays
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
      // 同一用户仅保留一个持久令牌：新登录覆盖（多设备互踢，与「勾选即免登」语义一致）
      updateData.persistentLoginTokenHash = hash
      updateData.persistentLoginExpiresAt = expiresAt
      updateData.persistentLoginCreatedAt = new Date()
      persistentLoginToken = raw
      persistentLoginExpiresInMs = ttlDays * 24 * 60 * 60 * 1000
    }

    await prisma.user.update({ where: { id: user.id }, data: updateData })

    await recordAudit(
      { userId: user.id, module: 'auth', action: 'login', targetId: user.id, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
      meta.traceId,
    )

    return {
      accessToken,
      refreshToken,
      user: toFrontendUser(user),
      ...(persistentLoginToken ? { persistentLoginToken, persistentLoginExpiresInMs } : {}),
    }
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

    // 轮转防重放：仅当前有效会话列表中的 jti 可刷新，任一命中即放行（多会话互不影响）
    const jtiList = readJtiList(user)
    if (!jtiList.includes(payload.jti)) {
      throw errors.unauthorized('刷新令牌已失效')
    }

    const { token: newRefresh, jti: newJti } = signRefreshToken(user.id)
    const newAccess = signAccessToken({
      userId: user.id,
      username: user.username,
      roleCode: user.role.code,
      // 与 refresh token 共享会话 jti，登出/改密时可精准定位本会话
      jti: newJti,
    })

    // 事务：旧 jti 入黑名单（upsert 幂等，并发重放同令牌不产生唯一冲突）+ 列表内移除旧 jti 并追加新 jti（仅轮转当前会话）
    await prisma.$transaction([
      prisma.tokenBlacklist.upsert({
        where: { jti: payload.jti },
        create: {
          jti: payload.jti,
          userId: user.id,
          expiredAt: getRefreshTokenExpiry(refreshToken),
        },
        update: {},
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { refreshTokenJtiList: appendJti(removeJti(jtiList, payload.jti), newJti) },
      }),
    ])

    return { accessToken: newAccess, refreshToken: newRefresh }
  },

  /**
   * 自动登录（凭持久令牌）：哈希上送明文 → 查 user → 校验未过期/未停用 →
   * 签发新的 access+refresh + 旋转持久令牌（DB 覆盖旧哈希，旧明文即刻失效，防重放）。
   * 失败统一返回 unauthenticated（不区分「无此令牌」/「已过期」/「用户停用」，避免信息泄漏）。
   * 审计 action 记为 auto_login，与密码登录区分。
   */
  async autoLogin(rawToken: string, meta: AuditMeta = {}): Promise<LoginResult> {
    const tokenHash = hashPersistentLoginToken(rawToken)

    // persistentLoginTokenHash 仅建索引未加唯一约束（同一用户轮转覆盖），用 findFirst
    const user = await prisma.user.findFirst({
      where: { persistentLoginTokenHash: tokenHash },
      include: { role: { include: { permissions: true } } },
    })

    const now = new Date()
    const expired = !user || user.status !== 'active' || !user.persistentLoginExpiresAt || user.persistentLoginExpiresAt.getTime() <= now.getTime()
    if (expired) {
      // 清理过期/失效的持久令牌字段，避免长期残留
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            persistentLoginTokenHash: null,
            persistentLoginExpiresAt: null,
            persistentLoginCreatedAt: null,
          },
        })
      }
      throw errors.unauthorized('免登录令牌无效或已过期')
    }

    // 签发新 access + refresh（共享 jti，落库追加）
    const { token: refreshToken, jti } = signRefreshToken(user.id)
    const accessToken = signAccessToken({
      userId: user.id,
      username: user.username,
      roleCode: user.role.code,
      jti,
    })

    // 旋转持久令牌：旧哈希被覆盖即作废，新明文下发给客户端
    const { raw: newRaw, hash: newHash } = generatePersistentLoginToken()
    const ttlDays = loadConfig().persistentLoginTtlDays
    const newExpiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshTokenJtiList: appendJti(readJtiList(user), jti),
        persistentLoginTokenHash: newHash,
        persistentLoginExpiresAt: newExpiresAt,
        persistentLoginCreatedAt: new Date(),
      },
    })

    await recordAudit(
      { userId: user.id, module: 'auth', action: 'auto_login', targetId: user.id, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
      meta.traceId,
    )

    return {
      accessToken,
      refreshToken,
      user: toFrontendUser(user),
      persistentLoginToken: newRaw,
      persistentLoginExpiresInMs: ttlDays * 24 * 60 * 60 * 1000,
    }
  },

  /** 登出：仅将当前会话 jti 入黑名单并从列表移除（其他会话不受影响），同时清理持久令牌（强制下次走密码登录），记录审计 */
  async logout(userId: string, tokenJti: string | undefined, meta: AuditMeta = {}): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      // 幂等：用户不存在也视为已登出
      return
    }
    const jtiList = readJtiList(user)
    // 三分支：旧 token 无 jti → 回退全量清理（保持历史语义）；
    // 有 jti 且在列表 → 精准吊销当前会话；有 jti 但已不在列表（被轮转/淘汰的幽灵会话）
    // → 仅将该 jti 入黑名单防未来重放，不动其他活跃会话
    let jtis: string[]
    let nextList: string[]
    if (!tokenJti) {
      jtis = jtiList
      nextList = []
    } else if (jtiList.includes(tokenJti)) {
      jtis = [tokenJti]
      nextList = removeJti(jtiList, tokenJti)
    } else {
      jtis = [tokenJti]
      nextList = jtiList
    }
    if (jtis.length > 0) {
      const ttlDays = 7
      const expiredAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
      await prisma.$transaction([
        ...jtis.map((jti) =>
          prisma.tokenBlacklist.upsert({
            where: { jti },
            create: { jti, userId: user.id, expiredAt },
            update: {},
          })
        ),
        prisma.user.update({
          where: { id: user.id },
          data: {
            refreshTokenJtiList: nextList,
            // 登出即视为用户主动结束所有「免登录」信任，清理持久令牌字段
            persistentLoginTokenHash: null,
            persistentLoginExpiresAt: null,
            persistentLoginCreatedAt: null,
          },
        }),
      ])
    } else {
      // 仅有持久令牌需要清理（无活跃会话）的兜底
      await prisma.user.update({
        where: { id: user.id },
        data: {
          persistentLoginTokenHash: null,
          persistentLoginExpiresAt: null,
          persistentLoginCreatedAt: null,
        },
      })
    }
    await recordAudit(
      { userId, module: 'auth', action: 'logout', targetId: userId, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
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

  /**
   * 修改密码：校验原密码 → bcrypt 更新 → 当前会话轮转（签发新 token 对，不清空其他会话）。
   * 返回新令牌对供前端静默续期，避免改密后强制跳转登录页。
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
    meta: AuditMeta = {},
    tokenJti?: string,
  ): Promise<TokenPair> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    })
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
    const jtiList = readJtiList(user)
    // 当前会话轮转：旧 jti 入黑名单并从列表移除（若可定位），追加新 jti；其余会话保留
    const targetJti = tokenJti && jtiList.includes(tokenJti) ? tokenJti : null
    const { token: newRefresh, jti: newJti } = signRefreshToken(user.id)
    const updatedJtiList = appendJti(targetJti ? removeJti(jtiList, targetJti) : jtiList, newJti)
    const accessToken = signAccessToken({
      userId: user.id,
      username: user.username,
      roleCode: user.role.code,
      // 与 refresh token 共享会话 jti，登出/改密时可精准定位本会话
      jti: newJti,
    })

    const ops: Prisma.PrismaPromise<unknown>[] = []
    if (targetJti) {
      ops.push(
        prisma.tokenBlacklist.upsert({
          // 当前会话 jti 入黑名单（与 refresh token 共享 jti），防并发改密下旧令牌重放；upsert 幂等
          where: { jti: targetJti },
          create: { jti: targetJti, userId: user.id, expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
          update: {},
        })
      )
    }
    ops.push(
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          refreshTokenJtiList: updatedJtiList,
          // 改密后强制重新登录所有免登录设备（吊销持久令牌）
          persistentLoginTokenHash: null,
          persistentLoginExpiresAt: null,
          persistentLoginCreatedAt: null,
        },
      })
    )
    await prisma.$transaction(ops)
    await recordAudit(
      { userId, module: 'auth', action: 'update', targetId: userId, detail: { field: 'password' }, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
      meta.traceId,
    )
    return { accessToken, refreshToken: newRefresh }
  },
}
