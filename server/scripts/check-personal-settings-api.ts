// 真实写入只允许专用测试库，全部账号、资料、公司均为新建测试记录。
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { randomUUID } from 'node:crypto'
dotenv.config()
async function main() {
  const source = new URL(process.env.DATABASE_URL!)
  const saved = JSON.parse(fs.readFileSync('.cache/personal-test-database.json', 'utf8')) as { name: string }
  if (source.port !== '5434' || !['127.0.0.1', 'localhost'].includes(source.hostname) || !/^zjyph_personal_test_\d+$/.test(saved.name)) throw new Error('拒绝在非隔离测试库执行写入')
  source.pathname = '/' + saved.name; process.env.DATABASE_URL = source.toString(); process.env.NODE_ENV = 'test'
  const { prisma } = await import('../src/lib/prisma')
  const { createApp } = await import('../src/app')
  const { signAccessToken } = await import('../src/lib/jwt')
  const { PersonalSettingsService } = await import('../src/services/PersonalSettingsService')
  const { default: request } = await import('supertest')
  const { default: sharp } = await import('sharp')
  const app = createApp()
  const results: { name: string; passed: boolean }[] = []
  const check = (name: string, passed: boolean) => { assert(passed, name); results.push({ name, passed }) }
  try {
    const role = await prisma.role.create({ data: { code: 'personal_test_' + Date.now(), name: '个人设置测试角色', scopeValue: '*' } })
    await prisma.permission.create({ data: { roleId: role.id, resource: 'dashboard:view', action: 'view' } })
    const companyCode = 'EN' + String(Date.now()).slice(-6)
    const outsideCode = 'EN' + String((Number(companyCode.slice(2)) + 1) % 1000000).padStart(6, '0')
    const company = await prisma.company.create({ data: { code: companyCode, name: '个人设置测试公司', entityType: 'single' } })
    const outside = await prisma.company.create({ data: { code: outsideCode, name: '权限外测试公司', entityType: 'single' } })
    const first = await prisma.user.create({ data: { username: 'personal-first-' + Date.now(), displayName: '测试甲', passwordHash: '不用于登录的测试记录', roleId: role.id, companyCode: company.code } })
    const second = await prisma.user.create({ data: { username: 'personal-second-' + Date.now(), displayName: '测试乙', passwordHash: '不用于登录的测试记录', roleId: role.id, companyCode: outside.code } })
    const token = signAccessToken({ userId: first.id, username: first.username, roleCode: role.code })
    const token2 = signAccessToken({ userId: second.id, username: second.username, roleCode: role.code })
    const get = (url: string, bearer = token) => request(app).get('/api/v1/auth/' + url).set('Authorization', 'Bearer ' + bearer)
    const patch = (url: string, body: unknown) => request(app).patch('/api/v1/auth/' + url).set('Authorization', 'Bearer ' + token).send(body)
    const initial = await get('preferences')
    check('新账号默认设置读取不产生写入', initial.status === 200 && initial.body.data.revision === 0 && await prisma.userPreference.count({ where: { userId: first.id } }) === 0)
    const update = await patch('profile', { name: '测试甲已更新', email: 'personal-test@example.test', phone: '000-TEST', department: '测试部门', jobTitle: '测试岗位' })
    check('详细资料更新并保持原权限', update.status === 200 && update.body.data.phone === '000-TEST' && (await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).roleId === role.id)
    const leaked = await get('profile', token2)
    check('账号资料读取隔离', leaked.body.data.id === second.id && leaked.body.data.phone === null)
    check('拒绝个人资料写入权限字段', (await patch('profile', { roleId: '其他角色' })).status === 400)
    check('无效邮箱不会覆盖原输入数据', (await patch('profile', { email: 'bad' })).status === 400 && (await get('profile')).body.data.email === 'personal-test@example.test')
    const savedPreferences = await patch('preferences', { revision: 0, changes: { theme: 'dark', favoriteCompanies: [company.code], companyStartup: 'fixed', defaultCompanies: [company.code] } })
    check('个人偏好真实保存与跨客户端读取', savedPreferences.status === 200 && (await get('preferences')).body.data.preferences.theme === 'dark')
    check('其他账号偏好互不影响', (await get('preferences', token2)).body.data.preferences.theme === 'light')
    const revision = savedPreferences.body.data.revision
    const writes = await Promise.all([patch('preferences', { revision, changes: { theme: 'light' } }), patch('preferences', { revision, changes: { theme: 'gradient' } })])
    check('并发更新仅一项成功且另一项返回 409', writes.map(item => item.status).sort().join(',') === '200,409')
    const fresh = await get('preferences')
    check('权限外公司收藏被拒绝', (await patch('preferences', { revision: fresh.body.data.revision, changes: { favoriteCompanies: [outside.code] } })).status === 403)
    check('无权限默认入口被拒绝', (await patch('preferences', { revision: fresh.body.data.revision, changes: { homePath: '/admin/users' } })).status === 403)
    await prisma.user.update({ where: { id: first.id }, data: { companyCode: outside.code } })
    const narrowed = await get('preferences')
    check('权限收缩移除失效收藏与默认公司并回退启动策略', narrowed.body.data.preferences.favoriteCompanies.length === 0 && narrowed.body.data.preferences.defaultCompanies.length === 0 && narrowed.body.data.preferences.companyStartup === 'remember')
    await prisma.user.update({ where: { id: first.id }, data: { companyCode: company.code } })
    const image = await sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 40, g: 90, b: 170 } } }).png().toBuffer()
    const uploaded = await request(app).post('/api/v1/auth/avatar').set('Authorization', 'Bearer ' + token).attach('avatar', image, { filename: 'avatar.png', contentType: 'image/png' })
    const avatar = await get('avatar')
    const metadata = await sharp(avatar.body as Buffer).metadata()
    check('头像真实解码并缩放为 512px WebP', uploaded.status === 200 && avatar.status === 200 && metadata.format === 'webp' && metadata.width === 512 && metadata.height === 512)
    check('头像认证与私有缓存', (await request(app).get('/api/v1/auth/avatar')).status === 401 && avatar.headers['cache-control'] === 'private, no-store' && (await get('avatar', token2)).status === 404)
    const oldKey = (await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).avatarKey!
    const invalid = await request(app).post('/api/v1/auth/avatar').set('Authorization', 'Bearer ' + token).attach('avatar', Buffer.from('<svg/>'), { filename: 'bad.png', contentType: 'image/png' })
    check('伪装图片被拒绝且原头像保留', invalid.status === 400 && (await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).avatarKey === oldKey)
    const largePixels = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()
    const pixelResponse = await request(app).post('/api/v1/auth/avatar').set('Authorization', 'Bearer ' + token).attach('avatar', largePixels, { filename: 'pixels.png', contentType: 'image/png' })
    check('过大像素图片被拒绝且原头像保留', pixelResponse.status === 400 && (await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).avatarKey === oldKey)
    const oversized = await request(app).post('/api/v1/auth/avatar').set('Authorization', 'Bearer ' + token).attach('avatar', Buffer.alloc(2 * 1024 * 1024 + 1), { filename: 'large.png', contentType: 'image/png' })
    check('超出 2MB 的头像被拒绝', oversized.status === 400)
    await request(app).post('/api/v1/auth/avatar').set('Authorization', 'Bearer ' + token).attach('avatar', image, { filename: 'replace.png', contentType: 'image/png' })
    check('成功替换后清理旧头像文件', !fs.existsSync(path.join('uploads/avatars', oldKey)))
    const avatarPath = path.resolve('uploads/avatars')
    const beforeFiles = fs.readdirSync(avatarPath).sort()
    await assert.rejects(PersonalSettingsService.updateAvatar(randomUUID(), { buffer: image, size: image.length, mimetype: 'image/png' } as Express.Multer.File, {}))
    check('数据库写入失败清理新文件', fs.readdirSync(avatarPath).sort().join(',') === beforeFiles.join(','))
    const removed = await request(app).delete('/api/v1/auth/avatar').set('Authorization', 'Bearer ' + token)
    check('移除头像后显示姓名缩写', removed.status === 200 && removed.body.data.avatarVersion === null && (await get('avatar')).status === 404)
    await prisma.user.update({ where: { id: first.id }, data: { mustChangePassword: true } })
    check('强制改密限制覆盖新接口', (await get('preferences')).status === 403 && (await patch('profile', { name: '禁止更新' })).status === 403 && (await get('profile')).status === 200)
    const audits = await prisma.auditLog.findMany({ where: { userId: first.id, action: { in: ['profile_update', 'preferences_update'] } } })
    check('审计不记录联系资料内容', audits.length > 0 && !JSON.stringify(audits.map(item => item.detail)).includes('personal-test@example.test'))
  } finally {
    fs.mkdirSync('.cache', { recursive: true }); fs.writeFileSync('.cache/personal-api-report.json', JSON.stringify({ database: saved.name, results }, null, 2))
    await prisma.$disconnect()
  }
  console.log(JSON.stringify({ checks: results.length, failed: results.filter(item => !item.passed) }, null, 2))
}
main().catch(cause => { console.error(cause.message); process.exitCode = 1 })
