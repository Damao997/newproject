import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { OPERATING_DIMS } from '../lib/metric-values'
import { ReclassificationService } from './ReclassificationService'
import { ImportService } from './ImportService'
import { ReclassifyReversalService } from './ReclassifyReversalService'

/**
 * 重分类记录批次替换失效保护验证（真实 DB）。
 * 覆盖：
 * - 快照 v2 写入格式（updated.row 完整行、created 为 { id, data }）；
 * - operating 激活物理删除行 → 引用日志联动标记失效（rows_missing），revertLog 拒绝、listLogs 透出失效信息；
 * - budget 按财年整体替换（旧批次归档）→ batch_inactive；
 * - archive / purge 联动；旧格式（v1）快照与已撤销日志的边界行为；
 * - ReclassifyReversalService 显式排除失效日志并计数 invalidatedLogs。
 * afterAll 硬删除；无 DB 时跳过。数据使用唯一公司/期间，避免与既有测试互扰。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const CA = `IVA${suffix}`.slice(0, 20)
const CB = `IVB${suffix}`.slice(0, 20)
let userId = ''
const period = '2099-01'
const fy = 'FY2099'
const dim = OPERATING_DIMS.ACTUAL_MONTH
let leafCode = ''
let leafCode2 = ''

const scope = { companyCode: null, scopeValue: null, dataScopeCodes: [CA, CB] }
// getter 动态读取 userId（beforeAll 中创建 user 后才赋值）
const ctx = {
  get userId() {
    return userId
  },
}

const batchIds: string[] = []
const logIds: string[] = []
// 用例 1 产生的日志（后续用例断言其失效状态）
let logIdL1 = ''

async function mkBatch(over: Record<string, unknown> = {}) {
  const b = await basePrisma.importBatch.create({
    data: {
      fileName: `inv-${suffix}.xlsx`, status: 'success', dataType: 'operating',
      lifecycleStatus: 'draft', sourceType: 'upload', fiscalYear: fy, ...over,
    },
  })
  batchIds.push(b.id)
  return b
}

/** 手工构造重分类日志（快照可按需传），统一登记清理 */
async function mkLog(snapshot: unknown, extra: Record<string, unknown> = {}) {
  const log = await basePrisma.reclassificationLog.create({
    data: {
      type: 'company', templateType: 'operating', sourceCompany: CA, targetCompany: CB,
      period, periodFrom: period, periodTo: period, affectedRows: 1, operatedBy: userId,
      detail: { snapshot } as never,
      ...extra,
    },
  })
  logIds.push(log.id)
  return log
}

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const leaves = await basePrisma.accountSubject.findMany({
      where: { subjectType: 'operating', isLeaf: true, status: 'active' },
      select: { code: true },
    })
    const dataMetrics = await basePrisma.metric.findMany({
      where: { code: { in: leaves.map((l) => l.code) }, dataType: 'data' },
      select: { code: true },
      take: 2,
    })
    ;[leafCode, leafCode2] = dataMetrics.map((m) => m.code)
    dbReady = !!(leafCode && leafCode2)
    if (!dbReady) return
    await basePrisma.company.createMany({
      data: [
        { code: CA, name: `失效测试A${suffix}`, entityType: 'single', status: 'active' },
        { code: CB, name: `失效测试B${suffix}`, entityType: 'single', status: 'active' },
      ],
    })
    // 真实 user 记录，保证审计日志外键可写入（避免 stderr 噪音）
    const role = await basePrisma.role.findFirst({ select: { id: true } })
    if (!role) return
    const u = await basePrisma.user.create({
      data: { username: `inv-user-${suffix}`, displayName: `失效测试${suffix}`, passwordHash: 'x', roleId: role.id },
    })
    userId = u.id
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.reclassificationLog.deleteMany({ where: { id: { in: logIds } } }).catch(() => undefined)
  await basePrisma.auditLog.deleteMany({ where: { userId } }).catch(() => undefined)
  if (userId) await basePrisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  for (const id of batchIds) {
    await basePrisma.factOperating.deleteMany({ where: { batchId: id } }).catch(() => undefined)
    await basePrisma.factBudget.deleteMany({ where: { batchId: id } }).catch(() => undefined)
    await basePrisma.factSnapshot.deleteMany({ where: { batchId: id } }).catch(() => undefined)
    await basePrisma.importBatch.delete({ where: { id } }).catch(() => undefined)
  }
  await basePrisma.company.deleteMany({ where: { code: { in: [CA, CB] } } }).catch(() => undefined)
})

