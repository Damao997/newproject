import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { signAccessToken } from '../lib/jwt'

const mocks = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() }, tokenBlacklist: { findUnique: vi.fn().mockResolvedValue(null) } },
}))

vi.mock('../lib/prisma', () => ({
  prisma: mocks.prisma,
  basePrisma: mocks.prisma,
  prismaForUser: vi.fn(),
}))

import { authenticate } from './auth'

function makeReq(headers: Record<string, string>, opts: { method?: string; originalUrl?: string } = {}): Request {
  return {
    header: (name: string) => headers[name] ?? headers[name.toLowerCase()],
    method: opts.method ?? 'GET',
    originalUrl: opts.originalUrl ?? '/api/v1/dashboard/overview',
  } as unknown as Request
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    username: 'alice',
    roleId: 'r-admin',
    companyCode: null,
    status: 'active',
    mustChangePassword: false,
    role: { code: 'admin', scopeValue: '*', status: 'active' },
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('authenticate 中间件', () => {
  it('缺少 Authorization 头 → 401', async () => {
    const req = makeReq({})
    const next = vi.fn() as unknown as NextFunction
    await authenticate(req, {} as Response, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 401 }))
  })

  it('jti 命中会话黑名单（登出/改密后旧 token）→ 401', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser())
    mocks.prisma.tokenBlacklist.findUnique.mockResolvedValueOnce({ jti: 'jti-1', userId: 'u1' })
    const token = signAccessToken({ userId: 'u1', username: 'alice', roleCode: 'admin' })
    const req = makeReq({ Authorization: `Bearer ${token}` })
    const next = vi.fn() as unknown as NextFunction
    await authenticate(req, {} as Response, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 401 }))
  })

  it('合法 access token → 注入 req.authUser 并放行', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser())
    const token = signAccessToken({ userId: 'u1', username: 'alice', roleCode: 'admin' })
    const req = makeReq({ Authorization: `Bearer ${token}` })
    const next = vi.fn() as unknown as NextFunction

    await authenticate(req, {} as Response, next)

    expect(next).toHaveBeenCalledWith()
    expect(req.authUser).toMatchObject({ userId: 'u1', roleCode: 'admin', scopeValue: '*' })
  })

  it('用户已停用 → 401', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser({ status: 'inactive' }))
    const token = signAccessToken({ userId: 'u1', username: 'alice', roleCode: 'admin' })
    const req = makeReq({ Authorization: `Bearer ${token}` })
    const next = vi.fn() as unknown as NextFunction
    await authenticate(req, {} as Response, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 401 }))
  })

  it('伪造 token → 401', async () => {
    const req = makeReq({ Authorization: 'Bearer not.a.jwt' })
    const next = vi.fn() as unknown as NextFunction
    await authenticate(req, {} as Response, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 401 }))
  })

  it('角色已停用 → 403', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(
      activeUser({ role: { code: 'admin', scopeValue: '*', status: 'inactive' } }),
    )
    const token = signAccessToken({ userId: 'u1', username: 'alice', roleCode: 'admin' })
    const req = makeReq({ Authorization: `Bearer ${token}` })
    const next = vi.fn() as unknown as NextFunction
    await authenticate(req, {} as Response, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 403 }))
  })

  it('强制改密中：业务接口 → 403（首次登录须修改密码）', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser({ mustChangePassword: true }))
    const token = signAccessToken({ userId: 'u1', username: 'alice', roleCode: 'admin' })
    const req = makeReq({ Authorization: `Bearer ${token}` }, { method: 'GET', originalUrl: '/api/v1/dashboard/overview' })
    const next = vi.fn() as unknown as NextFunction
    await authenticate(req, {} as Response, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 403, message: '首次登录须修改密码后才能继续使用' }))
  })

  it('强制改密中：改密接口（PUT /auth/password）放行', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser({ mustChangePassword: true }))
    const token = signAccessToken({ userId: 'u1', username: 'alice', roleCode: 'admin' })
    const req = makeReq({ Authorization: `Bearer ${token}` }, { method: 'PUT', originalUrl: '/api/v1/auth/password' })
    const next = vi.fn() as unknown as NextFunction
    await authenticate(req, {} as Response, next)
    expect(next).toHaveBeenCalledWith()
    expect(req.authUser).toMatchObject({ userId: 'u1' })
  })

  it('强制改密中：登出接口（POST /auth/logout）放行', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(activeUser({ mustChangePassword: true }))
    const token = signAccessToken({ userId: 'u1', username: 'alice', roleCode: 'admin' })
    const req = makeReq({ Authorization: `Bearer ${token}` }, { method: 'POST', originalUrl: '/api/v1/auth/logout' })
    const next = vi.fn() as unknown as NextFunction
    await authenticate(req, {} as Response, next)
    expect(next).toHaveBeenCalledWith()
  })
})
