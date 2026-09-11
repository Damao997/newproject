import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import { basePrisma } from '../lib/prisma'

/**
 * 端到端：登录审计是否真实落库 user_agent（B3）。
 *
 * 与 app.test.ts 的区别：本用例**不 mock** prisma / audit，
 * 直连本地库验证 audit_log.user_agent 真实写入。
 * 数据库不可用时整组跳过（与既有 DB 相关用例一致的处理）。
 */

const UA = 'YipinhuiE2E/1.0 (audit-user-agent-probe)'
const app = createApp()

let dbReady = false
let probeUserId: string | null = null

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (probeUserId) {
    await basePrisma.auditLog.deleteMany({ where: { userId: probeUserId } }).catch(() => undefined)
  }
  // 登录失败审计的 userId 为 null，按 UA 定向清理，避免污染审计表
  await basePrisma.auditLog.deleteMany({ where: { userAgent: UA } }).catch(() => undefined)
})

describe('审计日志 user_agent 端到端', () => {
  it('登录失败 → 落 login_failed 且带 IP 与 User-Agent', async () => {
    if (!dbReady) return

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('User-Agent', UA)
      .send({ username: '__e2e_not_exist__', password: 'WrongPassword123' })

    expect(res.status).toBe(401)

    const row = await basePrisma.auditLog.findFirst({
      where: { action: 'login_failed', userAgent: UA },
      orderBy: { createdAt: 'desc' },
      select: { module: true, action: true, ip: true, userAgent: true, targetId: true },
    })

    expect(row, 'login_failed 审计应已落库').not.toBeNull()
    expect(row?.module).toBe('auth')
    expect(row?.userAgent).toBe(UA)
    expect(row?.ip).toBeTruthy()
    expect(row?.targetId).toBe('__e2e_not_exist__')
  })

  it('超长 User-Agent 被截断至 512 且写入不报错', async () => {
    if (!dbReady) return

    const longUa = 'L'.repeat(900)
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('User-Agent', longUa)
      .send({ username: '__e2e_long_ua__', password: 'WrongPassword123' })

    expect(res.status).toBe(401)

    const row = await basePrisma.auditLog.findFirst({
      where: { action: 'login_failed', targetId: '__e2e_long_ua__' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userAgent: true },
    })

    expect(row, '超长 UA 不应导致审计写入失败').not.toBeNull()
    expect(row?.userAgent).toHaveLength(512)

    if (row) await basePrisma.auditLog.delete({ where: { id: row.id } }).catch(() => undefined)
  })

  it('缺失 User-Agent 时落 null，不影响审计写入', async () => {
    if (!dbReady) return

    const res = await request(app)
      .post('/api/v1/auth/login')
      // supertest 默认不带 UA；显式置空进一步确保
      .set('User-Agent', '')
      .send({ username: '__e2e_no_ua__', password: 'WrongPassword123' })

    expect(res.status).toBe(401)

    const row = await basePrisma.auditLog.findFirst({
      where: { action: 'login_failed', targetId: '__e2e_no_ua__' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userAgent: true },
    })

    expect(row, '无 UA 时审计仍应落库').not.toBeNull()
    expect(row?.userAgent).toBeNull()

    if (row) await basePrisma.auditLog.delete({ where: { id: row.id } }).catch(() => undefined)
  })
})

describe('permission.action 枚举约束端到端', () => {
  it('库级拒绝枚举外的 action（防拼写错误产生死权限）', async () => {
    if (!dbReady) return

    const role = await basePrisma.role.findFirst({ select: { id: true } })
    if (!role) return

    await expect(
      basePrisma.$executeRawUnsafe(
        `INSERT INTO "permission" (id, role_id, resource, action)
         VALUES (gen_random_uuid(), '${role.id}', '__e2e_probe__', 'viewx')`,
      ),
    ).rejects.toBeTruthy()

    // 确认未产生残留
    const leftover = await basePrisma.permission.count({ where: { resource: '__e2e_probe__' } })
    expect(leftover).toBe(0)
  })

  it('枚举内的 7 个 action 均可写入并回读', async () => {
    if (!dbReady) return

    const role = await basePrisma.role.create({
      data: { code: `__e2e_enum_${Date.now()}`, name: 'E2E 枚举探针', scopeValue: '', isSystem: false },
    })

    try {
      const actions = ['view', 'create', 'update', 'delete', 'export', 'import', 'approve'] as const
      await basePrisma.permission.createMany({
        data: actions.map((a) => ({ roleId: role.id, resource: `__e2e_${a}__`, action: a })),
      })

      const rows = await basePrisma.permission.findMany({
        where: { roleId: role.id },
        select: { action: true },
      })
      expect(rows).toHaveLength(7)
      expect([...new Set(rows.map((r) => r.action))].sort()).toEqual([...actions].sort())
    } finally {
      // permission 经 onDelete: Cascade 随角色一并清理
      await basePrisma.role.delete({ where: { id: role.id } }).catch(() => undefined)
    }
  })
})
