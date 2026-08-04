import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

const mocks = vi.hoisted(() => ({
  prisma: { permission: { findFirst: vi.fn() } },
}))

vi.mock('../lib/prisma', () => ({
  prisma: mocks.prisma,
  basePrisma: mocks.prisma,
  prismaForUser: vi.fn(),
}))

import { requirePermission, requireAnyPermission } from './permission'

function runMiddleware(reqOverrides: Partial<Request>) {
  const req = reqOverrides as Request
  const res = {} as Response
  const next = vi.fn() as unknown as NextFunction
  return { req, res, next: next as ReturnType<typeof vi.fn> }
}

beforeEach(() => vi.clearAllMocks())

describe('requirePermission', () => {
  it('未登录 → next(401)', async () => {
    const { req, res, next } = runMiddleware({ authUser: undefined })
    await requirePermission('dashboard:view', 'view')(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 401 }))
  })

  it('有对应权限 → 放行（next 无参）', async () => {
    mocks.prisma.permission.findFirst.mockResolvedValue({ id: 'p1' })
    const { req, res, next } = runMiddleware({
      authUser: { userId: 'u1', username: 'a', roleId: 'r1', roleCode: 'admin', scopeValue: '*', companyCode: null },
    })
    await requirePermission('dashboard:view', 'view')(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledWith()
  })

  it('无对应权限 → next(403)（默认拒绝）', async () => {
    mocks.prisma.permission.findFirst.mockResolvedValue(null)
    const { req, res, next } = runMiddleware({
      authUser: { userId: 'u1', username: 'a', roleId: 'r-viewer', roleCode: 'viewer', scopeValue: '', companyCode: null },
    })
    await requirePermission('admin:users:view', 'view')(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 403 }))
  })
})

const ANY_GRANTS = [
  { resource: 'dashboard:view', action: 'view' as const },
  { resource: 'indicators:view', action: 'view' as const },
]

describe('requireAnyPermission', () => {
  it('未登录 → next(401)', async () => {
    const { req, res, next } = runMiddleware({ authUser: undefined })
    await requireAnyPermission(ANY_GRANTS)(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 401 }))
  })

  it('任一候选权限命中 → 放行（next 无参）', async () => {
    mocks.prisma.permission.findFirst.mockResolvedValue({ id: 'p1' })
    const { req, res, next } = runMiddleware({
      authUser: { userId: 'u1', username: 'a', roleId: 'r-viewer', roleCode: 'viewer', scopeValue: '', companyCode: null },
    })
    await requireAnyPermission(ANY_GRANTS)(req, res, next)
    expect(next).toHaveBeenCalledWith()
    // 候选权限以 OR 条件下推 permission 表
    expect(mocks.prisma.permission.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ roleId: 'r-viewer', OR: expect.any(Array) }),
    }))
  })

  it('全部候选未命中 → next(403)（默认拒绝）', async () => {
    mocks.prisma.permission.findFirst.mockResolvedValue(null)
    const { req, res, next } = runMiddleware({
      authUser: { userId: 'u1', username: 'a', roleId: 'r-none', roleCode: 'none', scopeValue: '', companyCode: null },
    })
    await requireAnyPermission(ANY_GRANTS)(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 403 }))
  })
})
