import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { ReclassificationService } from './ReclassificationService'
import { OPERATING_DIMS } from '../lib/metric-values'

/**
 * 撤销顺序守卫回归（真实 DB，无 DB 时整组跳过）：
 * 同一行先 A 后 B 两次调整，撤销 A（非末笔）必须被拒绝；撤销 B 后方可撤销 A。
 * 用独立公司与远期期间隔离，afterAll 清理。
 */

const CO = 'EN999912'
const ACC_SRC = '__TEST_RO_SRC__'
const ACC_DST = '__TEST_RO_DST__'
const P = '2096-07'

let dbReady = false
let batchId = ''
let rowId = ''
let logA = ''
let logB = ''
const logIds: string[] = []
const factIds: string[] = []

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    // 事实行 + 生效批次
    const batch = await basePrisma.importBatch.create({
      data: { fileName: '__revert_order__.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'active', sourceType: 'upload', fiscalYear: 'FY2095' },
    })
    batchId = batch.id
    const fact = await basePrisma.factOperating.create({
      data: { batchId: batch.id, companyCode: CO, accountCode: ACC_SRC, period: P, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2095', value: 100 },
    })
    rowId = fact.id
    factIds.push(fact.id)
    // 两笔先后调整：A 100→90，B 90→70（快照均为调整前完整值）
    const mkLog = async (from: number) => {
      const log = await basePrisma.reclassificationLog.create({
        data: {
          type: 'company', templateType: 'operating', sourceCompany: CO, targetCompany: CO,
          sourceSubject: ACC_SRC, targetSubject: ACC_DST, period: P, affectedRows: 1,
          operatedBy: 'test-user',
          detail: {
            snapshot: {
              updated: [{ id: fact.id, data: { value: from }, row: { id: fact.id, value: from, accountCode: ACC_SRC, batchId: batch.id, companyCode: CO } }],
              created: [],
              deleted: [],
            },
          } as never,
        },
      })
      logIds.push(log.id)
      return log.id
    }
    logA = await mkLog(100)
    // 确保 createdAt 严格递增（同一毫秒内创建时排序守卫仍需区分）
    await new Promise((r) => setTimeout(r, 5))
    logB = await mkLog(90)
    // 模拟 B 已应用：行现值为 70
    await basePrisma.factOperating.update({ where: { id: rowId }, data: { value: 70 } })
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.reclassificationLog.deleteMany({ where: { id: { in: logIds } } }).catch(() => undefined)
  await basePrisma.factOperating.deleteMany({ where: { id: { in: factIds } } }).catch(() => undefined)
  await basePrisma.importBatch.deleteMany({ where: { id: batchId } }).catch(() => undefined)
})

const ctx = () => ({ userId: 'test-user', traceId: 'test', actorRoleId: 'test-role' })

describe('撤销顺序守卫（真实 DB，H4 回归）', () => {
  it('撤销非末笔调整（A）被拒绝且数据保持 B 之后值', async () => {
    if (!dbReady) return
    await expect(ReclassificationService.revertLog(logA, { type: 'all' } as never, ctx())).rejects.toMatchObject({
      message: expect.stringContaining('后续调整'),
    })
    const row = await basePrisma.factOperating.findUnique({ where: { id: rowId }, select: { value: true } })
    expect(Number(row?.value)).toBe(70)
  })

  it('按倒序撤销：先 B 后 A 可依次恢复 90/100', async () => {
    if (!dbReady) return
    await ReclassificationService.revertLog(logB, { type: 'all' } as never, ctx())
    let row = await basePrisma.factOperating.findUnique({ where: { id: rowId }, select: { value: true } })
    expect(Number(row?.value)).toBe(90)
    await ReclassificationService.revertLog(logA, { type: 'all' } as never, ctx())
    row = await basePrisma.factOperating.findUnique({ where: { id: rowId }, select: { value: true } })
    expect(Number(row?.value)).toBe(100)
  })
})
