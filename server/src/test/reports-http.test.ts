import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import { basePrisma, prisma } from '../lib/prisma'

/**
 * 分析报告路由 HTTP 冒烟测试（真实 DB + 完整中间件链）。
 * 走 admin 登录获取 token，验证 单项分析 CRUD + 汇总报告编制/导出 的端到端连通性。
 * 无 DB / 未 seed 时整组跳过；创建的记录 afterAll 清理。
 */

const app = createApp()
let dbReady = false
let token = ''
let companyCode = ''
let subjectCode = ''
const period = `2097-${(Date.now() % 12 + 1).toString().padStart(2, '0')}`
const createdAnalysisIds: string[] = []
const createdReportIds: string[] = []

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const admin = await prisma.user.findUnique({ where: { username: 'admin' }, select: { id: true } })
    if (!admin) return
    const company = await prisma.company.findFirst({ where: { entityType: 'single', status: 'active' }, select: { code: true } })
    const subject = await prisma.accountSubject.findFirst({ where: { subjectType: 'operating', status: 'active' }, select: { code: true } })
    if (!company || !subject) return
    companyCode = company.code
    subjectCode = subject.code
    const login = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: 'Yipinhui@2026' })
    if (login.status === 200 && login.body?.data?.accessToken) {
      token = login.body.data.accessToken
      dbReady = true
    }
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  for (const rid of createdReportIds) {
    await basePrisma.reportSection.deleteMany({ where: { reportId: rid } }).catch(() => undefined)
    await basePrisma.reportVersion.deleteMany({ where: { reportId: rid } }).catch(() => undefined)
  }
  await basePrisma.report.deleteMany({ where: { id: { in: createdReportIds } } }).catch(() => undefined)
  await basePrisma.subjectAnalysis.deleteMany({ where: { id: { in: createdAnalysisIds } } }).catch(() => undefined)
})

describe('分析报告路由 HTTP 冒烟（真实 DB）', () => {
  it('未登录访问 → 401', async () => {
    const res = await request(app).get('/api/v1/reports/analyses')
    expect(res.status).toBe(401)
  })

  it('单项分析：新增 → 列表 → 编辑 → 软删除', async () => {
    if (!dbReady) return
    const create = await request(app)
      .post('/api/v1/reports/analyses')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyCode, subjectCode, subjectType: 'operating', fiscalYear: '2097', period, title: 'HTTP 冒烟', content: '<p>冒烟内容</p><script>x</script>' })
    expect(create.status).toBe(201)
    expect(create.body.code).toBe(0)
    const id = create.body.data.id as string
    createdAnalysisIds.push(id)
    // 净化生效
    expect(create.body.data.content).not.toContain('<script')

    const list = await request(app)
      .get('/api/v1/reports/analyses')
      .query({ companyCode, period })
      .set('Authorization', `Bearer ${token}`)
    expect(list.status).toBe(200)
    expect(list.body.data.items.some((i: { id: string }) => i.id === id)).toBe(true)

    const update = await request(app)
      .put(`/api/v1/reports/analyses/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'HTTP 冒烟(改)' })
    expect(update.status).toBe(200)
    expect(update.body.data.title).toBe('HTTP 冒烟(改)')

    const del = await request(app).delete(`/api/v1/reports/analyses/${id}`).set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)
  })

  it('汇总报告：创建 → 生成章节 → 导出 → 归档', async () => {
    if (!dbReady) return
    // 先建一条单项分析供汇总引用
    const a = await request(app)
      .post('/api/v1/reports/analyses')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyCode, subjectCode, subjectType: 'operating', fiscalYear: '2097', period, title: '被汇总', content: '<p>汇总引用内容</p>' })
    createdAnalysisIds.push(a.body.data.id)

    const create = await request(app)
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'HTTP 冒烟总体报告', fiscalYear: '2097', period, companyScope: { type: 'company', code: companyCode } })
    expect(create.status).toBe(201)
    const reportId = create.body.data.id as string
    createdReportIds.push(reportId)

    const gen = await request(app).post(`/api/v1/reports/${reportId}/sections/generate`).set('Authorization', `Bearer ${token}`)
    expect(gen.status).toBe(200)
    expect(gen.body.data.sections.length).toBeGreaterThanOrEqual(1)

    const exp = await request(app).get(`/api/v1/reports/${reportId}/export`).query({ format: 'docx' }).set('Authorization', `Bearer ${token}`)
    expect(exp.status).toBe(200)
    expect(exp.body.data.title).toBe('HTTP 冒烟总体报告')
    expect(Array.isArray(exp.body.data.sections)).toBe(true)

    const del = await request(app).delete(`/api/v1/reports/${reportId}`).set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(200)
  })
})
