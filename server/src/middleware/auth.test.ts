import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { signAccessToken } from '../lib/jwt'

const mocks = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() } },
}))

vi.mock('../lib/prisma', () => ({
  prisma: mocks.prisma,
  basePrisma: mocks.prisma,
  prismaForUser: vi.fn(),
}))

import { authenticate } from './auth'

function makeReq(headers: Record<string, string>): Request {
  return {
    header: (name: string) => headers[name] ?? headers[name.toLowerCase()],
  } as unknown as Request
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    username: 'alice',
    roleId: 'r-admin',
    companyCode: null,
    status: 'active',
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
})
