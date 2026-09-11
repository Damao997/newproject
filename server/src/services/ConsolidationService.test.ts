import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { ConsolidationService } from './ConsolidationService'
import { AggregationService, flattenValueTree, type ValueNode } from './AggregationService'
import { DashboardService } from './DashboardService'
import { OPERATING_DIMS, STATIC_DIMS, CASHFLOW_DIMS } from '../lib/metric-values'

/**
 * 汇总抵消调整集成测试（真实 DB）：创建 → 汇总聚合叠加生效（本月/累计）、
 * 单体查询不生效、删除后恢复、越权拒绝、参数校验。无 DB 时整组跳过。
 */
let dbReady = false
let adminId = ''
let summaryCode = ''
let dataSubjectCode = ''
let calcSubjectCode = ''
const createdAdjustmentIds: string[] = []
let testStartAt: Date

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const admin = await prisma.user.findUnique({ where: { username: 'admin' }, select: { id: true } })
    const summary = await prisma.company.findFirst({ where: { entityType: 'summary', status: 'active' }, select: { code: true } })
    const dataSubject = await prisma.accountSubject.findFirst({
      where: { subjectType: 'operating', status: 'active' },
      select: { code: true },
    })
    const metrics = await prisma.metric.findMany({ where: { code: { in: dataSubject ? [dataSubject.code] : [] }, dataType: 'data' }, select: { code: true } })
    // calc 类科目：以经营科目树为准（metric 表含旧编码残留 OP_*，无科目对应，不能作为抵消校验目标）
    const calcCodes = (await prisma.metric.findMany({ where: { dataType: 'calc' }, select: { code: true } })).map((m) => m.code)
    const calcMetric = calcCodes.length
      ? await prisma.accountSubject.findFirst({ where: { code: { in: calcCodes }, subjectType: 'operating', status: 'active' }, select: { code: true } })
      : null
    dbReady = !!(admin && summary && dataSubject && metrics.length > 0)
    if (dbReady) {
      adminId = admin.id
      summaryCode = summary.code
      dataSubjectCode = dataSubject.code
      calcSubjectCode = calcMetric?.code ?? ''
      testStartAt = new Date()
    }
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.consolidationAdjustment.deleteMany({ where: { id: { in: createdAdjustmentIds } } }).catch(() => undefined)
  await basePrisma.auditLog.deleteMany({ where: { action: 'consolidation', createdAt: { gte: testStartAt } } }).catch(() => undefined)
})

const ctx = () => ({ userId: adminId, traceId: 'consolidation-test' })
/** 全量数据权限（角色全量 scopeValue='*'，与真实 admin 角色一致；无 ALS 上下文时 resolveScope 也恒为 all） */
const fullScope = { companyCode: '', scopeValue: '*', dataScopeCodes: null }
/** 仅绑定单体公司的数据权限（无任何汇总主体授权）；运行时求值（依赖 beforeAll 赋值） */
const singleOnlyScope = () => ({ companyCode: dataSubjectCode, scopeValue: '', dataScopeCodes: null })

