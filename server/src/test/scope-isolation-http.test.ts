import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import { basePrisma, prisma } from '../lib/prisma'
import { hashPassword } from '../lib/password'

/**
 * 数据范围隔离 HTTP 端到端测试（真实 DB + 完整中间件链）。
 *
 * 验证 attachScope（AsyncLocalStorage）在 Express 异步链路中确实生效：
 * 造一个仅授权单家公司的临时用户（沿用 finance_manager 角色，scopeValue=''），
 * 断言其在往来分析 / 财务指标 / 数据管理 各模块只能取到授权公司数据，
 * 且汇总主体按「全有或全无」判定 —— 仅授权部分成员时 403。
 *
 * 无 DB / 未 seed 时整组跳过；临时数据 afterAll 清理。
 */

const app = createApp()
const suffix = Date.now().toString(36)
const CO_IN = `ENSCI${suffix}`.slice(0, 20)
const CO_OUT = `ENSCO${suffix}`.slice(0, 20)
const ET_PARTIAL = `ETSCP${suffix}`.slice(0, 20)
const USERNAME = `__scope_user_${suffix}`
const PASSWORD = 'ScopeTest@2026'
const PERIOD = '2099-08'
const TYPE = '应收账款'

let dbReady = false
let token = ''
let userId = ''
let viewerUserId = ''
let viewerToken = ''
let noViewUserId = ''
let noViewToken = ''
let noViewRoleId = ''
let noViewPermissionId = ''
const detailIds: string[] = []

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const role = await basePrisma.role.findUnique({ where: { code: 'finance_manager' }, select: { id: true, scopeValue: true } })
    if (!role) return

    await basePrisma.company.createMany({
      data: [
        { code: CO_IN, name: `范围内_${suffix}`, entityType: 'single', status: 'active' },
        { code: CO_OUT, name: `范围外_${suffix}`, entityType: 'single', status: 'active' },
        { code: ET_PARTIAL, name: `部分汇总_${suffix}`, entityType: 'summary', status: 'active' },
      ],
    })
    // 汇总主体含范围内 + 范围外两家成员 → 对该用户不构成完整授权
    await basePrisma.companyAggregationMap.createMany({
      data: [
        { summaryCompanyCode: ET_PARTIAL, singleCompanyCode: CO_IN },
        { summaryCompanyCode: ET_PARTIAL, singleCompanyCode: CO_OUT },
      ],
    })

    for (const companyCode of [CO_IN, CO_OUT]) {
      const row = await basePrisma.transactionDetail.create({
        data: {
          companyCode,
          transactionType: TYPE,
          direction: 'AR',
          counterpartyCode: `__SCOPE_CP_${suffix}`,
          accountCode: `__SCOPE_ACC_${suffix}`,
          closingBalance: 1000,
          isInternal: false,
          isEliminated: false,
          period: PERIOD,
        },
      })
      detailIds.push(row.id)
    }

    const user = await basePrisma.user.create({
      data: {
        username: USERNAME,
        passwordHash: await hashPassword(PASSWORD),
        displayName: '范围测试用户',
        roleId: role.id,
        status: 'active',
        dataScopeCodes: [CO_IN],
      },
      select: { id: true },
    })
    userId = user.id

    const login = await request(app).post('/api/v1/auth/login').send({ username: USERNAME, password: PASSWORD })
    if (login.status === 200 && login.body?.data?.accessToken) {
      token = login.body.data.accessToken
      dbReady = true
    }

    // viewer 全公司授权夹具：复现「查看者 + 全部公司」筛选器为空的回归场景
    const viewerRole = await basePrisma.role.findUnique({ where: { code: 'viewer' }, select: { id: true } })
    if (viewerRole) {
      const allCodes = (await basePrisma.company.findMany({ where: { status: 'active' }, select: { code: true } })).map((c) => c.code)
      const viewerUser = await basePrisma.user.create({
        data: {
          username: `__viewer_full_${suffix}`,
          passwordHash: await hashPassword(PASSWORD),
          displayName: '查看者全公司测试',
          roleId: viewerRole.id,
          status: 'active',
          dataScopeCodes: allCodes,
        },
        select: { id: true },
      })
      viewerUserId = viewerUser.id
      const viewerLogin = await request(app).post('/api/v1/auth/login').send({ username: `__viewer_full_${suffix}`, password: PASSWORD })
      if (viewerLogin.status === 200) viewerToken = viewerLogin.body.data.accessToken

      // 无任何候选查看权限的临时角色 → 公司列表仍须 403（防止权限门过度放宽）
      const roleRow = await basePrisma.role.create({
        data: { code: `__noview_${suffix}`.slice(0, 24), name: `无查看权限_${suffix}`, scopeValue: '' },
        select: { id: true },
      })
      noViewRoleId = roleRow.id
      const perm = await basePrisma.permission.create({
        data: { roleId: noViewRoleId, resource: 'admin:users:view', action: 'view' },
        select: { id: true },
      })
      noViewPermissionId = perm.id
      const noViewUser = await basePrisma.user.create({
        data: {
          username: `__noview_u_${suffix}`,
          passwordHash: await hashPassword(PASSWORD),
          displayName: '无查看权限测试',
          roleId: noViewRoleId,
          status: 'active',
        },
        select: { id: true },
      })
      noViewUserId = noViewUser.id
      const noViewLogin = await request(app).post('/api/v1/auth/login').send({ username: `__noview_u_${suffix}`, password: PASSWORD })
      if (noViewLogin.status === 200) noViewToken = noViewLogin.body.data.accessToken
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[scope-isolation-http] 夹具准备失败：', e)
    dbReady = false
  }
})

