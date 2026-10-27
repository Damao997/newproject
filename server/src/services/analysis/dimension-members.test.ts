import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../../lib/prisma'
import { ProductCategoryService } from '../ProductCategoryService'
import { ProductConfigService } from '../ProductConfigService'
import { ExpenseAnalysisService } from '../ExpenseAnalysisService'
import { ROW_ADAPTERS, type AdapterContext, type AdapterResult } from './row-adapters'
import { loadConfigSource, resolveDimensionMode, syncDimensionMembers } from './dimension-members'
import { resolveColMembers } from './col-members'
import { OPERATING_DIMS } from '../../lib/metric-values'

/**
 * 维度成员化（L2 / T31）契约测试（真实 DB）。
 *
 * 三条验收主线（对应阶段方案 §4 T31 行）：
 *   1. 配置 CRUD 后成员同步：create/update（改名/改序/停用）/remove（含费用墓碑与同 code 复活）都落 dimension_member；
 *   2. 适配器成员驱动结果与配置驱动**逐字段一致**：ROW_ADAPTERS 在成员模式（默认）与
 *      配置模式（env 关停开关）下对同一夹具 deepEqual（rows/groups/totals/unmatched 全量）；
 *   3. 回退策略：成员表为空 / 成员集未完整覆盖配置行（绕过 service 直插）→ 自动回退配置表；
 *      env ANALYSIS_DIMENSION_MEMBERS=off → 强制配置模式。
 *
 * 夹具注意（测试库现状）：21 个费用叶子已被 seed 映射一对一占用（create 有跨映射唯一校验），
 * 故费用夹具挂**中层费用根节点**（category=壹品慧费用 的非叶子节点，值是后代聚合）——
 * 语义上仍是「运营费用科目」，且不与任何存量映射冲突。收入/费用叶子各造当月+同期事实，
 * 保证适配器产出非零行（空行使 deepEqual 退化为恒真，无断言价值）。
 * 测试库另存 10 品类 / 11 产品的 seed 配置，断言一律只圈定本方夹具行，不断言全集。
 * 无 DB 或关键科目缺失时整组跳过（与 AnalysisQueryService.test 同策略）。
 */

let fixtureStarted = false
let dbReady = false
const suffix = `DM${Date.now().toString(36)}`
const companyCode = `EDM${suffix}`.slice(0, 20)
const period = '2099-06'
const opBatchId = `dmop_${suffix}`
const budgetBatchId = `dmbg_${suffix}`

const catCodeA = `DMCA${suffix}`.slice(0, 20) // 关键词模式
const catCodeB = `DMCB${suffix}`.slice(0, 20) // 显式科目模式
const prodCode = `DMPR${suffix}`.slice(0, 20)
let mappingCode = '' // 费用映射（create 返回统一编码）
let incomeLeafCode = ''
let incomeLeafName = ''
let feeLeafCode = ''
let feeRootCode = ''

