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
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[scope-isolation-http] 夹具准备失败：', e)
    dbReady = false
  }
})

afterAll(async () => {
  await basePrisma.transactionDetail.deleteMany({ where: { id: { in: detailIds } } }).catch(() => undefined)
  if (userId) {
    await basePrisma.tokenBlacklist.deleteMany({ where: { userId } }).catch(() => undefined)
    await basePrisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  }
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

  it('往来明细：显式请求范围外公司 → 403', async () => {
    if (!dbReady) return
    const res = await auth(request(app).get(`/api/v1/transactions/details?companyCode=${CO_OUT}&period=${PERIOD}`))
    expect(res.status).toBe(403)
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
})
