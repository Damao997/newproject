import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signRefreshToken, verifyRefreshToken } from '../lib/jwt'
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
    mustChangePassword: false,
    refreshTokenJtiList: [],
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
    // 多会话：新 jti 追加而非覆盖
    const decoded = verifyRefreshToken(result.refreshToken)
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: expect.objectContaining({ refreshTokenJtiList: [decoded.jti] }) }),
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

  it('mustChangePassword=true 时登录返回标志，供前端强制改密', async () => {
    const passwordHash = await hashPassword('Yipinhui@2026')
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash, mustChangePassword: true }))
    const result = await AuthService.login('alice', 'Yipinhui@2026')
    expect(result.user.mustChangePassword).toBe(true)
  })

  it('mustChangePassword=false 时登录返回 false 标志', async () => {
    const passwordHash = await hashPassword('Yipinhui@2026')
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash, mustChangePassword: false }))
    const result = await AuthService.login('alice', 'Yipinhui@2026')
    expect(result.user.mustChangePassword).toBe(false)
  })

  it('多会话：既有 jti 列表保留，新 jti 追加（不踢下线）', async () => {
    const passwordHash = await hashPassword('Yipinhui@2026')
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash, refreshTokenJtiList: ['jti-old-1', 'jti-old-2'] }))
    const result = await AuthService.login('alice', 'Yipinhui@2026')
    const decoded = verifyRefreshToken(result.refreshToken)
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refreshTokenJtiList: ['jti-old-1', 'jti-old-2', decoded.jti] }),
      }),
    )
  })
})

describe('AuthService.refresh', () => {
  it('轮转：旧 jti 入黑名单并在列表内替换为新 jti，签发新令牌对', async () => {
    const { token, jti } = signRefreshToken('u1')
    mocks.prisma.tokenBlacklist.findUnique.mockResolvedValue(null)
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ refreshTokenJtiList: [jti] }))

    const result = await AuthService.refresh(token)

    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toBeTruthy()
    expect(result.refreshToken).not.toBe(token)
    const decoded = verifyRefreshToken(result.refreshToken)
    expect(mocks.prisma.tokenBlacklist.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jti }, create: expect.objectContaining({ jti }) }),
    )
    // 列表内：旧 jti 移除、新 jti 追加（同位置轮转，其他会话不受影响）
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ refreshTokenJtiList: [decoded.jti] }) }),
    )
    expect(mocks.prisma.$transaction).toHaveBeenCalled()
  })

  it('多会话：任一有效 jti 均可刷新，其他会话原样保留', async () => {
    const { token, jti } = signRefreshToken('u1')
    mocks.prisma.tokenBlacklist.findUnique.mockResolvedValue(null)
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ refreshTokenJtiList: ['jti-a', jti, 'jti-c'] }))

    const result = await AuthService.refresh(token)

    const decoded = verifyRefreshToken(result.refreshToken)
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ refreshTokenJtiList: ['jti-a', 'jti-c', decoded.jti] }) }),
    )
  })

  it('旧令牌重放（jti 不在列表中）→ 401', async () => {
    const { token } = signRefreshToken('u1')
    mocks.prisma.tokenBlacklist.findUnique.mockResolvedValue(null)
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ refreshTokenJtiList: ['another-jti'] }))
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
    mocks.prisma.user.findUnique.mockResolvedValue(makeUser({ refreshTokenJtiList: [jti], status: 'inactive' }))
    await expect(AuthService.refresh(token)).rejects.toMatchObject({ code: 401 })
  })
})

describe('AuthService.logout', () => {
  it('定位会话：仅将该 jti 入黑名单并从列表移除 + 审计', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u1', refreshTokenJtiList: ['jti-1', 'jti-2'] })
    await AuthService.logout('u1', 'jti-1', { ip: '127.0.0.1' })
    expect(mocks.prisma.tokenBlacklist.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jti: 'jti-1' } }),
    )
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ refreshTokenJtiList: ['jti-2'] }) }),
    )
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'auth', action: 'logout' }),
      undefined,
    )
  })

  it('无 jti 列表：幽灵 jti 仅入黑名单防重放，列表保持为空，审计照常', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u1', refreshTokenJtiList: [] })
    await AuthService.logout('u1', 'jti-1')
    expect(mocks.prisma.tokenBlacklist.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ refreshTokenJtiList: [] }) }),
    )
    expect(mocks.recordAudit).toHaveBeenCalled()
  })

  it('旧 access token 无会话 jti：回退全量清理（保持历史语义）', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u1', refreshTokenJtiList: ['jti-1', 'jti-2'] })
    await AuthService.logout('u1', undefined)
    expect(mocks.prisma.tokenBlacklist.upsert).toHaveBeenCalledTimes(2)
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ refreshTokenJtiList: [] }) }),
    )
  })

  it('幽灵会话（jti 已不在列表）：仅入黑名单防重放，不误踢其他活跃会话', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u1', refreshTokenJtiList: ['jti-1', 'jti-2'] })
    await AuthService.logout('u1', 'jti-ghost')
    // 仅该幽灵 jti 入黑名单（1 次 upsert），活跃会话列表原样保留
    expect(mocks.prisma.tokenBlacklist.upsert).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.tokenBlacklist.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jti: 'jti-ghost' } }),
    )
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ refreshTokenJtiList: ['jti-1', 'jti-2'] }) }),
    )
  })

  it('用户不存在：幂等返回，不审计', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null)
    await AuthService.logout('ghost', undefined)
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
  it('原密码正确 → 更新哈希、清除强制改密标志、当前会话轮转并返回新令牌对', async () => {
    const passwordHash = await hashPassword('old-pass-123')
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      status: 'active',
      mustChangePassword: true,
      passwordHash,
      refreshTokenJtiList: ['jti-cur', 'jti-other'],
      role: { code: 'admin', scopeValue: '*', status: 'active' },
    })
    const result = await AuthService.changePassword('u1', 'old-pass-123', 'new-pass-456', {}, 'jti-cur')
    expect(result.accessToken).toBeTruthy()
    const decoded = verifyRefreshToken(result.refreshToken)
    // 黑名单：仅当前会话旧 jti（upsert 幂等，防并发改密唯一冲突）
    expect(mocks.prisma.tokenBlacklist.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jti: 'jti-cur' }, create: expect.objectContaining({ jti: 'jti-cur' }) }),
    )
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ mustChangePassword: false, refreshTokenJtiList: ['jti-other', decoded.jti] }),
      }),
    )
  })

  it('原密码错误 → 400', async () => {
    const passwordHash = await hashPassword('old-pass-123')
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: 'active', passwordHash, refreshTokenJtiList: [] })
    await expect(AuthService.changePassword('u1', 'wrong', 'new-pass-456')).rejects.toMatchObject({ code: 400 })
  })
})
