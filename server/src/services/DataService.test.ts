import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { DataService } from './DataService'
import { OPERATING_DIMS } from '../lib/metric-values'

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

describe('DataService 批次差异对比（真实 DB）', () => {
  // 独立测试公司与远期期间，避免与并行测试及真实数据干扰
  const COMP_A = '__TEST_DC_A__'
  const COMP_B = '__TEST_DC_B__'
  const ACC1 = '__TEST_DC_ACC1__'
  const ACC2 = '__TEST_DC_ACC2__'
  const P1 = '2094-04'
  const P2 = '2094-05'
  const createdBatchIds: string[] = []

  const makeOpBatch = async (fileName: string, rows: { companyCode: string; accountCode: string; period: string; value: number }[]) => {
    const b = await basePrisma.importBatch.create({
      data: { fileName, status: 'success', dataType: 'operating', lifecycleStatus: 'archived', sourceType: 'upload', fiscalYear: 'FY2094' },
    })
    createdBatchIds.push(b.id)
    await basePrisma.factOperating.createMany({
      data: rows.map((r) => ({
        batchId: b.id, companyCode: r.companyCode, accountCode: r.accountCode,
        period: r.period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2094', value: r.value,
      })),
    })
    return b
  }

  beforeAll(async () => {
    if (!dbReady) return
    // scope 过滤测试需要 active 公司在库（resolveScope 按 active 公司解析 dataScopeCodes）
    await basePrisma.company.upsert({
      where: { code: COMP_A },
      update: { name: '__测试对比公司A__', entityType: 'single', status: 'active' },
      create: { code: COMP_A, name: '__测试对比公司A__', entityType: 'single', status: 'active' },
    })
  })

  afterAll(async () => {
    if (createdBatchIds.length === 0) return
    await basePrisma.factOperating.deleteMany({ where: { batchId: { in: createdBatchIds } } }).catch(() => undefined)
    await basePrisma.importBatch.deleteMany({ where: { id: { in: createdBatchIds } } }).catch(() => undefined)
    await basePrisma.company.delete({ where: { code: COMP_A } }).catch(() => undefined)
  })

  it('同类型批次对比：changed/added/removed 分组正确、delta 按幅度降序', async () => {
    if (!dbReady) return
    // a：COMP_A×ACC1×P1=100、COMP_A×ACC1×P2=200（removed 候选）、COMP_A×ACC2×P1=50
    const a = await makeOpBatch('__test_dc_A__.xlsx', [
      { companyCode: COMP_A, accountCode: ACC1, period: P1, value: 100 },
      { companyCode: COMP_A, accountCode: ACC1, period: P2, value: 200 },
      { companyCode: COMP_A, accountCode: ACC2, period: P1, value: 50 },
    ])
    // b：COMP_A×ACC1×P1=150（changed +50）、COMP_A×ACC2×P1=50（不变）、COMP_A×ACC1×P2=999（changed +799）、COMP_A×ACC2×P2=10（added）
    const b = await makeOpBatch('__test_dc_B__.xlsx', [
      { companyCode: COMP_A, accountCode: ACC1, period: P1, value: 150 },
      { companyCode: COMP_A, accountCode: ACC2, period: P1, value: 50 },
      { companyCode: COMP_A, accountCode: ACC1, period: P2, value: 999 },
      { companyCode: COMP_A, accountCode: ACC2, period: P2, value: 10 },
    ])

    const diff = await DataService.compareBatches(a.id, b.id)
    expect(diff.a.id).toBe(a.id)
    expect(diff.b.id).toBe(b.id)
    // 变化：P2(200→999, +799) 与 P1(100→150, +50)，按幅度降序
    expect(diff.changed).toHaveLength(2)
    expect(diff.changed[0]).toMatchObject({ accountCode: ACC1, period: P2, oldValue: 200, newValue: 999, delta: 799, deltaPercent: 399.5 })
    expect(diff.changed[1]).toMatchObject({ accountCode: ACC1, period: P1, oldValue: 100, newValue: 150, delta: 50, deltaPercent: 50 })
    // 新增：仅 b 有
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]).toMatchObject({ accountCode: ACC2, period: P2, newValue: 10, delta: 10 })
    // 删除：仅 a 有（P2 的 200 被 b 的 999 顶替不算删除；此处无纯删除行）
    expect(diff.removed).toHaveLength(0)
    // 汇总：totalDelta = 799 + 50 + 10
    expect(diff.summary).toMatchObject({ changedCount: 2, addedCount: 1, removedCount: 0, totalDelta: 859, truncated: false })
    // 不变的行（COMP_A×ACC2×P1=50）不出现
    expect(diff.changed.some((r) => r.accountCode === ACC2 && r.period === P1)).toBe(false)
  })

  it('非活动状态批次可对比；purged/不同模板/transaction 被拒绝', async () => {
    if (!dbReady) return
    const a = await makeOpBatch('__test_dc_C__.xlsx', [{ companyCode: COMP_A, accountCode: ACC1, period: P1, value: 1 }])
    const b = await makeOpBatch('__test_dc_D__.xlsx', [{ companyCode: COMP_A, accountCode: ACC1, period: P1, value: 2 }])
    // archived 批次可对比（回滚对比场景）
    const diff = await DataService.compareBatches(a.id, b.id)
    expect(diff.changed).toHaveLength(1)

    const st = await basePrisma.importBatch.create({ data: { fileName: '__test_dc_ST__.xlsx', status: 'success', dataType: 'static', lifecycleStatus: 'archived', sourceType: 'upload', fiscalYear: 'FY2094' } })
    createdBatchIds.push(st.id)
    await expect(DataService.compareBatches(a.id, st.id)).rejects.toMatchObject({ message: expect.stringContaining('同类型') })

    const tx = await basePrisma.importBatch.create({ data: { fileName: '__test_dc_TX__.xls', status: 'success', dataType: 'transaction', lifecycleStatus: 'archived', sourceType: 'upload' } })
    createdBatchIds.push(tx.id)
    await expect(DataService.compareBatches(tx.id, tx.id)).rejects.toMatchObject({ message: expect.stringContaining('暂不支持对比') })

    const p = await basePrisma.importBatch.create({ data: { fileName: '__test_dc_P__.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'purged', sourceType: 'upload', fiscalYear: 'FY2094' } })
    createdBatchIds.push(p.id)
    await expect(DataService.compareBatches(a.id, p.id)).rejects.toMatchObject({ message: expect.stringContaining('不可参与对比') })
  })

  it('scope 过滤：仅返回授权公司数据', async () => {
    if (!dbReady) return
    const a = await makeOpBatch('__test_dc_SA__.xlsx', [
      { companyCode: COMP_A, accountCode: ACC1, period: P1, value: 100 },
      { companyCode: COMP_B, accountCode: ACC1, period: P1, value: 999 },
    ])
    const b = await makeOpBatch('__test_dc_SB__.xlsx', [
      { companyCode: COMP_A, accountCode: ACC1, period: P1, value: 150 },
      { companyCode: COMP_B, accountCode: ACC1, period: P1, value: 888 },
    ])
    const diff = await DataService.compareBatches(a.id, b.id, { companyCode: null, scopeValue: 'company', dataScopeCodes: [COMP_A] })
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0].companyCode).toBe(COMP_A)
    // 越权公司（COMP_B）不出现
    expect(diff.changed.some((r) => r.companyCode === COMP_B)).toBe(false)
  })
})

