import { createHash, randomInt } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { hashPassword, assertPasswordRule } from '../lib/password'
import { sendMail, buildPasswordResetMail } from '../lib/mailer'

/**
 * 密码重置服务（邮箱验证码，单次有效）：
 *   requestCode(identifier) —— 忘记密码第一步：定位账号并下发 6 位验证码
 *   reset(identifier, code, newPassword) —— 第二步：验码 + 重置密码 + 吊销全部会话
 *
 * 防护设计：
 *   - 防账号枚举：凭据未命中 / 未绑定邮箱 / 已停用一律与命中时同响应（静默返回），仅审计差异
 *   - 验证码仅存 SHA-256 哈希，明文只出现在邮件；错 5 次立即作废；10 分钟有效；60s 重发冷却
 *   - 重置成功吊销全部会话（refresh jti 清空 + 持久免登令牌清除），复用管理员重置的吊销口径
 *   - 邮箱由管理员在用户管理中维护，本服务不提供绑定/换绑（邮箱验证码仅用于重置密码）
 */

const CODE_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
const RESEND_COOLDOWN_MS = 60 * 1000

interface AuditMeta {
  ip?: string | null
  userAgent?: string | null
  traceId?: string
}

/** 验证码 SHA-256 哈希（落库用） */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/**
 * 按凭据定位用户：含 @ 按邮箱（唯一约束），否则按用户名（唯一约束）。
 * 邮箱入库时统一转小写（AdminService.normalizeEmail），此处一致小写化后比对。
 */
function findUser(identifier: string) {
  const value = identifier.trim()
  return value.includes('@')
    ? prisma.user.findUnique({ where: { email: value.toLowerCase() } })
    : prisma.user.findUnique({ where: { username: value } })
}

/** 验码失败的统一错误（不区分「错误 / 过期 / 已消费」，避免泄露状态细节） */
function invalidCodeError() {
  return errors.badRequest('验证码错误或已过期，请重新获取')
}

export const PasswordResetService = {
  /**
   * 申请重置验证码。
   * 命中且已绑定邮箱 → 下发邮件；其余情况静默返回（响应与命中完全一致，防枚举）。
   */
  async requestCode(identifier: string, meta: AuditMeta = {}): Promise<void> {
    const user = await findUser(identifier)

    if (!user || user.status !== 'active' || !user.email) {
      await recordAudit(
        {
          userId: user?.id ?? null,
          module: 'auth',
          action: 'password_reset_request',
          targetId: identifier.trim().slice(0, 64),
          detail: { hit: false },
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        },
        meta.traceId,
      )
      return
    }

    // 重发冷却：同账号 60s 内重复申请直接拒绝（此时已确认命中，提示明确些）
    const now = new Date()
    const latest = await prisma.passwordResetCode.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
    if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw errors.tooManyRequests('验证码发送过于频繁，请 1 分钟后再试')
    }

    // 惰性清理：全局过期码 + 该用户全部旧码（新码签发后旧码一律失效）
    await prisma.passwordResetCode.deleteMany({ where: { expiresAt: { lt: now } } })
    await prisma.passwordResetCode.deleteMany({ where: { userId: user.id } })

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS)
    await prisma.passwordResetCode.create({
      data: { userId: user.id, email: user.email, codeHash: hashCode(code), expiresAt },
    })

    // 先落库后发送：发送失败时保留记录，冷却后可重申（新码自动作废旧码）
    await sendMail(buildPasswordResetMail({ to: user.email, code, expiresAt, username: user.username }))

    await recordAudit(
      {
        userId: user.id,
        module: 'auth',
        action: 'password_reset_request',
        targetId: user.id,
        detail: { hit: true },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
      meta.traceId,
    )
  },

  /** 重置密码：验码 → 更新密码 + 吊销全部会话 → 审计 */
  async reset(identifier: string, code: string, newPassword: string, meta: AuditMeta = {}): Promise<void> {
    assertPasswordRule(newPassword)
    const user = await findUser(identifier)
    if (!user) throw invalidCodeError()

    const record = await prisma.passwordResetCode.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
    if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now() || record.attempts >= MAX_ATTEMPTS) {
      throw invalidCodeError()
    }

    // 错误尝试计数：达到上限即作废（consumedAt），须重新申请
    if (record.codeHash !== hashCode(code.trim())) {
      const attempts = record.attempts + 1
      await prisma.passwordResetCode.update({
        where: { id: record.id },
        data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
      })
      throw invalidCodeError()
    }

    const passwordHash = await hashPassword(newPassword)
    await prisma.$transaction([
      prisma.passwordResetCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          // 用户自设新密码，解除管理员强制改密标记
          mustChangePassword: false,
          // 吊销全部既有信任：所有 refresh 会话 + 持久免登令牌（与 AdminService.resetPassword 口径一致）
          refreshTokenJtiList: [],
          persistentLoginTokenHash: null,
          persistentLoginExpiresAt: null,
          persistentLoginCreatedAt: null,
        },
      }),
    ])

    await recordAudit(
      {
        userId: user.id,
        module: 'auth',
        action: 'password_reset',
        targetId: user.id,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
      meta.traceId,
    )
  },
}