afterAll(async () => {
  await basePrisma.transactionDetail.deleteMany({ where: { id: { in: detailIds } } }).catch(() => undefined)
  for (const uid of [userId, viewerUserId, noViewUserId]) {
    if (!uid) continue
    await basePrisma.tokenBlacklist.deleteMany({ where: { userId: uid } }).catch(() => undefined)
    await basePrisma.user.delete({ where: { id: uid } }).catch(() => undefined)
  }
  if (noViewPermissionId) await basePrisma.permission.delete({ where: { id: noViewPermissionId } }).catch(() => undefined)
  if (noViewRoleId) await basePrisma.role.delete({ where: { id: noViewRoleId } }).catch(() => undefined)
  await basePrisma.companyAggregationMap
    .deleteMany({ where: { summaryCompanyCode: ET_PARTIAL } })
    .catch(() => undefined)
  await basePrisma.company
    .deleteMany({ where: { code: { in: [CO_IN, CO_OUT, ET_PARTIAL] } } })
    .catch(() => undefined)
})

function auth(req: request.Test) {
  return req.set('Authorization', `Bearer ${token}`)
}

describe('数据范围隔离 HTTP 端到端（真实 DB）', () => {
  it('往来总览：未传公司筛选也只统计授权公司（核心越权回归）', async () => {
    if (!dbReady) return
    const res = await auth(request(app).get(`/api/v1/transactions/overview?period=${PERIOD}`))
    expect(res.status).toBe(200)
    const item = (res.body.data as Array<{ transactionType: string; recordCount: number; totalClosingBalance: number }>)
      .find((r) => r.transactionType === TYPE)
    expect(item).toBeDefined()
    expect(item?.recordCount).toBe(1)
    expect(item?.totalClosingBalance).toBe(1000)
  })

  it('往来明细：显式请求范围外公司 → 降级为授权主体（不报错、不返回越权数据）', async () => {
    if (!dbReady) return
    const res = await auth(request(app).get(`/api/v1/transactions/details?companyCode=${CO_OUT}&period=${PERIOD}`))
    expect(res.status).toBe(200)
    const codes = new Set((res.body.data.items as Array<{ companyCode: string }>).map((r) => r.companyCode))
    expect(codes.has(CO_OUT)).toBe(false)
    expect(codes.has(CO_IN)).toBe(true)
  })

  it('往来明细：不传公司时不返回范围外公司的行', async () => {
    if (!dbReady) return
    const res = await auth(request(app).get(`/api/v1/transactions/details?period=${PERIOD}&pageSize=100`))
    expect(res.status).toBe(200)
    const codes = new Set((res.body.data.items as Array<{ companyCode: string }>).map((r) => r.companyCode))
    expect(codes.has(CO_IN)).toBe(true)
    expect(codes.has(CO_OUT)).toBe(false)
  })

  it('公司列表：只返回授权公司，不含范围外公司与未完整授权的汇总主体', async () => {
    if (!dbReady) return
    const res = await auth(request(app).get('/api/v1/data/companies'))
    expect(res.status).toBe(200)
    const codes = new Set((res.body.data as Array<{ code: string }>).map((c) => c.code))
    expect(codes.has(CO_IN)).toBe(true)
    expect(codes.has(CO_OUT)).toBe(false)
    expect(codes.has(ET_PARTIAL)).toBe(false)
  })

  it('财务指标：请求范围外公司 → 403', async () => {
    if (!dbReady) return
    const res = await auth(request(app).get(`/api/v1/indicators/operating?companyCode=${CO_OUT}`))
    expect(res.status).toBe(403)
  })

  it('财务指标：仅授权部分成员的汇总主体 → 403（口径不得失真）', async () => {
    if (!dbReady) return
    const res = await auth(request(app).get(`/api/v1/indicators/operating?companyCode=${ET_PARTIAL}`))
    expect(res.status).toBe(403)
  })

  it('财务指标：授权公司正常返回，且 companyCount 只计授权公司', async () => {
    if (!dbReady) return
    const res = await auth(request(app).get(`/api/v1/indicators/operating?companyCode=${CO_IN}`))
    expect(res.status).toBe(200)
    expect(res.body.data.companyCount).toBe(1)
  })

  it('汇总映射：不泄露未完整授权汇总主体的成员构成', async () => {
    if (!dbReady) return
    const res = await auth(request(app).get(`/api/v1/data/aggregation-map?summaryCode=${ET_PARTIAL}`))
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
  })

  it('公司列表：viewer + 全部公司授权 → 可见全部启用单体与完整授权汇总主体（筛选器候选回归）', async () => {
    if (!dbReady || !viewerToken) return
    const res = await request(app).get('/api/v1/data/companies').set('Authorization', `Bearer ${viewerToken}`)
    expect(res.status).toBe(200)
    const codes = new Set((res.body.data as Array<{ code: string }>).map((c) => c.code))
    expect(codes.has(CO_IN)).toBe(true)
    expect(codes.has(CO_OUT)).toBe(true)
    // 成员单体全量授权（不含汇总编码）→ 汇总主体由「全有或全无」自动推导可见
    expect(codes.has(ET_PARTIAL)).toBe(true)
    // 全部启用单体必须可见；无映射成员的汇总主体按「全有或全无」不授权，故仅以单体数为下界
    const singleCount = await prisma.company.count({ where: { status: 'active', entityType: 'single' } })
    expect(codes.size).toBeGreaterThanOrEqual(singleCount)
  })

  it('公司列表：无任何候选查看权限 → 仍 403（权限门未过度放宽）', async () => {
    if (!dbReady || !noViewToken) return
    const res = await request(app).get('/api/v1/data/companies').set('Authorization', `Bearer ${noViewToken}`)
    expect(res.status).toBe(403)
  })
})