describe('DataService 科目 orderNo 排序（真实 DB）', () => {
  // 独立科目前缀（根科目编码由系统自动分配，名称唯一即可），避免与并行测试及真实数据干扰
  const ROOT_NAME = `__TEST_ORD_${Date.now()}`
  const createdCodes: string[] = []

  const orderNoOf = async (code: string): Promise<number | undefined> =>
    (await basePrisma.accountSubject.findUnique({ where: { code }, select: { orderNo: true } }))?.orderNo

  afterAll(async () => {
    if (!dbReady || createdCodes.length === 0) return
    await basePrisma.accountSubject.deleteMany({ where: { code: { in: createdCodes } } }).catch(() => undefined)
  })

  it('新增根科目 orderNo 追加到全局末尾', async () => {
    if (!dbReady) return
    const beforeMax = await basePrisma.accountSubject.aggregate({ _max: { orderNo: true } })
    const root = await DataService.createSubject({ name: ROOT_NAME, type: 'operating', category: '自定义', isLeaf: false }, ctx)
    createdCodes.push(root.code)
    // 并行测试文件共享 DB，全局 max 可能被其他文件新增的科目推进，故断言追加语义（> 创建前 max）
    expect(await orderNoOf(root.code)).toBeGreaterThan(beforeMax._max.orderNo ?? 0)
  })

  it('连续新增子科目依次排在父级末尾，orderNo 渲染序与编码序一致', async () => {
    if (!dbReady) return
    const rootCode = createdCodes[0]
    const c1 = await DataService.createSubject({ name: `${ROOT_NAME}_1`, parentCode: rootCode, isLeaf: true }, ctx)
    const c2 = await DataService.createSubject({ name: `${ROOT_NAME}_2`, parentCode: rootCode, isLeaf: true }, ctx)
    createdCodes.push(c1.code, c2.code)
    // 编码级联：同级序号 01、02 递增
    expect(c1.code.endsWith('01')).toBe(true)
    expect(c2.code.endsWith('02')).toBe(true)
    // orderNo 依次递增（c2 = c1 + 1）
    expect((await orderNoOf(c2.code))!).toBe((await orderNoOf(c1.code))! + 1)
    // 渲染序（orderNo 升序）与编码序一致
    const seq = await basePrisma.accountSubject.findMany({ where: { parentCode: rootCode }, orderBy: { orderNo: 'asc' }, select: { code: true } })
    expect(seq.map((r) => r.code)).toEqual([c1.code, c2.code])
  })

  it('再次新增子科目插入同级末尾，不扰动既有兄弟', async () => {
    if (!dbReady) return
    const rootCode = createdCodes[0]
    const c2 = createdCodes[createdCodes.length - 1]
    const before2 = (await orderNoOf(c2))!
    const c3 = await DataService.createSubject({ name: `${ROOT_NAME}_3`, parentCode: rootCode, isLeaf: true }, ctx)
    createdCodes.push(c3.code)
    expect(await orderNoOf(c2)).toBe(before2) // 既有兄弟位置不动
    expect(await orderNoOf(c3.code)).toBe(before2 + 1) // 新科目插在其后
  })

  it('reclassify 换父后子树重排到新父子树末尾', async () => {
    if (!dbReady) return
    const rootB = await DataService.createSubject({ name: `${ROOT_NAME}_B`, type: 'operating', category: '自定义', isLeaf: false }, ctx)
    createdCodes.push(rootB.code)
    const x1 = await DataService.createSubject({ name: `${ROOT_NAME}_B1`, parentCode: rootB.code, isLeaf: true }, ctx)
    createdCodes.push(x1.code)
    // 把根科目 A 的第三子科目移到 rootB 下
    const c3 = createdCodes.find((c) => c.endsWith('03'))!
    const c3Row = await basePrisma.accountSubject.findUnique({ where: { code: c3 }, select: { id: true } })
    await DataService.reclassifySubject(c3Row!.id, { parentCode: rootB.code }, ctx)
    // rootB 子树渲染序：x1 → c3（c3 排到末尾，x1 位置不变）
    const seq = await basePrisma.accountSubject.findMany({ where: { parentCode: rootB.code }, orderBy: { orderNo: 'asc' }, select: { code: true } })
    expect(seq.map((r) => r.code)).toEqual([x1.code, c3])
    expect((await orderNoOf(c3))!).toBe((await orderNoOf(x1.code))! + 1)
  })
})
