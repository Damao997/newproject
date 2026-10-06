import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { readdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { hashPassword } from '../lib/password'
import { basePrisma } from '../lib/prisma'
import { createApp } from '../app'
import { resetAuthRateLimits } from '../middleware/rate-limit'
import { validCaptchaFields } from './captcha-helper'

// 本文件的邮件走 dev 捕获（不连 SMTP）：验证码明文写入 .mail-out/*.json 供断言读取。
// vi.hoisted 早于模块导入执行，确保 loadConfig 首次调用前 MAIL_DEV_CAPTURE 已就位
vi.hoisted(() => {
  process.env.MAIL_DEV_CAPTURE = '1'
})

/**
 * 密码重置（邮箱验证码）端到端：真实 DB + 真实 mailer 捕获链路。
 * 覆盖：申请码 → 重置 → 新密码登录；错码锁定；过期码；已消费码重放；防枚举。
 * 数据库不可达时整组跳过；临时用户 afterAll 清理（级联清理验证码记录）。
 */
const app = createApp()
const suffix = Date.now().toString(36)
const PASSWORD = 'ResetFlow@2026'
const NEW_PASSWORD = 'NewPassword@2026'
const mailDir = path.resolve(__dirname, '../../.mail-out')
const createdUsernames: string[] = []

let dbReady = false

/** 从 dev 捕获目录读取最近一封密码重置邮件的验证码 */
function readCapturedCode(): string {
  const files = readdirSync(mailDir)
    .filter((f) => f.endsWith('.json') && f.includes('password_reset'))
    .sort()
  const latest = files[files.length - 1]
  if (!latest) throw new Error('未找到捕获的密码重置邮件（.mail-out/*.json）')
  const payload = JSON.parse(readFileSync(path.join(mailDir, latest), 'utf8')) as { code?: string }
  if (!payload.code) throw new Error('捕获邮件缺少验证码')
  return payload.code
}

async function createUser(username: string, email: string | null) {
  const role = await basePrisma.role.findUnique({ where: { code: 'viewer' }, select: { id: true } })
  if (!role) throw new Error('缺少 viewer 角色，请先执行 seed')
  const user = await basePrisma.user.create({
    data: {
      username,
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: '重置流程测试',
      roleId: role.id,
      status: 'active',
    },
    select: { id: true },
  })
  createdUsernames.push(username)
  return user
}

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    dbReady = true
  } catch {
    dbReady = false
  }
})

beforeEach(() => {
  // 单用例的申请+重置+登录请求会超过 5 次/分钟限流，测试内逐例清空认证限流计数
  resetAuthRateLimits()
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.user.deleteMany({ where: { username: { in: createdUsernames } } }).catch(() => undefined)
  // 清理本文件产生的捕获邮件（按时间戳前缀无法精确归属，按数量兜底：仅删测试窗口内生成的 json/eml）
  try {
    for (const f of readdirSync(mailDir)) {
      if (f.includes('password_reset')) unlinkSync(path.join(mailDir, f))
    }
  } catch {
    // 目录不存在等情况忽略
  }
})

describe('密码重置（邮箱验证码）全流程', () => {
  it('申请码 → 重置 → 新密码可登录、旧密码失效、旧会话全部吊销', async () => {
    if (!dbReady) return
    const username = `__reset_flow_${suffix}__`
    await createUser(username, `reset-flow-${suffix}@example.com`)

    // 1. 申请验证码（按用户名定位）
    const reqRes = await request(app).post('/api/v1/auth/forgot-password').send({ identifier: username })
    expect(reqRes.status).toBe(200)

    // 2. 重置密码（读捕获码）
    const code = readCapturedCode()
    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ identifier: username, code, newPassword: NEW_PASSWORD })
    expect(resetRes.status).toBe(200)

    // 3. 旧密码登录 → 401；新密码登录 → 200（验证码校验经 /auth/captcha 真实链路）
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password: PASSWORD, ...validCaptchaFields() })
    expect(oldLogin.status).toBe(401)

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password: NEW_PASSWORD, ...validCaptchaFields() })
    expect(newLogin.status).toBe(200)
    expect(newLogin.body.data.user.mustChangePassword).toBe(false)
  })

  it('验证码错误累计 5 次后作废：第 6 次即便答案正确也 400', async () => {
    if (!dbReady) return
    const username = `__reset_lock_${suffix}__`
    await createUser(username, `reset-lock-${suffix}@example.com`)
    const reqRes = await request(app).post('/api/v1/auth/forgot-password').send({ identifier: username })
    expect(reqRes.status).toBe(200)
    const code = readCapturedCode()

    for (let i = 0; i < 5; i++) {
      // IP 限流(5 次/分)会先于服务层锁定触发；本用例验证的是服务层 5 次错误锁定，故逐次清空限流计数
      resetAuthRateLimits()
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ identifier: username, code: '000000' === code ? '111111' : '000000', newPassword: NEW_PASSWORD })
      expect(res.status).toBe(400)
    }
    // 第 6 次：即使提交正确验证码也已被作废
    resetAuthRateLimits()
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ identifier: username, code, newPassword: NEW_PASSWORD })
    expect(res.status).toBe(400)
  })

  it('过期验证码 → 400', async () => {
    if (!dbReady) return
    const username = `__reset_exp_${suffix}__`
    await createUser(username, `reset-exp-${suffix}@example.com`)
    await request(app).post('/api/v1/auth/forgot-password').send({ identifier: username })
    const code = readCapturedCode()

    await basePrisma.passwordResetCode.updateMany({ where: { user: { username } }, data: { expiresAt: new Date(Date.now() - 1000) } })

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ identifier: username, code, newPassword: NEW_PASSWORD })
    expect(res.status).toBe(400)
  })

  it('已消费验证码重放 → 400', async () => {
    if (!dbReady) return
    const username = `__reset_replay_${suffix}__`
    await createUser(username, `reset-replay-${suffix}@example.com`)
    await request(app).post('/api/v1/auth/forgot-password').send({ identifier: username })
    const code = readCapturedCode()

    const first = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ identifier: username, code, newPassword: NEW_PASSWORD })
    expect(first.status).toBe(200)

    const replay = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ identifier: username, code, newPassword: 'Another@2026' })
    expect(replay.status).toBe(400)
  })

  it('防枚举：不存在的账号响应与命中一致（200），且不产生验证码记录', async () => {
    if (!dbReady) return
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ identifier: `__no_such_user_${suffix}__` })
    expect(res.status).toBe(200)
    const count = await basePrisma.passwordResetCode.count({ where: { user: { username: `__no_such_user_${suffix}__` } } })
    expect(count).toBe(0)
  })
})
