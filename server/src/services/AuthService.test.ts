import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signRefreshToken } from '../lib/jwt'
import { hashPassword } from '../lib/password'

// 通过 vi.hoisted 构造可变 mock，供 vi.mock 工厂与用例共享
const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    tokenBlacklist: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  recordAudit: vi.fn(),
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

import { AuthService } from './AuthService'

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    username: 'alice',
    displayName: '爱丽丝',
    passwordHash: 'placeholder',
    roleId: 'r-admin',
    companyCode: null,
    status: 'active',
    refreshTokenJti: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    role: { id: 'r-admin', code: 'admin', scopeValue: '*', status: 'active', permissions: [{ resource: 'admin:users:view', action: 'view' }, { resource: 'admin:users:view', action: 'view' }] },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.$transaction.mockImplementation(async (arr: Promise<unknown>[]) => Promise.all(arr))
  mocks.prisma.user.update.mockResolvedValue({})
  mocks.prisma.tokenBlacklist.create.mockResolvedValue({})
  mocks.prisma.tokenBlacklist.upsert.mockResolvedValue({})
  mocks.recordAudit.mockResolvedValue(undefined)
})

describe('AuthService.login', () => {
  it('成功登录返回令牌与映射后的用户，记录 login 审计', async () => {
    const passwordHash = await hashPassword('Yipinhui@2026')
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }))

    const result = await AuthService.login('alice', 'Yipinhui@2026', { ip: '127.0.0.1' })

    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toBeTruthy()
    expect(result.user).toMatchObject({
      id: 'u1',
      username: 'alice',
      name: '爱丽丝',
      role: 'admin',
      dataScope: '全部',
      status: 'active',
    })
    // 角色权限映射为去重后的权限码列表
    expect(result.user.permissions).toEqual(['admin:users:view'])
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' } }),
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'auth', action: 'login' }),
      undefined,
    )
  })

  it('dataScope 优先取 companyCode', async () => {
    const passwordHash = await hashPassword('Yipinhui@2026')
    mocks.prisma.user.findUnique.mockResolvedValue(
      makeUser({ passwordHash, companyCode: 'EN330059', role: { code: 'finance_manager', scopeValue: '', status: 'active', permissions: [] } }),
    )
    const result = await AuthService.login('alice', 'Yipinhui@2026')
    expect(result.user.dataScope).toBe('EN330059')
    expect(result.user.role).toBe('finance_manager')
  })

  it('密码错误抛 401 并记录 login_failed', async () => {
    const passwordHash = await hashPassword('correct-pw-123')
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }))

    await expect(AuthService.login('alice', 'wrong-pw')).rejects.toMatchObject({ code: 401 })
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'login_failed', userId: 'u1' }),
      undefined,
    )
  })

  it('用户不存在抛 401，审计 userId 为 null', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null)
    await expect(AuthService.login('ghost', 'x')).rejects.toMatchObject({ code: 401 })
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'login_failed', userId: null }),
      undefined,
    )
  })

  it('已停用用户拒绝登录', async () => {
    const passwordHash = await hashPassword('Yipinhui@2026')
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash, status: 'inactive' }))
    await expect(AuthService.login('alice', 'Yipinhui@2026')).rejects.toMatchObject({ code: 401 })
  })
})

describe('AuthService.refresh', () => {
  it('轮转：旧 jti 入黑名单并签发新令牌对', async () => {
    const { token, jti } = signRefreshToken('u1')
    mocks.prisma.tokenBlacklist.findUnique.mockResolvedValue(null)
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ refreshTokenJti: jti }))

    const result = await AuthService.refresh(token)

    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toBeTruthy()
    expect(result.refreshToken).not.toBe(token)
    expect(mocks.prisma.tokenBlacklist.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ jti }) }),
    )
    expect(mocks.prisma.$transaction).toHaveBeenCalled()
  })

  it('旧令牌重放（jti 与库中不一致）→ 401', async () => {
    const { token } = signRefreshToken('u1')
    mocks.prisma.tokenBlacklist.findUnique.mockResolvedValue(null)
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ refreshTokenJti: 'another-jti' }))
    await expect(AuthService.refresh(token)).rejects.toMatchObject({ code: 401 })
  })

  it('已在黑名单 → 401', async () => {
    const { token, jti } = signRefreshToken('u1')
    mocks.prisma.tokenBlacklist.findUnique.mockResolvedValue({ jti })
    await expect(AuthService.refresh(token)).rejects.toMatchObject({ code: 401 })
  })

  it('非法/篡改 token → 401', async () => {
    await expect(AuthService.refresh('garbage.token')).rejects.toMatchObject({ code: 401 })
  })

  it('用户停用 → 401', async () => {
    const { token, jti } = signRefreshToken('u1')
    mocks.prisma.tokenBlacklist.findUnique.mockResolvedValue(null)
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ refreshTokenJti: jti, status: 'inactive' }))
    await expect(AuthService.refresh(token)).rejects.toMatchObject({ code: 401 })
  })
})

describe('AuthService.logout', () => {
  it('存在 refresh jti：入黑名单 + 清空 + 审计', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u1', refreshTokenJti: 'jti-1' })
    await AuthService.logout('u1', { ip: '127.0.0.1' })
    expect(mocks.prisma.tokenBlacklist.upsert).toHaveBeenCalled()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'auth', action: 'logout' }),
      undefined,
    )
  })

  it('无 refresh jti：跳过黑名单但仍审计', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u1', refreshTokenJti: null })
    await AuthService.logout('u1')
    expect(mocks.prisma.tokenBlacklist.upsert).not.toHaveBeenCalled()
    expect(mocks.recordAudit).toHaveBeenCalled()
  })

  it('用户不存在：幂等返回，不审计', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null)
    await AuthService.logout('ghost')
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})

describe('AuthService.getProfile', () => {
  it('返回映射后的用户', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser())
    const user = await AuthService.getProfile('u1')
    expect(user).toMatchObject({ id: 'u1', role: 'admin', name: '爱丽丝' })
  })

  it('用户停用 → 401', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ status: 'inactive' }))
    await expect(AuthService.getProfile('u1')).rejects.toMatchObject({ code: 401 })
  })
})

describe('AuthService.changePassword', () => {
  it('原密码正确 → 更新哈希并清空 refresh jti', async () => {
    const passwordHash = await hashPassword('old-pass-123')
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: 'active', passwordHash })
    await AuthService.changePassword('u1', 'old-pass-123', 'new-pass-456')
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ refreshTokenJti: null }),
      }),
    )
  })

  it('原密码错误 → 400', async () => {
    const passwordHash = await hashPassword('old-pass-123')
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: 'active', passwordHash })
    await expect(AuthService.changePassword('u1', 'wrong', 'new-pass-456')).rejects.toMatchObject({ code: 400 })
  })
})
