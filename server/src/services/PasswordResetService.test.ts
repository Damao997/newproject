import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

// 通过 vi.hoisted 构造可变 mock，供 vi.mock 工厂与用例共享
const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    passwordResetCode: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  recordAudit: vi.fn(),
  sendMail: vi.fn(),
}))

vi.mock('../lib/prisma', () => ({
  prisma: mocks.prisma,
  basePrisma: mocks.prisma,
  prismaForUser: vi.fn(),
}))

vi.mock('../middleware/audit', () => ({
  recordAudit: mocks.recordAudit,
  clientIp: vi.fn(() => '127.0.0.1'),
}))

// 邮件只 mock 发送动作；模板走真实实现（校验收件人/验证码透传）
vi.mock('../lib/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/mailer')>()
  return { ...actual, sendMail: mocks.sendMail }
})

import { PasswordResetService } from './PasswordResetService'

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    username: 'alice',
    displayName: '爱丽丝',
    email: 'alice@example.com',
    status: 'active',
    mustChangePassword: true,
    refreshTokenJtiList: ['jti-a', 'jti-b'],
    persistentLoginTokenHash: 'hash',
    persistentLoginExpiresAt: new Date('2026-12-01T00:00:00Z'),
    persistentLoginCreatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  }
}

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prc-1',
    userId: 'u1',
    email: 'alice@example.com',
    codeHash: hashCode('123456'),
    attempts: 0,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    consumedAt: null,
    createdAt: new Date(Date.now() - 5 * 1000),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // reset 使用数组式事务；回调形态兜底（与 AuthService.test 同口径）
  mocks.prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : (arg as (tx: unknown) => unknown)(mocks.prisma),
  )
  mocks.prisma.user.findUnique.mockResolvedValue(null)
  mocks.prisma.passwordResetCode.findFirst.mockResolvedValue(null)
  mocks.prisma.passwordResetCode.deleteMany.mockResolvedValue({ count: 0 })
  mocks.prisma.passwordResetCode.create.mockResolvedValue({})
  mocks.prisma.passwordResetCode.update.mockResolvedValue({})
  mocks.prisma.user.update.mockResolvedValue({})
  mocks.recordAudit.mockResolvedValue(undefined)
  mocks.sendMail.mockResolvedValue(undefined)
})

describe('PasswordResetService.requestCode', () => {
  it('凭据未命中：静默成功，不发邮件，审计记 hit:false（防枚举）', async () => {
    await PasswordResetService.requestCode('ghost')
    expect(mocks.sendMail).not.toHaveBeenCalled()
    expect(mocks.prisma.passwordResetCode.create).not.toHaveBeenCalled()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'auth', action: 'password_reset_request', detail: { hit: false } }),
      undefined,
    )
  })

  it('用户未绑定邮箱：静默成功，不发邮件', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ email: null }))
    await PasswordResetService.requestCode('alice')
    expect(mocks.sendMail).not.toHaveBeenCalled()
    expect(mocks.prisma.passwordResetCode.create).not.toHaveBeenCalled()
  })

  it('已停用用户：静默成功，不发邮件', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ status: 'inactive' }))
    await PasswordResetService.requestCode('alice')
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })

  it('命中且已绑定邮箱：签发 6 位验证码（哈希落库）、发邮件、审计 hit:true', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser())
    await PasswordResetService.requestCode('alice')

    const createArg = mocks.prisma.passwordResetCode.create.mock.calls[0][0].data
    expect(createArg).toMatchObject({ userId: 'u1', email: 'alice@example.com' })
    expect(createArg.expiresAt.getTime()).toBeGreaterThan(Date.now())
    // 落库为 SHA-256 哈希，明文只出现在邮件 capture 元数据里
    const mailed = mocks.sendMail.mock.calls[0][0]
    expect(mailed.captureMeta.code).toMatch(/^\d{6}$/)
    expect(createArg.codeHash).toBe(hashCode(mailed.captureMeta.code))
    expect(mailed.to).toBe('alice@example.com')
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'auth', action: 'password_reset_request', userId: 'u1', detail: { hit: true } }),
      undefined,
    )
  })

  it('邮箱凭据查找统一转小写', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser())
    await PasswordResetService.requestCode('Alice@Example.COM')
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'alice@example.com' } })
  })

  it('60s 内重复申请 → 429，且不签发新码', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser())
    mocks.prisma.passwordResetCode.findFirst.mockResolvedValue(makeRecord({ createdAt: new Date(Date.now() - 10 * 1000) }))
    await expect(PasswordResetService.requestCode('alice')).rejects.toMatchObject({ code: 429 })
    expect(mocks.prisma.passwordResetCode.create).not.toHaveBeenCalled()
  })

  it('签发前清理：删除全局过期码与该用户旧码', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser())
    await PasswordResetService.requestCode('alice')
    expect(mocks.prisma.passwordResetCode.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: expect.any(Date) } } })
    expect(mocks.prisma.passwordResetCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
  })
})

