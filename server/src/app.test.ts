import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { hashPassword } from './lib/password'
import { signAccessToken } from './lib/jwt'

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    tokenBlacklist: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    permission: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
  recordAudit: vi.fn(),
}))

vi.mock('./lib/prisma', () => ({
  prisma: mocks.prisma,
  basePrisma: mocks.prisma,
  prismaForUser: vi.fn(),
}))

vi.mock('./middleware/audit', () => ({
  recordAudit: mocks.recordAudit,
  clientIp: vi.fn(() => '127.0.0.1'),
}))

import request from 'supertest'
import { createApp } from './app'

const app = createApp()

let passwordHash = ''

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    username: 'alice',
    displayName: '爱丽丝',
    passwordHash,
    roleId: 'r-admin',
    companyCode: null,
    status: 'active',
    refreshTokenJti: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    role: { id: 'r-admin', code: 'admin', scopeValue: '*', status: 'active', permissions: [{ resource: 'admin:users:view', action: 'view' }] },
    ...overrides,
  }
}

beforeAll(async () => {
  passwordHash = await hashPassword('Yipinhui@2026')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.$transaction.mockImplementation(async (arr: Promise<unknown>[]) => Promise.all(arr))
  mocks.prisma.user.update.mockResolvedValue({})
  mocks.prisma.tokenBlacklist.upsert.mockResolvedValue({})
  mocks.prisma.$queryRaw.mockResolvedValue([{ '1': 1 }])
  mocks.recordAudit.mockResolvedValue(undefined)
})

describe('健康检查', () => {
  it('GET /health 返回统一响应 + db 状态', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.db).toBe('up')
    expect(res.body.traceId).toBeTruthy()
    expect(res.headers['x-request-id']).toBeTruthy()
  })
})

describe('POST /api/v1/auth/login', () => {
  it('成功登录返回 accessToken/refreshToken/user，统一响应含 traceId', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser())
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'Yipinhui@2026' })

    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data.accessToken).toBeTruthy()
    expect(res.body.data.refreshToken).toBeTruthy()
    expect(res.body.data.user).toMatchObject({ username: 'alice', role: 'admin' })
    expect(res.body.traceId).toBeTruthy()
  })

  it('缺少字段 → 400（Zod 校验）', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({})
    expect(res.status).toBe(400)
    expect(res.body.code).toBe(400)
  })

  it('密码错误 → 401', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser())
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'wrong-password' })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe(401)
  })
})

describe('GET /api/v1/auth/profile', () => {
  it('无 token → 401', async () => {
    const res = await request(app).get('/api/v1/auth/profile')
    expect(res.status).toBe(401)
    expect(res.body.code).toBe(401)
  })

  it('携带合法 token → 200 返回用户', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser())
    const token = signAccessToken({ userId: 'u1', username: 'alice', roleCode: 'admin' })
    const res = await request(app)
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toMatchObject({ id: 'u1', role: 'admin' })
  })
})

describe('全链路：登录 → profile → refresh → logout', () => {
  it('走通主要认证流程', async () => {
    // 登录
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser())
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'Yipinhui@2026' })
    expect(loginRes.status).toBe(200)
    const { accessToken, refreshToken } = loginRes.body.data

    // profile
    const profileRes = await request(app)
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(profileRes.status).toBe(200)

    // refresh：需库中 jti 与令牌一致
    const jwtLib = await import('./lib/jwt')
    const decoded = jwtLib.verifyRefreshToken(refreshToken)
    mocks.prisma.tokenBlacklist.findUnique.mockResolvedValue(null)
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser({ refreshTokenJti: decoded.jti }))
    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
    expect(refreshRes.status).toBe(200)
    expect(refreshRes.body.data.accessToken).toBeTruthy()

    // logout
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser({ refreshTokenJti: 'jti-x' }))
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(logoutRes.status).toBe(200)
    expect(logoutRes.body.code).toBe(0)
  })
})

describe('404 与统一错误响应', () => {
  it('未知路由 → 404 统一响应', async () => {
    const res = await request(app).get('/api/v1/not-exist')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe(404)
    expect(res.body.traceId).toBeTruthy()
  })
})