describe('ConsolidationService 汇总抵消调整', () => {
  it('参数校验：金额 0、期间非法、原因空、非汇总主体、calc 科目均拒绝', async () => {
    if (!dbReady) return
    const base = {
      templateType: 'operating' as const,
      summaryCompanyCode: summaryCode,
      accountCode: dataSubjectCode,
      period: '2026-06',
      reason: '内部现金流抵消',
    }
    await expect(ConsolidationService.createAdjustment({ ...base, amount: 0 }, fullScope, ctx())).rejects.toThrow('非 0')
    await expect(ConsolidationService.createAdjustment({ ...base, amount: 100, period: '2026-13' }, fullScope, ctx())).rejects.toThrow('单月')
    await expect(ConsolidationService.createAdjustment({ ...base, amount: 100, reason: '  ' }, fullScope, ctx())).rejects.toThrow('原因')
    // 单体公司不能作为抵消主体
    const single = await prisma.company.findFirst({ where: { entityType: 'single', status: 'active' }, select: { code: true } })
    if (single) {
      await expect(ConsolidationService.createAdjustment({ ...base, summaryCompanyCode: single.code, amount: 100 }, fullScope, ctx())).rejects.toThrow('汇总主体')
    }
    // calc 类科目由公式计算，不可抵消
    if (calcSubjectCode) {
      await expect(ConsolidationService.createAdjustment({ ...base, accountCode: calcSubjectCode, amount: 100 }, fullScope, ctx())).rejects.toThrow('data 类')
    }
  })

  it('越权拒绝：数据范围不含该汇总主体时禁止创建', async () => {
    if (!dbReady) return
    await expect(
      ConsolidationService.createAdjustment(
        { templateType: 'operating', summaryCompanyCode: summaryCode, accountCode: dataSubjectCode, period: '2026-06', amount: -100, reason: '越权测试' },
        singleOnlyScope(),
        ctx(),
      ),
    ).rejects.toThrow('无权操作汇总主体')
  })

  it('commonSummariesOf：按汇总映射匹配共同汇总主体（交集 + 权限过滤）', async () => {
    if (!dbReady) return
    // 取与已知汇总主体（beforeAll 取到的第一个）直接映射的两个单体
    const members = await prisma.companyAggregationMap.findMany({
      where: { summaryCompanyCode: summaryCode },
      select: { singleCompanyCode: true },
      take: 2,
    })
    if (members.length < 2) return // 成员不足时跳过（seed 映射需至少 2 个成员）
    const [a, b] = members.map((m) => m.singleCompanyCode)

    // 全量权限：返回交集（至少包含该汇总主体）
    const res = await ConsolidationService.commonSummariesOf(a, b, fullScope)
    expect(res.summaries.some((s) => s.code === summaryCode)).toBe(true)
    expect(res.summaries.every((s) => typeof s.name === 'string' && typeof s.isInternalElimination === 'boolean')).toBe(true)

    // 无汇总主体授权的数据范围：权限过滤后为空
    const restricted = await ConsolidationService.commonSummariesOf(a, b, singleOnlyScope())
    expect(restricted.summaries).toEqual([])

    // 参数校验：相同公司 / 汇总主体 / 不存在公司
    await expect(ConsolidationService.commonSummariesOf(a, a, fullScope)).rejects.toThrow('不能相同')
    await expect(ConsolidationService.commonSummariesOf(summaryCode, b, fullScope)).rejects.toThrow('必须是单体公司')
    await expect(ConsolidationService.commonSummariesOf('EN_NOT_EXIST', b, fullScope)).rejects.toThrow('不存在')
  })

  it('commonSummariesOf：无共同汇总主体的单体对返回空数组', async () => {
    if (!dbReady) return
    // 在内存中构造两个汇总归属完全无交集的单体对（遍历所有映射）
    const allMaps = await prisma.companyAggregationMap.findMany({ select: { singleCompanyCode: true, summaryCompanyCode: true } })
    const bySingle = new Map<string, Set<string>>()
    for (const m of allMaps) {
      const set = bySingle.get(m.singleCompanyCode) ?? new Set<string>()
      set.add(m.summaryCompanyCode)
      bySingle.set(m.singleCompanyCode, set)
    }
    const singles = [...bySingle.keys()]
    let pair: [string, string] | null = null
    for (let i = 0; i < singles.length && !pair; i++) {
      for (let j = i + 1; j < singles.length; j++) {
        const setA = bySingle.get(singles[i]) as Set<string>
        const setB = bySingle.get(singles[j]) as Set<string>
        if ([...setA].every((c) => !setB.has(c))) {
          pair = [singles[i], singles[j]]
          break
        }
      }
    }
    if (!pair) return // 所有单体对均有共同汇总时跳过
    const res = await ConsolidationService.commonSummariesOf(pair[0], pair[1], fullScope)
    expect(res.summaries).toEqual([])
  })

  it('创建抵消 → 汇总聚合叠加生效（本月实际/本年累计/同期实际/同期累计），单体聚合不受影响；删除后恢复', async () => {
    if (!dbReady) return
    const period = '2026-06'
    const nextPeriod = `${Number(period.slice(0, 4)) + 1}${period.slice(4)}` // 2027-06：验证同期口径
    const amount = -88.5
    const created = await ConsolidationService.createAdjustment(
      { templateType: 'operating', summaryCompanyCode: summaryCode, accountCode: dataSubjectCode, period, amount, reason: '内部公司间现金流抵消' },
      fullScope,
      ctx(),
    )
    createdAdjustmentIds.push(created.id)

    // 汇总主体成员展开（含 ET0001 的映射，若存在）
    const summary = await prisma.company.findUnique({ where: { code: summaryCode }, select: { code: true, entityType: true } })
    const maps = summary?.entityType === 'summary'
      ? await prisma.companyAggregationMap.findMany({ where: { summaryCompanyCode: summaryCode }, select: { singleCompanyCode: true } })
      : []
    const memberCodes = maps.map((m) => m.singleCompanyCode)
    if (memberCodes.length === 0) return // 无成员映射时跳过聚合断言（服务层校验已覆盖）

    // 汇总口径：叠加抵消额；单体口径：不叠加
    const treeWith = await AggregationService.buildOperatingTree(memberCodes, period, { consolidationSummaryCode: summaryCode })
    const treeWithout = await AggregationService.buildOperatingTree(memberCodes, period)
    const findVal = (tree: ValueNode[]): { month: number; ytd: number; same: number; sameYtd: number } => {
      const flat = (nodes: ValueNode[]): ValueNode[] => nodes.flatMap((n) => [n, ...flat(n.children ?? [])])
      const found = flat(tree).find((n) => n.code === dataSubjectCode)
      return {
        month: found?.values[OPERATING_DIMS.ACTUAL_MONTH] ?? 0,
        ytd: found?.values[OPERATING_DIMS.YTD_ACTUAL] ?? 0,
        same: found?.values[OPERATING_DIMS.SAME_PERIOD_ACTUAL] ?? 0,
        sameYtd: found?.values[OPERATING_DIMS.SAME_PERIOD_YTD] ?? 0,
      }
    }
    const withVal = findVal(treeWith)
    const withoutVal = findVal(treeWithout)
    expect(withVal.month - withoutVal.month).toBeCloseTo(amount, 1)
    // 6 月在财年范围内（fiscalStartMonth=1 时 YTD 同样叠加）
    expect(withVal.ytd - withoutVal.ytd).toBeCloseTo(amount, 1)

    // 同期口径：查询抵消期 + 1 年（2027-06）时，同期实际/同期累计应叠加抵消额（同比可比口径）
    const treeNextWith = await AggregationService.buildOperatingTree(memberCodes, nextPeriod, { consolidationSummaryCode: summaryCode })
    const treeNextWithout = await AggregationService.buildOperatingTree(memberCodes, nextPeriod)
    const nextWith = findVal(treeNextWith)
    const nextWithout = findVal(treeNextWithout)
    expect(nextWith.same - nextWithout.same).toBeCloseTo(amount, 1)
    expect(nextWith.sameYtd - nextWithout.sameYtd).toBeCloseTo(amount, 1)

    // 列表包含新记录
    const list = await ConsolidationService.listAdjustments({ page: 1, pageSize: 10 })
    expect(list.items.some((i) => i.id === created.id)).toBe(true)
    expect(list.items.find((i) => i.id === created.id)?.reason).toBe('内部公司间现金流抵消')

    // 删除（撤销）后汇总口径恢复（含同期维度）
    await ConsolidationService.deleteAdjustment(created.id, fullScope, ctx())
    const treeAfter = await AggregationService.buildOperatingTree(memberCodes, period, { consolidationSummaryCode: summaryCode })
    const afterVal = findVal(treeAfter)
    expect(afterVal.month).toBeCloseTo(withoutVal.month, 1)
    expect(afterVal.ytd).toBeCloseTo(withoutVal.ytd, 1)
    const treeNextAfter = await AggregationService.buildOperatingTree(memberCodes, nextPeriod, { consolidationSummaryCode: summaryCode })
    const nextAfter = findVal(treeNextAfter)
    expect(nextAfter.same).toBeCloseTo(nextWithout.same, 1)
    expect(nextAfter.sameYtd).toBeCloseTo(nextWithout.sameYtd, 1)
    // 已删除记录从列表消失
    const listAfter = await ConsolidationService.listAdjustments({ page: 1, pageSize: 10 })
    expect(listAfter.items.some((i) => i.id === created.id)).toBe(false)
  })

  it('listAdjustments 按数据范围过滤：受限范围不可见范围外汇总主体记录，无范围返回空', async () => {
    if (!dbReady) return
    const period = '2026-06'
    const created = await ConsolidationService.createAdjustment(
      { templateType: 'operating', summaryCompanyCode: summaryCode, accountCode: dataSubjectCode, period, amount: 66.6, reason: '列表范围过滤测试' },
      fullScope,
      ctx(),
    )
    createdAdjustmentIds.push(created.id)

    // 全量范围：可见
    const fullList = await ConsolidationService.listAdjustments({ page: 1, pageSize: 50 }, fullScope)
    expect(fullList.items.some((i) => i.id === created.id)).toBe(true)

    // 仅单体数据范围（无该汇总主体授权）：不可见
    const restrictedList = await ConsolidationService.listAdjustments({ page: 1, pageSize: 50 }, singleOnlyScope())
    expect(restrictedList.items.some((i) => i.id === created.id)).toBe(false)

    // 无任何数据范围（兜底 none）：空列表
    const noneList = await ConsolidationService.listAdjustments({ page: 1, pageSize: 50 }, { companyCode: '', scopeValue: '', dataScopeCodes: null })
    expect(noneList.items).toEqual([])
    expect(noneList.total).toBe(0)
  })

  it('创建抵消后 DashboardService.getOverview 汇总口径生效（看板链路透传抵消上下文）', async () => {
    if (!dbReady) return
    // 取 DB 最新事实期间（保证在可用期间内，避免 getOverview 期间回退导致口径错位）
    const batch = await prisma.importBatch.findFirst({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
    const latest = batch
      ? await prisma.factOperating.findFirst({ where: { batchId: batch.id }, orderBy: { period: 'desc' }, select: { period: true } })
      : null
    if (!batch || !latest) return
    const period = latest.period
    // 收入 KPI 节点路径上的 data 叶子（抵消叠加于收入口径 → 收入卡 monthActual 变化；计算类叶子不可直接抵消）
    const revenueSubject = await prisma.accountSubject.findFirst({
      where: { subjectType: 'operating', category: '收入', isLeaf: true, status: 'active' },
      select: { code: true },
    })
    const revenueMetric = revenueSubject
      ? await prisma.metric.findUnique({ where: { code: revenueSubject.code }, select: { dataType: true } })
      : null
    if (!revenueSubject || (revenueMetric?.dataType ?? 'data') !== 'data') return
    const amount = 42.5
    // 基线：无抵消时的看板收入卡本月实际
    const before = await DashboardService.getOverview(fullScope, { companyCode: summaryCode, period })
    const beforeVal = before.kpiData.find((k) => k.title === '收入')?.monthActual ?? null
    if (beforeVal === null) return

    const created = await ConsolidationService.createAdjustment(
      { templateType: 'operating', summaryCompanyCode: summaryCode, accountCode: revenueSubject.code, period, amount, reason: '看板透传测试' },
      fullScope,
      ctx(),
    )
    createdAdjustmentIds.push(created.id)

    const after = await DashboardService.getOverview(fullScope, { companyCode: summaryCode, period })
    const afterVal = after.kpiData.find((k) => k.title === '收入')?.monthActual ?? null
    expect(afterVal).not.toBeNull()
    expect((afterVal as number) - beforeVal).toBeCloseTo(amount, 1)
  })
})

describe('静态模板汇总抵消（templateType=static）', () => {
  let ok = false
  let staticLeaf = ''
  let memberCode = ''
  let adjustId = ''
  const SP = '2098-05'

  beforeAll(async () => {
    try {
      await basePrisma.$queryRaw`SELECT 1`
      const leaves = await basePrisma.accountSubject.findMany({ where: { subjectType: 'static', isLeaf: true, status: 'active' }, select: { code: true } })
      const dm = await basePrisma.metric.findFirst({ where: { code: { in: leaves.map((l) => l.code) }, dataType: 'data' }, select: { code: true } })
      staticLeaf = dm?.code ?? ''
      if (!staticLeaf || !summaryCode) return
      const m = await basePrisma.companyAggregationMap.findFirst({ where: { summaryCompanyCode: summaryCode }, select: { singleCompanyCode: true } })
      memberCode = m?.singleCompanyCode ?? ''
      if (!memberCode) return
      const created = await ConsolidationService.createAdjustment(
        { templateType: 'static', summaryCompanyCode: summaryCode, accountCode: staticLeaf, period: SP, amount: 123.45, reason: '静态模板抵消测试' },
        fullScope,
        ctx(),
      )
      adjustId = created.id
      createdAdjustmentIds.push(created.id)
      ok = true
    } catch {
      ok = false
    }
  })

  afterAll(async () => {
    if (adjustId) await basePrisma.consolidationAdjustment.deleteMany({ where: { id: adjustId } }).catch(() => undefined)
  })

  it('static 模板创建成功，并在静态树汇总口径叠加（单体链路不叠加）', async () => {
    if (!ok) return
    // 成员公司无静态行数据 → 默认四维为 0；抵消叠加后本期快照 = 123.45
    const treeWith = await AggregationService.buildStaticTree([memberCode], SP, { consolidationSummaryCode: summaryCode })
    expect(flattenValueTree(treeWith).find((n) => n.code === staticLeaf)?.values[STATIC_DIMS.CURRENT_AMOUNT] ?? 0).toBe(123.45)
    const treeWithout = await AggregationService.buildStaticTree([memberCode], SP)
    expect(flattenValueTree(treeWithout).find((n) => n.code === staticLeaf)?.values[STATIC_DIMS.CURRENT_AMOUNT] ?? 0).toBe(0)
  })

  it('static 模板拒绝经营科目（科目不属于所选模板科目树）', async () => {
    if (!ok) return
    await expect(
      ConsolidationService.createAdjustment(
        { templateType: 'static', summaryCompanyCode: summaryCode, accountCode: dataSubjectCode, period: SP, amount: 50, reason: '科目树校验测试' },
        fullScope,
        ctx(),
      ),
    ).rejects.toThrow('不属于所选模板科目树')
  })
})

describe('现金流量表模板汇总抵消（templateType=cashflow）', () => {
  let ok = false
  let cfLeaf = ''
  let memberCode = ''
  let adjustId = ''
  const SP = '2098-06'

  beforeAll(async () => {
    try {
      await basePrisma.$queryRaw`SELECT 1`
      // 现金流 data 类叶子（流入/流出层）；净额类 CF01~04 为 calc，不作为候选
      const leaves = await basePrisma.accountSubject.findMany({ where: { subjectType: 'cashflow', isLeaf: true, status: 'active' }, select: { code: true } })
      const dm = await basePrisma.metric.findFirst({ where: { code: { in: leaves.map((l) => l.code) }, dataType: 'data' }, select: { code: true } })
      cfLeaf = dm?.code ?? ''
      if (!cfLeaf || !summaryCode) return
      const m = await basePrisma.companyAggregationMap.findFirst({ where: { summaryCompanyCode: summaryCode }, select: { singleCompanyCode: true } })
      memberCode = m?.singleCompanyCode ?? ''
      if (!memberCode) return
      const created = await ConsolidationService.createAdjustment(
        { templateType: 'cashflow', summaryCompanyCode: summaryCode, accountCode: cfLeaf, period: SP, amount: -66.5, reason: '现金流模板抵消测试' },
        fullScope,
        ctx(),
      )
      adjustId = created.id
      createdAdjustmentIds.push(created.id)
      ok = true
    } catch {
      ok = false
    }
  })

  afterAll(async () => {
    if (adjustId) await basePrisma.consolidationAdjustment.deleteMany({ where: { id: adjustId } }).catch(() => undefined)
  })

  it('cashflow 模板创建成功，并在现金流树汇总口径叠加本月实际与本年累计（单体链路不叠加）', async () => {
    if (!ok) return
    // 测试期 2098-06 无真实现金流数据 → 基线为 0；抵消后本期/累计（财年内）均叠加抵消额
    const treeWith = await AggregationService.buildCashflowTree([memberCode], SP, { consolidationSummaryCode: summaryCode })
    const found = flattenValueTree(treeWith).find((n) => n.code === cfLeaf)
    expect(found?.values[CASHFLOW_DIMS.ACTUAL_MONTH] ?? 0).toBe(-66.5)
    expect(found?.values[CASHFLOW_DIMS.YTD_ACTUAL] ?? 0).toBe(-66.5)
    const treeWithout = await AggregationService.buildCashflowTree([memberCode], SP)
    const base = flattenValueTree(treeWithout).find((n) => n.code === cfLeaf)
    expect(base?.values[CASHFLOW_DIMS.ACTUAL_MONTH] ?? 0).toBe(0)
  })

  it('cashflow 模板拒绝经营科目与现金流 calc 科目（净额类由公式计算）', async () => {
    if (!ok) return
    await expect(
      ConsolidationService.createAdjustment(
        { templateType: 'cashflow', summaryCompanyCode: summaryCode, accountCode: dataSubjectCode, period: SP, amount: 50, reason: '科目树校验测试' },
        fullScope,
        ctx(),
      ),
    ).rejects.toThrow('不属于所选模板科目树')
    const calcCf = await basePrisma.metric.findFirst({
      where: { dataType: 'calc', code: { startsWith: 'CF' } },
      select: { code: true },
    })
    if (calcCf) {
      await expect(
        ConsolidationService.createAdjustment(
          { templateType: 'cashflow', summaryCompanyCode: summaryCode, accountCode: calcCf.code, period: SP, amount: 50, reason: 'calc 拦截测试' },
          fullScope,
          ctx(),
        ),
      ).rejects.toThrow('data 类')
    }
  })
})