describe('PasswordResetService.reset', () => {
  it('验证码正确：消费验证码 + 重置密码 + 吊销全部会话 + 清除强制改密标记', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser())
    mocks.prisma.passwordResetCode.findFirst.mockResolvedValue(makeRecord())

    await PasswordResetService.reset('alice', '123456', 'newPass123', { ip: '127.0.0.1' })

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)
    const txArg = mocks.prisma.$transaction.mock.calls[0][0] as unknown[]
    expect(txArg).toHaveLength(2)
    expect(mocks.prisma.passwordResetCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'prc-1' }, data: expect.objectContaining({ consumedAt: expect.any(Date) }) }),
    )
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          mustChangePassword: false,
          refreshTokenJtiList: [],
          persistentLoginTokenHash: null,
          persistentLoginExpiresAt: null,
          persistentLoginCreatedAt: null,
        }),
      }),
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'auth', action: 'password_reset', userId: 'u1' }),
      undefined,
    )
  })

  it('验证码错误 → 400 且 attempts+1；不计审计 password_reset', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser())
    mocks.prisma.passwordResetCode.findFirst.mockResolvedValue(makeRecord({ codeHash: hashCode('999999') }))

    await expect(PasswordResetService.reset('alice', '123456', 'newPass123')).rejects.toMatchObject({ code: 400 })
    expect(mocks.prisma.passwordResetCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'prc-1' }, data: { attempts: 1 } }),
    )
    expect(mocks.prisma.user.update).not.toHaveBeenCalled()
  })

  it('错误达到 5 次：作废验证码（置 consumedAt），后续尝试直接 400', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser())
    mocks.prisma.passwordResetCode.findFirst.mockResolvedValue(makeRecord({ codeHash: hashCode('999999'), attempts: 4 }))

    await expect(PasswordResetService.reset('alice', '123456', 'newPass123')).rejects.toMatchObject({ code: 400 })
    expect(mocks.prisma.passwordResetCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'prc-1' }, data: expect.objectContaining({ attempts: 5, consumedAt: expect.any(Date) }) }),
    )
  })

  it('已消费 / 已过期 / attempts 达上限 → 统一 400，不再计数', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser())
    const cases = [
      makeRecord({ consumedAt: new Date() }),
      makeRecord({ expiresAt: new Date(Date.now() - 1000) }),
      makeRecord({ attempts: 5 }),
    ]
    for (const record of cases) {
      mocks.prisma.passwordResetCode.findFirst.mockResolvedValue(record)
      await expect(PasswordResetService.reset('alice', '123456', 'newPass123')).rejects.toMatchObject({ code: 400 })
    }
    expect(mocks.prisma.passwordResetCode.update).not.toHaveBeenCalled()
  })

  it('用户不存在 → 400（与验证码错误同文案，防枚举）', async () => {
    await expect(PasswordResetService.reset('ghost', '123456', 'newPass123')).rejects.toMatchObject({ code: 400 })
    expect(mocks.prisma.user.update).not.toHaveBeenCalled()
  })

  it('新密码不符合规则 → 400，且不触碰验证码与用户', async () => {
    await expect(PasswordResetService.reset('alice', '123456', 'short')).rejects.toMatchObject({ code: 400 })
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
