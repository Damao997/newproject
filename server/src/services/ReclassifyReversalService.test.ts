import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { ReclassifyReversalService } from './ReclassifyReversalService'
import { AggregationService, flattenValueTree } from './AggregationService'
import { OPERATING_DIMS } from '../lib/metric-values'

/**
 * 重分类回溯差额服务验证（真实 DB）。
 * 直接构造"重分类后"的事实行 + 含行级快照的重分类日志，断言逆向回放产出的净差额：
 * - 部分转移（源调减 + 目标新建）、整体迁移（合并求和 + 删源行 / 改挂公司）、链式两次调整；
 * - 已撤销日志不参与；快照涉及行缺失的日志跳过并计数；
 * - buildOperatingTree({ excludeReclassify }) 端到端还原重分类前口径。
 * afterAll 硬删除；无 DB 时跳过。数据使用唯一公司/批次，断言按本测试公司过滤，避免环境日志干扰。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const CA = `RVA${suffix}`.slice(0, 20)
const CB = `RVB${suffix}`.slice(0, 20)
const batchId = `batchrev_${suffix}`
const period = '2097-03'
const ACC = 'OP_REV_TEST'
let leafCode = ''
const logIds: string[] = []
const rowIds = {
  partialSource: `rvps_${suffix}`,
  partialCreated: `rvpc_${suffix}`,
  mergeTarget: `rvmt_${suffix}`,
  moved: `rvmv_${suffix}`,
  chained: `rvch_${suffix}`,
  leaf: `rvlf_${suffix}`,
  leafCreated: `rvlc_${suffix}`,
}

const factData = (id: string, companyCode: string, value: number, accountCode = ACC) => ({
  id, batchId, companyCode, accountCode, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2097', value,
})

async function createLog(snapshot: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  const log = await basePrisma.reclassificationLog.create({
    data: {
      type: 'company', templateType: 'operating',
      sourceCompany: CA, targetCompany: CB,
      period, periodFrom: period, periodTo: period,
      affectedRows: 1, operatedBy: 'rev-test',
      detail: { snapshot } as never,
      ...extra,
    },
  })
  logIds.push(log.id)
}

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    // 取一个 data 类经营叶子科目，供端到端聚合断言（计算层不会覆盖其值）
    const leaves = await basePrisma.accountSubject.findMany({
      where: { subjectType: 'operating', isLeaf: true, status: 'active' },
      select: { code: true },
    })
    const dataMetric = await basePrisma.metric.findFirst({
      where: { code: { in: leaves.map((l) => l.code) }, dataType: 'data' },
      select: { code: true },
    })
    leafCode = dataMetric?.code ?? ''
    dbReady = !!leafCode
    if (!dbReady) return

    await basePrisma.importBatch.create({
      data: { id: batchId, fileName: 'rev-test.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'active', fiscalYear: 'FY2097' },
    })
    await basePrisma.factOperating.createMany({
      data: [
        // 场景 1：部分转移后现状——源行 100→70，目标新建 30
        factData(rowIds.partialSource, CA, 70),
        factData(rowIds.partialCreated, CB, 30),
        // 场景 2：整体迁移合并后现状——目标行 150→250（源行 100 已删除）
        factData(rowIds.mergeTarget, CB, 250, `${ACC}_M`),
        // 场景 3：整体迁移改挂后现状——行已挂 CB（原属 CA）
        factData(rowIds.moved, CB, 50, `${ACC}_V`),
        // 场景 4：链式两次调整后现状——100→70→40
        factData(rowIds.chained, CA, 40, `${ACC}_C`),
        // 端到端：真实叶子科目，部分转移后现状 100→70 + 目标新建 30
        factData(rowIds.leaf, CA, 70, leafCode),
        factData(rowIds.leafCreated, CB, 30, leafCode),
      ],
    })

    // 场景 1 日志（含端到端叶子科目行，合并为一次操作）
    await createLog({
      updated: [
        { id: rowIds.partialSource, data: { value: 100 } },
        { id: rowIds.leaf, data: { value: 100 } },
      ],
      created: [rowIds.partialCreated, rowIds.leafCreated],
      deleted: [],
    })
    // 场景 2 日志：合并求和（目标回写 150）+ 源行重建（100）
    await createLog({
      updated: [{ id: rowIds.mergeTarget, data: { value: 150 } }],
      created: [],
      deleted: [factData(`rvdel_${suffix}`, CA, 100, `${ACC}_M`)],
    })
    // 场景 3 日志：整行改挂（companyCode 回写 CA）
    await createLog({ updated: [{ id: rowIds.moved, data: { companyCode: CA } }], created: [], deleted: [] })
    // 场景 4 日志：链式两次（先 100→70，后 70→40；createdAt 区分先后）
    await createLog({ updated: [{ id: rowIds.chained, data: { value: 100 } }], created: [], deleted: [] }, { createdAt: new Date('2097-01-01T00:00:00Z') })
    await createLog({ updated: [{ id: rowIds.chained, data: { value: 70 } }], created: [], deleted: [] }, { createdAt: new Date('2097-01-02T00:00:00Z') })
    // 已撤销日志：不应参与回放（若参与会给 CA 多加 999）
    await createLog(
      { updated: [{ id: rowIds.partialSource, data: { value: 999 } }], created: [], deleted: [] },
      { revertedAt: new Date(), revertedBy: 'rev-test', createdAt: new Date('2096-01-01T00:00:00Z') },
    )
    // 缺行日志：快照引用不存在的行，应整条跳过并计数
    await createLog({ updated: [{ id: `missing_${suffix}`, data: { value: 1 } }], created: [], deleted: [] })
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (logIds.length > 0) await basePrisma.reclassificationLog.deleteMany({ where: { id: { in: logIds } } }).catch(() => undefined)
  await basePrisma.factOperating.deleteMany({ where: { batchId } }).catch(() => undefined)
  await basePrisma.importBatch.delete({ where: { id: batchId } }).catch(() => undefined)
})

const deltaOf = (deltas: { companyCode: string; accountCode: string; period?: string; delta: number }[], companyCode: string, accountCode: string): number =>
  deltas.filter((d) => d.companyCode === companyCode && d.accountCode === accountCode && d.period === period).reduce((s, d) => s + d.delta, 0)

describe('ReclassifyReversalService 快照逆向回放（真实 DB）', () => {
  it('部分转移：源公司加回转移额，目标公司剔除新建行', async () => {
    if (!dbReady) return
    const { deltas } = await ReclassifyReversalService.buildReversalDeltas('operating')
    expect(deltaOf(deltas, CA, ACC)).toBe(30) // 100 - 70
    expect(deltaOf(deltas, CB, ACC)).toBe(-30) // 新建行 30 剔除
  })

  it('整体迁移合并：目标回写合并前值，删除的源行重现', async () => {
    if (!dbReady) return
    const { deltas } = await ReclassifyReversalService.buildReversalDeltas('operating')
    expect(deltaOf(deltas, CB, `${ACC}_M`)).toBe(-100) // 250 → 150
    expect(deltaOf(deltas, CA, `${ACC}_M`)).toBe(100) // 删除行 100 重现
  })

  it('整体迁移改挂：行回挂源公司，两侧差额对冲', async () => {
    if (!dbReady) return
    const { deltas } = await ReclassifyReversalService.buildReversalDeltas('operating')
    expect(deltaOf(deltas, CB, `${ACC}_V`)).toBe(-50)
    expect(deltaOf(deltas, CA, `${ACC}_V`)).toBe(50)
  })

  it('链式两次调整：倒序回放还原至最初值；已撤销日志不参与', async () => {
    if (!dbReady) return
    const { deltas } = await ReclassifyReversalService.buildReversalDeltas('operating')
    // 40 → 回放后 100：差额 +60（若已撤销日志参与，会变成 999-40）
    expect(deltaOf(deltas, CA, `${ACC}_C`)).toBe(60)
  })

  it('快照涉及行缺失的日志整条跳过并计入 skippedLogs', async () => {
    if (!dbReady) return
    const { skippedLogs } = await ReclassifyReversalService.buildReversalDeltas('operating')
    expect(skippedLogs).toBeGreaterThanOrEqual(1)
  })

  it('buildOperatingTree({ excludeReclassify }) 端到端还原重分类前口径', async () => {
    if (!dbReady) return
    // 默认口径：源公司本月 70，目标公司本月 30
    const treeA = await AggregationService.buildOperatingTree([CA], period)
    expect(flattenValueTree(treeA).find((n) => n.code === leafCode)!.values[OPERATING_DIMS.ACTUAL_MONTH]).toBe(70)
    // 去重分类口径：源公司还原为 100，目标公司归零
    const treeB = await AggregationService.buildOperatingTree([CA], period, { excludeReclassify: true })
    expect(flattenValueTree(treeB).find((n) => n.code === leafCode)!.values[OPERATING_DIMS.ACTUAL_MONTH]).toBe(100)
    const treeC = await AggregationService.buildOperatingTree([CB], period, { excludeReclassify: true })
    expect(flattenValueTree(treeC).find((n) => n.code === leafCode)!.values[OPERATING_DIMS.ACTUAL_MONTH]).toBe(0)
  })
})
