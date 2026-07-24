import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { DataService } from './DataService'

/**
 * 数据服务集成测试（真实 DB）：公司 CRUD + 引用完整性保护、汇总映射增删与去重。
 * afterAll 硬删除本测试创建的公司/映射；无 DB 时整组跳过。
 */

const ctx = { userId: 'test-user', traceId: 'test-trace' }
const SINGLE_CODE = '__TEST_SINGLE__'
const SUMMARY_CODE = '__TEST_SUMMARY__'

let dbReady = false

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const admin = await basePrisma.user.findFirst({ select: { id: true } })
    if (admin) ctx.userId = admin.id
    dbReady = !!admin
    if (!dbReady) return
    // 清理可能残留
    await basePrisma.companyAggregationMap.deleteMany({ where: { OR: [{ summaryCompanyCode: SUMMARY_CODE }, { singleCompanyCode: SINGLE_CODE }] } })
    await basePrisma.company.deleteMany({ where: { code: { in: [SINGLE_CODE, SUMMARY_CODE] } } })
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.companyAggregationMap.deleteMany({ where: { OR: [{ summaryCompanyCode: SUMMARY_CODE }, { singleCompanyCode: SINGLE_CODE }] } }).catch(() => undefined)
  await basePrisma.company.deleteMany({ where: { code: { in: [SINGLE_CODE, SUMMARY_CODE] } } }).catch(() => undefined)
})

describe('DataService 公司 CRUD（真实 DB）', () => {
  let singleId = ''
  let summaryId = ''

  it('创建单体与汇总公司', async () => {
    if (!dbReady) return
    const single = await DataService.createCompany({ code: SINGLE_CODE, name: '测试单体', entityType: 'single' }, ctx)
    const summary = await DataService.createCompany({ code: SUMMARY_CODE, name: '测试汇总', entityType: 'summary' }, ctx)
    singleId = single.id
    summaryId = summary.id
    expect(single.type).toBe('entity')
    expect(summary.type).toBe('summary')
  })

  it('重复编码抛冲突', async () => {
    if (!dbReady) return
    await expect(DataService.createCompany({ code: SINGLE_CODE, name: '重复', entityType: 'single' }, ctx)).rejects.toBeTruthy()
  })

  it('更新公司名称', async () => {
    if (!dbReady) return
    const updated = await DataService.updateCompany(singleId, { name: '测试单体-改' }, ctx)
    expect(updated.name).toBe('测试单体-改')
  })

  it('汇总映射：类型校验、去重、列表、删除', async () => {
    if (!dbReady) return
    const map = await DataService.createAggregationMap({ summaryCompanyCode: SUMMARY_CODE, singleCompanyCode: SINGLE_CODE }, ctx)
    expect(map.singleCompanyCode).toBe(SINGLE_CODE)
    // 去重
    await expect(DataService.createAggregationMap({ summaryCompanyCode: SUMMARY_CODE, singleCompanyCode: SINGLE_CODE }, ctx)).rejects.toBeTruthy()
    // 类型校验：single 作为汇总应报错
    await expect(DataService.createAggregationMap({ summaryCompanyCode: SINGLE_CODE, singleCompanyCode: SINGLE_CODE }, ctx)).rejects.toBeTruthy()
    // 列表
    const list = await DataService.listAggregationMap(SUMMARY_CODE)
    expect(list.some((m) => m.singleCompanyCode === SINGLE_CODE)).toBe(true)
    // 删除
    await DataService.deleteAggregationMap(map.id, ctx)
    const after = await DataService.listAggregationMap(SUMMARY_CODE)
    expect(after.some((m) => m.singleCompanyCode === SINGLE_CODE)).toBe(false)
  })

  it('被汇总映射引用时禁止停用', async () => {
    if (!dbReady) return
    const map = await DataService.createAggregationMap({ summaryCompanyCode: SUMMARY_CODE, singleCompanyCode: SINGLE_CODE }, ctx)
    await expect(DataService.deleteCompany(singleId, ctx)).rejects.toBeTruthy()
    await DataService.deleteAggregationMap(map.id, ctx)
  })

  it('无引用时可软删除（status=inactive）', async () => {
    if (!dbReady) return
    await DataService.deleteCompany(summaryId, ctx)
    const row = await basePrisma.company.findUnique({ where: { id: summaryId }, select: { status: true } })
    expect(row?.status).toBe('inactive')
  })
})
