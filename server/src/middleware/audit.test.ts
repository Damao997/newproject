import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request } from 'express'

/**
 * 审计中间件单测：User-Agent 采集与截断（B3）。
 * 不触库：mock prisma.auditLog.create，断言写入参数。
 */

const mocks = vi.hoisted(() => ({
  prisma: { auditLog: { create: vi.fn() } },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../lib/prisma', () => ({
  prisma: mocks.prisma,
  basePrisma: mocks.prisma,
  prismaForUser: vi.fn(),
}))

vi.mock('../lib/logger', () => ({ logger: mocks.logger }))

import { clientUserAgent, clientIp, auditMeta, recordAudit } from './audit'

/** 构造最小 Request 替身：仅实现 header() 与 ip/socket */
function fakeReq(headers: Record<string, string>, ip = '10.0.0.1'): Request {
  return {
    header: (name: string) => headers[name] ?? headers[name.toLowerCase()],
    ip,
    socket: { remoteAddress: ip },
    traceId: 'trace-1',
  } as unknown as Request
}

beforeEach(() => vi.clearAllMocks())

describe('clientUserAgent', () => {
  it('返回原始 UA', () => {
    expect(clientUserAgent(fakeReq({ 'User-Agent': 'Mozilla/5.0 Chrome/120' }))).toBe('Mozilla/5.0 Chrome/120')
  })

  it('缺失 UA → null（不抛错）', () => {
    expect(clientUserAgent(fakeReq({}))).toBeNull()
  })

  it('超长 UA 截断至 512 字符（对齐列宽，避免写入失败）', () => {
    const long = 'U'.repeat(600)
    const got = clientUserAgent(fakeReq({ 'User-Agent': long }))
    expect(got).toHaveLength(512)
  })

  it('恰好 512 字符不截断', () => {
    const exact = 'U'.repeat(512)
    expect(clientUserAgent(fakeReq({ 'User-Agent': exact }))).toHaveLength(512)
  })
})

describe('auditMeta', () => {
  it('一次性提取 ip + userAgent + traceId', () => {
    const req = fakeReq({ 'User-Agent': 'curl/8.0', 'X-Forwarded-For': '203.0.113.7, 10.0.0.1' })
    expect(auditMeta(req)).toEqual({ ip: '203.0.113.7', userAgent: 'curl/8.0', traceId: 'trace-1' })
  })

  it('无 XFF 时回落 req.ip', () => {
    expect(clientIp(fakeReq({}, '192.168.1.9'))).toBe('192.168.1.9')
  })
})

describe('recordAudit', () => {
  it('userAgent 落库', async () => {
    mocks.prisma.auditLog.create.mockResolvedValue({})
    await recordAudit({ module: 'auth', action: 'login', ip: '1.2.3.4', userAgent: 'Mozilla/5.0' })
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ip: '1.2.3.4', userAgent: 'Mozilla/5.0' }),
    })
  })

  it('未传 userAgent → 落 null（兼容既有调用方）', async () => {
    mocks.prisma.auditLog.create.mockResolvedValue({})
    await recordAudit({ module: 'data', action: 'import' })
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userAgent: null }),
    })
  })

  it('调用方直传超长 UA 时兜底截断（防 22001 写入失败）', async () => {
    mocks.prisma.auditLog.create.mockResolvedValue({})
    await recordAudit({ module: 'auth', action: 'login', userAgent: 'X'.repeat(900) })
    const arg = mocks.prisma.auditLog.create.mock.calls[0]?.[0] as { data: { userAgent: string } }
    expect(arg.data.userAgent).toHaveLength(512)
  })

  it('写入异常不抛出（审计失败不阻断主流程）', async () => {
    mocks.prisma.auditLog.create.mockRejectedValue(new Error('db down'))
    await expect(recordAudit({ module: 'auth', action: 'login' }, 'trace-x')).resolves.toBeUndefined()
    expect(mocks.logger.error).toHaveBeenCalled()
  })
})
