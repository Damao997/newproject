import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { AuthService } from '../services/AuthService'
import { newCaptcha } from '../services/CaptchaService'

/**
 * refresh 一次性消费并发回归（真实 DB，M5）：
 * 同一 refresh token 并发刷新时，advisory lock + 锁内复查保证恰一次成功；
 * 其余请求因旧 jti 已入黑名单/列表移除而 401。
 * 创建临时用户（afterAll 清理）；无 DB 时跳过。
 */

let dbReady = false
const username = `__t_refresh_once_${Date.now().toString(36)}__`
let userId = ''

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const admin = await basePrisma.user.findFirst({ where: { status: 'active' }, select: { id: true } })
    const role = await basePrisma.role.findFirst({ where: { status: 'active' }, select: { code: true } })
    if (!role) return
    const created = await basePrisma.user.create({
      data: {
        username,
        displayName: '并发刷新测试',
        passwordHash: '$2a$12$invalid-placeholder-invalid-placeholder-invalid-pl',
        roleId: (await basePrisma.user.findUnique({ where: { id: admin!.id }, select: { roleId: true } }))!.roleId,
        status: 'active',
      },
    })
    userId = created.id
    // 写入已知密码哈希（避免依赖占位串可用性）
    const { hashPassword } = await import('../lib/password')
    await basePrisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword('RefreshOnce@2026') } })
    dbReady = !!userId
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.user.deleteMany({ where: { username } }).catch(() => undefined)
})

describe('refresh 一次性消费并发回归（真实 DB，M5）', () => {
  it('同一 refresh token 并发刷新恰一次成功', async () => {
    if (!dbReady) return
    const c = newCaptcha()
    const login = await AuthService.login(username, 'RefreshOnce@2026', {}, { captcha: { id: c.captchaId, code: c.answer } })
    const results = await Promise.allSettled([
      AuthService.refresh(login.refreshToken),
      AuthService.refresh(login.refreshToken),
    ])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    // 成功一次后旧令牌彻底失效：再次刷新 401
    await expect(AuthService.refresh(login.refreshToken)).rejects.toMatchObject({ code: 401 })
    // 会话列表恰含成功请求轮转后的新 jti（1 个）
    const after = await basePrisma.user.findUnique({ where: { id: userId }, select: { refreshTokenJtiList: true } })
    expect(JSON.parse(JSON.stringify(after?.refreshTokenJtiList ?? []))).toHaveLength(1)
  })
})