describe('快照 v2 写入格式（真实 DB）', () => {
  it('跨公司整行迁移：updated 含完整 row（批次/公司/科目/期间），data 仅含被改字段', async () => {
    if (!dbReady) return
    const b1 = await mkBatch({ lifecycleStatus: 'active' })
    await basePrisma.factOperating.createMany({
      data: [{ batchId: b1.id, companyCode: CA, accountCode: leafCode, period, periodDimCode: dim, fiscalYear: fy, value: 100 }],
    })
    const res = await ReclassificationService.reclassifyCompany(
      { templateType: 'operating', sourceCompanyCode: CA, targetCompanyCode: CB, accountCodes: [leafCode], period, transferMode: 'all' },
      scope, ctx,
    )
    expect(res.affectedRows).toBe(1)
    const log = await basePrisma.reclassificationLog.findFirst({
      where: { sourceCompany: CA, targetCompany: CB, operatedBy: userId, periodFrom: period },
      orderBy: { createdAt: 'desc' },
    })
    expect(log).toBeTruthy()
    logIdL1 = log!.id
    logIds.push(log!.id)
    const snap = (log!.detail as { snapshot: { updated: Array<{ data: Record<string, unknown>; row: Record<string, unknown> }> } }).snapshot
    expect(snap.updated[0].data).toEqual({ companyCode: CA }) // 仅被改字段（撤销回写用）
    expect(snap.updated[0].row).toMatchObject({ batchId: b1.id, companyCode: CA, accountCode: leafCode, period, fiscalYear: fy })
  })

  it('adjustSubject 新建行：created 为 { id, data } 对象（含批次/期间），且可正常撤销', async () => {
    if (!dbReady) return
    const res = await ReclassificationService.adjustSubject(
      { templateType: 'operating', companyCode: CB, adjustMode: 'increase', targetAccountCode: leafCode2, increaseAmount: 30, period, reason: '快照v2新建测试' },
      scope, ctx,
    )
    expect(res.createdRows).toBe(1)
    const log = await basePrisma.reclassificationLog.findFirst({
      where: { sourceCompany: CB, operatedBy: userId, periodFrom: period },
      orderBy: { createdAt: 'desc' },
    })
    logIds.push(log!.id)
    const created = (log!.detail as { snapshot: { created: Array<{ id: string; data: Record<string, unknown> }> } }).snapshot.created
    expect(created[0]).toMatchObject({ id: expect.any(String) })
    expect(created[0].data).toMatchObject({ companyCode: CB, accountCode: leafCode2, period })
    // 撤销后新建行删除（v2 快照兼容）
    const revert = await ReclassificationService.revertLog(log!.id, scope, ctx)
    expect(revert.restoredRows).toBe(1)
    expect(await basePrisma.factOperating.count({ where: { batchId: created[0].data.batchId as string, companyCode: CB, accountCode: leafCode2, period } })).toBe(0)
  })
})