const auditCtx = { userId: 'test-user', traceId: 'test-trace' }

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    fixtureStarted = true
    // 审计日志 userId 有外键：优先取真实用户（沿用 ExpenseAnalysisService.test 惯例）
    const admin = await basePrisma.user.findFirst({ select: { id: true } })
    if (admin) auditCtx.userId = admin.id
    const [incomeLeaf, feeLeaf, feeRoots, usedRows] = await Promise.all([
      basePrisma.accountSubject.findFirst({
        where: { subjectType: 'operating', status: 'active', isLeaf: true, category: '壹品慧收入' },
        select: { code: true, name: true },
      }),
      basePrisma.accountSubject.findFirst({
        where: { subjectType: 'operating', status: 'active', isLeaf: true, category: '壹品慧费用' },
        select: { code: true },
      }),
      basePrisma.accountSubject.findMany({
        where: { subjectType: 'operating', status: 'active', category: '壹品慧费用', isLeaf: false, level: { gte: 1 } },
        select: { code: true, name: true, level: true },
        orderBy: { level: 'asc' },
      }),
      basePrisma.expenseSubjectMapping.findMany({ where: { status: 'active', deletedAt: null }, select: { subjectCodes: true } }),
    ])
    if (!incomeLeaf || !feeLeaf || feeRoots.length === 0) return
    incomeLeafCode = incomeLeaf.code
    incomeLeafName = incomeLeaf.name
    feeLeafCode = feeLeaf.code
    const used = new Set(usedRows.flatMap((m) => m.subjectCodes))
    const root = feeRoots.find((r) => !used.has(r.code))
    if (!root) return // 中层节点也被占满（不应发生）：无冲突空间，跳过整组
    feeRootCode = root.code

    await basePrisma.company.create({ data: { code: companyCode, name: `成员化测试_${suffix}`, entityType: 'single', status: 'active' } })
    await basePrisma.importBatch.createMany({
      data: [
        { id: opBatchId, fileName: 'dm-operating.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'active', fiscalYear: 'FY2099' },
        { id: budgetBatchId, fileName: 'dm-budget.xlsx', status: 'success', dataType: 'budget', lifecycleStatus: 'active', fiscalYear: 'FY2099' },
      ],
    })
    // 当月 + 同期（ACTUAL_MONTH 单期派生口径）+ 年度预算，保证行有值且两模式取值非零
    await basePrisma.factOperating.createMany({
      data: [
        { batchId: opBatchId, companyCode, accountCode: incomeLeafCode, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2099', value: 100 },
        { batchId: opBatchId, companyCode, accountCode: incomeLeafCode, period: '2098-06', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2098', value: 80 },
        { batchId: opBatchId, companyCode, accountCode: feeLeafCode, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2099', value: 50 },
        { batchId: opBatchId, companyCode, accountCode: feeLeafCode, period: '2098-06', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2098', value: 40 },
      ],
    })
    await basePrisma.factBudget.createMany({
      data: [
        { batchId: budgetBatchId, companyCode, accountCode: incomeLeafCode, fiscalYear: 'FY2099', period: 'FY2099', value: 1200 },
        { batchId: budgetBatchId, companyCode, accountCode: feeRootCode, fiscalYear: 'FY2099', period: 'FY2099', value: 600 },
      ],
    })

    // 配置经 service 创建（同步路径即被测逻辑）：关键词品类 + 显式科目品类 + 产品 + 费用映射（中层根）
    await ProductCategoryService.create({ code: catCodeA, name: '契约品类甲', subjectKeyword: incomeLeafName, sortOrder: 41 }, auditCtx)
    await ProductCategoryService.create({ code: catCodeB, name: '契约品类乙', subjectCodes: [incomeLeafCode], sortOrder: 42 }, auditCtx)
    await ProductConfigService.create({ code: prodCode, name: '契约产品', subjectKeyword: incomeLeafName, sortOrder: 43 }, auditCtx)
    mappingCode = (await ExpenseAnalysisService.create({ name: '契约费用映射', subjectCodes: [feeRootCode] }, auditCtx)).code
    dbReady = true
  } catch (e) {
    console.error('[dimension-members.test] 夹具准备失败：', e)
    dbReady = false
  }
})

afterAll(async () => {
  if (!fixtureStarted) return
  // 无条件清理：夹具中途失败也要把已写行收回（上次失败运行的教训）
  await basePrisma.productCategory.deleteMany({ where: { code: { in: [catCodeA, catCodeB] } } }).catch(() => undefined)
  await basePrisma.keyMetricsProduct.deleteMany({ where: { code: prodCode } }).catch(() => undefined)
  if (mappingCode) await basePrisma.expenseSubjectMapping.deleteMany({ where: { code: mappingCode } }).catch(() => undefined)
  await basePrisma.dimensionMember.deleteMany({ where: { code: { in: [catCodeA, catCodeB, prodCode, mappingCode] } } }).catch(() => undefined)
  await basePrisma.factOperating.deleteMany({ where: { batchId: opBatchId } }).catch(() => undefined)
  await basePrisma.factBudget.deleteMany({ where: { batchId: budgetBatchId } }).catch(() => undefined)
  await basePrisma.importBatch.deleteMany({ where: { id: { in: [opBatchId, budgetBatchId] } } }).catch(() => undefined)
  await basePrisma.company.deleteMany({ where: { code: companyCode } }).catch(() => undefined)
  await basePrisma.$disconnect().catch(() => undefined)
})

const makeCtx = (): AdapterContext => ({
  scope: { companyCode: null, scopeValue: '*', dataScopeCodes: null },
  companyCodes: [companyCode],
  period,
  periodIndex: 5,
  ratios: null,
  consolidationSummaryCode: null,
  excludeReclassify: false,
  reclassifyMeta: { appliedLogs: 0, skippedLogs: 0 },
  filters: { excludeReclassify: false, keyword: '', rowCodes: [] },
  options: { includeEmptyRows: false, includeTotals: true, level: null },
})

/** 在两种取数模式下跑同一适配器（env 开关切换，finally 恢复） */
async function runBothModes(adapter: (ctx: AdapterContext) => Promise<AdapterResult>): Promise<{ members: AdapterResult; config: AdapterResult }> {
  const saved = process.env.ANALYSIS_DIMENSION_MEMBERS
  try {
    delete process.env.ANALYSIS_DIMENSION_MEMBERS
    const members = await adapter(makeCtx())
    process.env.ANALYSIS_DIMENSION_MEMBERS = 'off'
    const config = await adapter(makeCtx())
    return { members, config }
  } finally {
    if (saved === undefined) delete process.env.ANALYSIS_DIMENSION_MEMBERS
    else process.env.ANALYSIS_DIMENSION_MEMBERS = saved
  }
}

const catIdOf = async (code: string): Promise<string> =>
  (await basePrisma.productCategory.findUnique({ where: { code }, select: { id: true } }))!.id

describe('维度成员同步（配置 CRUD 同事务，真实 DB）', () => {
  it('品类 create 后 dimension 与成员落盘（code/name/orderNo 镜像配置）', async () => {
    if (!dbReady) return
    const dim = await basePrisma.dimension.findUnique({ where: { code: 'category' } })
    expect(dim?.name).toBe('品类')
    const member = await basePrisma.dimensionMember.findFirst({ where: { dimensionId: dim?.id ?? '', code: catCodeA } })
    expect(member?.name).toBe('契约品类甲')
    expect(member?.orderNo).toBe(41)
    // 显式科目品类同样落盘（两种匹配模式都是成员）
    expect(await basePrisma.dimensionMember.findFirst({ where: { dimensionId: dim?.id ?? '', code: catCodeB } })).toBeTruthy()
  })

  it('品类 update 改名/改序同步回写成员；停用移出、重新启用回归', async () => {
    if (!dbReady) return
    await ProductCategoryService.update(await catIdOf(catCodeA), { name: '契约品类甲改', sortOrder: 45 }, auditCtx)
    const dim = await basePrisma.dimension.findUnique({ where: { code: 'category' } })
    const renamed = await basePrisma.dimensionMember.findFirst({ where: { dimensionId: dim?.id ?? '', code: catCodeA } })
    expect(renamed?.name).toBe('契约品类甲改')
    expect(renamed?.orderNo).toBe(45)
    // 停用 → 活跃集合收缩 → 成员移除（成员表只镜像活跃配置）
    await ProductCategoryService.update(await catIdOf(catCodeA), { status: 'inactive' }, auditCtx)
    expect(await basePrisma.dimensionMember.findFirst({ where: { dimensionId: dim?.id ?? '', code: catCodeA } })).toBeNull()
    // 重新启用 → 成员回归（reconcile 全集）
    await ProductCategoryService.update(await catIdOf(catCodeA), { status: 'active' }, auditCtx)
    expect(await basePrisma.dimensionMember.findFirst({ where: { dimensionId: dim?.id ?? '', code: catCodeA } })).toBeTruthy()
    // 还原夹具名/序（契约对照按最终状态比对）
    await ProductCategoryService.update(await catIdOf(catCodeA), { name: '契约品类甲', sortOrder: 41 }, auditCtx)
  })

  it('品类 remove 后成员差集删除', async () => {
    if (!dbReady) return
    await ProductCategoryService.remove(await catIdOf(catCodeA), auditCtx)
    const dim = await basePrisma.dimension.findUnique({ where: { code: 'category' } })
    expect(await basePrisma.dimensionMember.findFirst({ where: { dimensionId: dim?.id ?? '', code: catCodeA } })).toBeNull()
    // 重建（契约对照需要该行在场）
    await ProductCategoryService.create({ code: catCodeA, name: '契约品类甲', subjectKeyword: incomeLeafName, sortOrder: 41 }, auditCtx)
  })

  it('产品 create/remove 成员同步', async () => {
    if (!dbReady) return
    const dim = await basePrisma.dimension.findUnique({ where: { code: 'product' } })
    expect(await basePrisma.dimensionMember.findFirst({ where: { dimensionId: dim?.id ?? '', code: prodCode } })).toBeTruthy()
    const id = (await basePrisma.keyMetricsProduct.findUnique({ where: { code: prodCode }, select: { id: true } }))!.id
    await ProductConfigService.remove(id, auditCtx)
    expect(await basePrisma.dimensionMember.findFirst({ where: { dimensionId: dim?.id ?? '', code: prodCode } })).toBeNull()
    await ProductConfigService.create({ code: prodCode, name: '契约产品', subjectKeyword: incomeLeafName, sortOrder: 43 }, auditCtx)
  })

  it('费用映射 remove（墓碑）后成员差集删除；同 code 重建（复活）成员回归', async () => {
    if (!dbReady) return
    const id = (await basePrisma.expenseSubjectMapping.findUnique({ where: { code: mappingCode }, select: { id: true } }))!.id
    await ExpenseAnalysisService.remove(id, auditCtx)
    const dim = await basePrisma.dimension.findUnique({ where: { code: 'expense' } })
    expect(await basePrisma.dimensionMember.findFirst({ where: { dimensionId: dim?.id ?? '', code: mappingCode } })).toBeNull()
    // 同 code 重建 = 复活分支：墓碑清除 + 成员同步回归
    mappingCode = (await ExpenseAnalysisService.create({ code: mappingCode, name: '契约费用映射', subjectCodes: [feeRootCode] }, auditCtx)).code
    expect(await basePrisma.dimensionMember.findFirst({ where: { dimensionId: dim?.id ?? '', code: mappingCode } })).toBeTruthy()
  })
})

describe('适配器成员驱动契约：与配置驱动逐字段一致（真实 DB）', () => {
  it('loadConfigSource 成员模式返回配置全集（含匹配信息）且顺序 = member.orderNo', async () => {
    if (!dbReady) return
    const rows = await loadConfigSource('category')
    const mine = rows.filter((r) => r.code === catCodeA || r.code === catCodeB)
    expect(mine.map((r) => r.code)).toEqual([catCodeA, catCodeB])
    expect(rows.find((r) => r.code === catCodeA)).toMatchObject({ name: '契约品类甲', subjectKeyword: incomeLeafName })
    expect(rows.find((r) => r.code === catCodeB)).toMatchObject({ name: '契约品类乙', subjectCodes: [incomeLeafCode] })
  })

  it('品类适配器：成员模式 vs 配置模式 deepEqual（含 unmatched 与 totals）', async () => {
    if (!dbReady) return
    const { members, config } = await runBothModes(ROW_ADAPTERS.category)
    expect(members.rows.length, '夹具品类应产出非零行（空行使断言恒真）').toBeGreaterThan(0)
    // 本方夹具（sortOrder 41/42 大于全部 seed 行）必在且垫尾；seed 存量行两模式一致由 deepEqual 保证
    expect(members.rows.slice(-2).map((r) => r.code)).toEqual([catCodeA, catCodeB])
    expect(members).toEqual(config)
  })

  it('产品适配器：成员模式 vs 配置模式 deepEqual', async () => {
    if (!dbReady) return
    const { members, config } = await runBothModes(ROW_ADAPTERS.product)
    expect(members.rows.map((r) => r.code)).toContain(prodCode)
    expect(members).toEqual(config)
  })

  it('费用适配器：成员模式 vs 配置模式 deepEqual', async () => {
    if (!dbReady) return
    const { members, config } = await runBothModes(ROW_ADAPTERS.expense)
    expect(members.rows.map((r) => r.code)).toContain(mappingCode)
    expect(members).toEqual(config)
  })

  it('列成员解析与行适配器同源：resolveColMembers 顺序 = loadConfigSource 顺序', async () => {
    if (!dbReady) return
    const cols = await resolveColMembers('category')
    const rows = await loadConfigSource('category')
    expect(cols.map((c) => c.code)).toEqual(rows.map((r) => r.code))
  })
})

describe('回退策略（灰度安全网 + 关停开关）', () => {
  it('成员集未完整覆盖配置行（绕过 service 直插）→ 自动回退配置表', async () => {
    if (!dbReady) return
    const directCode = `DMDC${suffix}`.slice(0, 20)
    await basePrisma.productCategory.create({ data: { code: directCode, name: '直插品类', subjectKeyword: incomeLeafName, sortOrder: 44, status: 'active' } })
    try {
      const rows = await loadConfigSource('category')
      // 直插行无对应成员：覆盖校验失败 → 回退 → 直插行必须可见（未同步配置不得「消失」）
      expect(rows.map((r) => r.code)).toContain(directCode)
    } finally {
      await basePrisma.productCategory.deleteMany({ where: { code: directCode } }).catch(() => undefined)
    }
  })

  it('成员表被清空 → 自动回退配置表', async () => {
    if (!dbReady) return
    const dim = await basePrisma.dimension.findUnique({ where: { code: 'product' } })
    await basePrisma.dimensionMember.deleteMany({ where: { dimensionId: dim?.id ?? '' } }).catch(() => undefined)
    try {
      const rows = await loadConfigSource('product')
      expect(rows.map((r) => r.code)).toContain(prodCode)
    } finally {
      await syncDimensionMembers(basePrisma, 'product') // 还原成员态
    }
  })

  it('env ANALYSIS_DIMENSION_MEMBERS=off → 强制配置模式；恢复后回成员模式', async () => {
    if (!dbReady) return
    const saved = process.env.ANALYSIS_DIMENSION_MEMBERS
    try {
      process.env.ANALYSIS_DIMENSION_MEMBERS = 'off'
      expect(resolveDimensionMode()).toBe('config')
      const forced = await loadConfigSource('category')
      expect(forced.map((r) => r.code)).toEqual(expect.arrayContaining([catCodeA, catCodeB]))
      process.env.ANALYSIS_DIMENSION_MEMBERS = 'on'
      expect(resolveDimensionMode()).toBe('members')
      delete process.env.ANALYSIS_DIMENSION_MEMBERS
      expect(resolveDimensionMode()).toBe('members')
    } finally {
      if (saved === undefined) delete process.env.ANALYSIS_DIMENSION_MEMBERS
      else process.env.ANALYSIS_DIMENSION_MEMBERS = saved
    }
  })
})