describe('批次变更联动失效标记（真实 DB）', () => {
  it('operating 激活替换物理删除行：引用日志标记 rows_missing，revert 拒绝，list 透出', async () => {
    if (!dbReady) return
    // 用例 1 的日志 L1 引用 b1 的 period 行（已被改挂到 CB）；激活同期间新批次将物理删除该行
    const b2 = await mkBatch({})
    await basePrisma.factOperating.createMany({
      data: [{ batchId: b2.id, companyCode: CB, accountCode: leafCode, period, periodDimCode: dim, fiscalYear: fy, value: 200 }],
    })
    const active = await ImportService.activate(b2.id, userId, 'trace')
    expect(active.status).toBe('active')

    const l1 = await basePrisma.reclassificationLog.findUnique({ where: { id: logIdL1 } })
    expect(l1).toBeTruthy()
    expect(l1!.invalidatedAt).not.toBeNull()
    expect(l1!.invalidatedReason).toBe('rows_missing')
    expect(l1!.invalidatedBy).toBe(userId)
    expect((l1!.detail as { invalidation: Record<string, unknown> }).invalidation).toMatchObject({
      reason: 'rows_missing', replacedByBatchId: b2.id, replacedPeriods: [period],
    })
    // revertLog 拒绝且提示失效原因
    await expect(ReclassificationService.revertLog(logIdL1, scope, ctx)).rejects.toThrow('因批次替换/归档已失效')
    // listLogs 透出失效状态与原因
    const page = await ReclassificationService.listLogs({ page: 1, pageSize: 50 })
    const item = page.items.find((i) => i.id === logIdL1)
    expect(item?.revertible).toBe(false)
    expect(item?.invalidatedReason).toBe('rows_missing')
    expect(item?.invalidatedAt).toBeTruthy()
    expect(item?.invalidation).toMatchObject({ replacedByBatchId: b2.id })
  })

  it('旧格式（v1）快照日志同样被标记；已撤销日志不参与', async () => {
    if (!dbReady) return
    const b3 = await mkBatch({ lifecycleStatus: 'active' })
    const rowOld = `oldfmt_${suffix}`
    await basePrisma.factOperating.create({
      data: { id: rowOld, batchId: b3.id, companyCode: CA, accountCode: leafCode, period, periodDimCode: dim, fiscalYear: fy, value: 50 },
    })
    // v1 快照：updated 无 row、created 为 string[]
    const oldLog = await mkLog({ updated: [{ id: rowOld, data: { value: 50 } }], created: [], deleted: [] })
    const revertedLog = await mkLog(
      { updated: [{ id: rowOld, data: { value: 50 } }], created: [], deleted: [] },
      { revertedAt: new Date(), revertedBy: userId },
    )
    const b4 = await mkBatch({})
    await basePrisma.factOperating.createMany({
      data: [{ batchId: b4.id, companyCode: CA, accountCode: leafCode, period, periodDimCode: dim, fiscalYear: fy, value: 5 }],
    })
    await ImportService.activate(b4.id, userId, 'trace')
    const after = await basePrisma.reclassificationLog.findMany({ where: { id: { in: [oldLog.id, revertedLog.id] } } })
    const oldRowRec = after.find((l) => l.id === oldLog.id)!
    const revRowRec = after.find((l) => l.id === revertedLog.id)!
    expect(oldRowRec.invalidatedReason).toBe('rows_missing') // 按行 id 存在性校验对 v1 同样生效
    expect(revRowRec.invalidatedAt).toBeNull() // 已撤销不参与失效标记
  })

  it('budget 按财年整体替换：旧批次归档（行保留），引用日志标记 batch_inactive', async () => {
    if (!dbReady) return
    const bb1 = await mkBatch({ dataType: 'budget', lifecycleStatus: 'active' })
    const budgetRowId = `budr_${suffix}`
    await basePrisma.factBudget.create({
      data: { id: budgetRowId, batchId: bb1.id, companyCode: CA, accountCode: leafCode, fiscalYear: fy, period, value: 100 },
    })
    const bLog = await mkLog({ updated: [{ id: budgetRowId, data: { value: 100 } }], created: [], deleted: [] }, { templateType: 'budget' })
    const bb2 = await mkBatch({ dataType: 'budget' })
    await basePrisma.factBudget.createMany({
      data: [{ batchId: bb2.id, companyCode: CB, accountCode: leafCode, fiscalYear: fy, period, value: 300 }],
    })
    await ImportService.activate(bb2.id, userId, 'trace')
    expect(await basePrisma.importBatch.findUnique({ where: { id: bb1.id } })).toMatchObject({ lifecycleStatus: 'archived' })
    const after = await basePrisma.reclassificationLog.findUnique({ where: { id: bLog.id } })
    expect(after!.invalidatedReason).toBe('batch_inactive') // 行仍在但所属批次已归档
    expect(after!.invalidatedAt).not.toBeNull()
  })

  it('archive 批次：引用日志标记 batch_inactive（行保留）', async () => {
    if (!dbReady) return
    const p = '2099-04'
    const b5 = await mkBatch({ lifecycleStatus: 'active' })
    const row5 = `arcr_${suffix}`
    await basePrisma.factOperating.create({
      data: { id: row5, batchId: b5.id, companyCode: CB, accountCode: leafCode, period: p, periodDimCode: dim, fiscalYear: fy, value: 10 },
    })
    const log5 = await mkLog({ updated: [{ id: row5, data: { value: 10 } }], created: [], deleted: [] }, { periodFrom: p, periodTo: p })
    await ImportService.archive(b5.id, userId, 'trace')
    const after = await basePrisma.reclassificationLog.findUnique({ where: { id: log5.id } })
    expect(after!.invalidatedReason).toBe('batch_inactive')
    // 行仍保留（archive 不删行）
    expect(await basePrisma.factOperating.count({ where: { id: row5 } })).toBe(1)
  })

  it('purge 批次：物理删除行后引用日志标记 rows_missing', async () => {
    if (!dbReady) return
    const p = '2099-05'
    const b6 = await mkBatch({ lifecycleStatus: 'archived' })
    const row6 = `purgr_${suffix}`
    await basePrisma.factOperating.create({
      data: { id: row6, batchId: b6.id, companyCode: CA, accountCode: leafCode, period: p, periodDimCode: dim, fiscalYear: fy, value: 10 },
    })
    const log6 = await mkLog({ updated: [{ id: row6, data: { value: 10 } }], created: [], deleted: [] }, { periodFrom: p, periodTo: p })
    await ImportService.purge(b6.id, userId, 'trace')
    const after = await basePrisma.reclassificationLog.findUnique({ where: { id: log6.id } })
    expect(after!.invalidatedReason).toBe('rows_missing')
    expect(await basePrisma.factOperating.count({ where: { id: row6 } })).toBe(0)
  })
})

describe('回溯差额层显式感知失效（真实 DB）', () => {
  it('失效日志被显式排除并计入 invalidatedLogs，其差额不再参与回放', async () => {
    if (!dbReady) return
    const res = await ReclassifyReversalService.buildReversalDeltas('operating')
    expect(res.invalidatedLogs).toBeGreaterThanOrEqual(1) // 本文件已联动标记多条失效日志
    // archive 用例的失效日志（CB×leafCode×2099-04）不应再产生差额
    const hit = res.deltas.some((d) => d.companyCode === CB && d.accountCode === leafCode && d.period === '2099-04')
    expect(hit).toBe(false)
  })
})
