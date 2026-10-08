import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { basePrisma } from '../lib/prisma'
import { CASHFLOW_DIMS, OPERATING_DIMS, STATIC_DIMS } from '../lib/metric-values'
import { scopeStore } from '../middleware/scope-context'
import { companyPeriodsOf } from '../lib/import-coverage'
import { ImportService } from './ImportService'
import { AggregationService } from './AggregationService'

// 本组必须连接独立测试库；准备失败直接报错，不以提前返回伪装通过。
const suffix = Date.now().toString(36)
const A = 'IMPA' + suffix
const B = 'IMPB' + suffix
const P1 = '2091-08'
const P2 = '2091-09'
const FY = 'FY2091'
const types = ['operating', 'static', 'cashflow'] as const
type MonthlyType = typeof types[number]
const subject = (type: MonthlyType, second = false) => 'IMP_' + type + '_' + suffix + (second ? '_2' : '')
const companyName = (code: string) => '导入隔离' + code
const subjectName = (type: MonthlyType) => '导入隔离科目' + type + suffix
const batchIds: string[] = []
let roleId = ''
let userId = ''
const scopeA = <T>(fn: () => T): T => scopeStore.run({ type: 'companies', companyCodes: [A], summaryCodes: [] }, fn)

interface InputRow { companyCode: string; period: string; value: number; second?: boolean; day?: number }
async function makeBatch(type: MonthlyType, status: 'draft' | 'active', rows: InputRow[]) {
  const b = await basePrisma.importBatch.create({ data: { fileName: '隔离测试-' + suffix + '.xlsx', dataType: type, lifecycleStatus: status, status: 'success', sourceType: 'upload', fiscalYear: FY } })
  batchIds.push(b.id)
  if (rows.length) {
    if (type === 'static') {
      await basePrisma.factStatic.createMany({ data: rows.map((r) => ({ batchId: b.id, companyCode: r.companyCode, accountCode: subject(type, r.second), snapshotDate: new Date(r.period + '-' + String(r.day ?? 1).padStart(2, '0') + 'T00:00:00Z'), periodDimCode: STATIC_DIMS.CURRENT_AMOUNT, fiscalYear: FY, value: r.value })) })
    } else {
      await basePrisma.factOperating.createMany({ data: rows.map((r) => ({ batchId: b.id, companyCode: r.companyCode, accountCode: subject(type, r.second), period: r.period, periodDimCode: type === 'cashflow' ? CASHFLOW_DIMS.ACTUAL_MONTH : OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: FY, value: r.value })) })
    }
  }
  return b
}

async function facts(type: MonthlyType, batchId: string) {
  return type === 'static'
    ? basePrisma.factStatic.findMany({ where: { batchId }, orderBy: { id: 'asc' } })
    : basePrisma.factOperating.findMany({ where: { batchId }, orderBy: { id: 'asc' } })
}

function workbook(type: MonthlyType, sheetName = 'Sheet1') {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['单体维度', companyName(A), companyName(B)],
    ['月份', new Date('2091-08-15T00:00:00Z'), new Date('2091-09-15T00:00:00Z')],
    [subjectName(type), 0, 333],
  ], { cellDates: true }), sheetName)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

beforeAll(async () => {
  await basePrisma.$queryRaw`SELECT 1`
  const role = await basePrisma.role.create({ data: { code: 'imp_' + suffix, name: '导入隔离测试', scopeValue: '*' } })
  roleId = role.id
  const user = await basePrisma.user.create({ data: { username: 'imp_' + suffix, displayName: '导入隔离测试', passwordHash: '测试夹具', roleId } })
  userId = user.id
  await basePrisma.company.createMany({ data: [A, B].map((code) => ({ code, name: companyName(code), entityType: 'single' as const })) })
  for (const type of types) {
    await basePrisma.accountSubject.createMany({ data: [false, true].map((second) => ({ code: subject(type, second), name: subjectName(type) + (second ? '二' : ''), subjectType: type, level: 0, category: '导入测试', direction: 'debit' as const, isLeaf: true })) })
  }
})

afterEach(async () => {
  await basePrisma.reclassificationLog.deleteMany({ where: { operatedBy: userId } })
  await basePrisma.auditLog.deleteMany({ where: { userId } })
  const where = { batchId: { in: batchIds } }
  await basePrisma.factOperating.deleteMany({ where })
  await basePrisma.factStatic.deleteMany({ where })
  await basePrisma.factSnapshot.deleteMany({ where })
  await basePrisma.importBatch.deleteMany({ where: { id: { in: batchIds } } })
  batchIds.length = 0
})

afterAll(async () => {
  await basePrisma.accountSubject.deleteMany({ where: { code: { in: types.flatMap((t) => [subject(t), subject(t, true)]) } } })
  await basePrisma.company.deleteMany({ where: { code: { in: [A, B] } } })
  if (userId) await basePrisma.user.delete({ where: { id: userId } })
  if (roleId) await basePrisma.role.delete({ where: { id: roleId } })
})

describe.each(types)('%s 导入公司隔离（真实测试库）', (type) => {
  it('受限账号更新甲公司整月、零值生效，乙公司行及旧批次保持不变', async () => {
    const old = await makeBatch(type, 'active', [{ companyCode: A, period: P1, value: 100, day: 28 }, { companyCode: A, period: P1, value: 50, second: true }, { companyCode: B, period: P1, value: 200, day: 28 }])
    const before = (await facts(type, old.id)).filter((r) => r.companyCode === B)
    const next = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 0 }])
    await scopeA(() => ImportService.activate(next.id, userId, 'isolation'))
    expect(await facts(type, old.id)).toEqual(before)
    expect((await basePrisma.importBatch.findUniqueOrThrow({ where: { id: old.id } })).lifecycleStatus).toBe('active')
    const snaps = await basePrisma.factSnapshot.findMany({ where: { archivedByBatchId: next.id } })
    expect(snaps).toHaveLength(2)
    expect(snaps.every((r) => r.companyCode === A)).toBe(true)
    const tree = type === 'static' ? await AggregationService.buildStaticTree([A, B], P1) : type === 'cashflow' ? await AggregationService.buildCashflowTree([A, B], P1) : await AggregationService.buildOperatingTree([A, B], P1)
    const dim = type === 'static' ? STATIC_DIMS.CURRENT_AMOUNT : type === 'cashflow' ? CASHFLOW_DIMS.ACTUAL_MONTH : OPERATING_DIMS.ACTUAL_MONTH
    expect(tree.find((n) => n.code === subject(type))?.values[dim]).toBe(200)
    const audit = await basePrisma.auditLog.findFirstOrThrow({ where: { userId, targetId: next.id } })
    expect(audit.detail).toMatchObject({ replacementCompanyPeriods: [{ companyCode: A, period: P1 }], deletedRows: 2 })
  })

  it('只覆盖甲8月与乙9月，保留甲9月与乙8月', async () => {
    const old = await makeBatch(type, 'active', [A, B].flatMap((companyCode) => [P1, P2].map((period) => ({ companyCode, period, value: 100 }))))
    const before = (await facts(type, old.id)).filter((r) => {
      const period = 'period' in r ? r.period : r.snapshotDate.toISOString().slice(0, 7)
      return r.companyCode === A ? period === P2 : period === P1
    })
    const next = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 11 }, { companyCode: B, period: P2, value: 22 }])
    await ImportService.activate(next.id, userId)
    expect(await facts(type, old.id)).toEqual(before)
    expect(await basePrisma.factSnapshot.count({ where: { archivedByBatchId: next.id } })).toBe(2)
  })

  it('首批及已有批次混入越权公司均拒绝，事实行、快照和状态不变', async () => {
    const next = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 11 }, { companyCode: B, period: P1, value: 22 }])
    await expect(scopeA(() => ImportService.activate(next.id, userId))).rejects.toMatchObject({ message: expect.stringContaining('数据范围') })
    const old = await makeBatch(type, 'active', [{ companyCode: A, period: P1, value: 100 }])
    const before = await facts(type, old.id)
    await expect(scopeA(() => ImportService.activate(next.id, userId))).rejects.toMatchObject({ message: expect.stringContaining('数据范围') })
    expect(await facts(type, old.id)).toEqual(before)
    expect((await basePrisma.importBatch.findUniqueOrThrow({ where: { id: next.id } })).lifecycleStatus).toBe('draft')
    expect(await basePrisma.factSnapshot.count({ where: { archivedByBatchId: next.id } })).toBe(0)
  })

  it('无有效行不删除或归档其他批次', async () => {
    const old = await makeBatch(type, 'active', [{ companyCode: B, period: P1, value: 100 }])
    const before = await facts(type, old.id)
    const next = await makeBatch(type, 'draft', [])
    await scopeA(() => ImportService.activate(next.id, userId))
    expect(await facts(type, old.id)).toEqual(before)
    expect((await basePrisma.importBatch.findUniqueOrThrow({ where: { id: old.id } })).lifecycleStatus).toBe('active')
  })

  it('单文件、多表预览与批量预检均按公司月份报告，实际激活一致', async () => {
    const old = await makeBatch(type, 'active', [{ companyCode: A, period: P1, value: 100 }, { companyCode: A, period: P2, value: 200 }, { companyCode: B, period: P1, value: 300 }])
    const file = { buffer: workbook(type) }
    const preview = await ImportService.preview(file, type, FY)
    expect(preview.errorCount).toBe(0)
    const expected = { newCompanyPeriods: [{ companyCode: B, period: P2 }], overlappingCompanyPeriods: [{ companyCode: A, period: P1 }], retainedCompanyPeriods: [{ companyCode: A, period: P2 }, { companyCode: B, period: P1 }] }
    expect(preview.activationImpact).toMatchObject(expected)
    const names = { operating: '经营数据', static: '静态数据', cashflow: '现金流量数据' }
    const merged = await ImportService.previewMerged({ buffer: workbook(type, names[type]) }, FY)
    expect(merged.perType[type]?.activationImpact).toMatchObject(expected)
    const next = await ImportService.upload({ ...file, originalname: '公司隔离-' + type + '.xlsx', size: file.buffer.length }, type, userId, undefined, FY)
    batchIds.push(next.id)
    const [check] = await ImportService.checkBatchActivateConflicts([next.id])
    expect(check.conflicts).toEqual([{ companyCode: A, period: P1 }])
    await ImportService.activate(next.id, userId)
    const remaining = await facts(type, old.id)
    expect(companyPeriodsOf(remaining)).toEqual(expected.retainedCompanyPeriods)
  })

  it('不同公司同月不冲突，同公司同月的所选批次提示互相覆盖', async () => {
    const old = await makeBatch(type, 'active', [{ companyCode: B, period: P1, value: 100 }])
    const a = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 11 }])
    const a2 = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 22 }])
    const b = await makeBatch(type, 'draft', [{ companyCode: B, period: P2, value: 33 }])
    const check = await ImportService.checkBatchActivateConflicts([a.id, a2.id, b.id])
    expect(check.map((c) => c.conflictCount)).toEqual([0, 0, 0])
    expect(check.map((c) => c.crossBatchConflictCount)).toEqual([1, 1, 0])
    expect((await facts(type, old.id))).toHaveLength(1)
  })

  it('受限账号仅替换范围内公司时，无关公司重分类不被误标失效', async () => {
    if (type === 'cashflow') return // 现金流没有重分类体系。
    const old = await makeBatch(type, 'active', [{ companyCode: A, period: P1, value: 100 }, { companyCode: B, period: P1, value: 200 }])
    const rows = await facts(type, old.id)
    const logs = []
    for (const row of rows) {
      logs.push(await basePrisma.reclassificationLog.create({ data: { type: 'subject_adjust', templateType: type, sourceCompany: row.companyCode, period: P1, operatedBy: userId, detail: { snapshot: { updated: [{ id: row.id, data: { value: 1 } }], created: [], deleted: [] } } } }))
    }
    const next = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 11 }])
    await scopeA(() => ImportService.activate(next.id, userId))
    for (const log of logs) {
      const current = await basePrisma.reclassificationLog.findUniqueOrThrow({ where: { id: log.id } })
      if (log.sourceCompany === A) expect(current.invalidatedAt).not.toBeNull()
      else expect(current).toEqual(log)
    }
  })

  it('回滚仅恢复目标公司的月份，重复激活幂等且其他公司不变', async () => {
    const old = await makeBatch(type, 'active', [{ companyCode: A, period: P1, value: 100 }])
    const unrelated = await makeBatch(type, 'active', [{ companyCode: B, period: P1, value: 200 }])
    const before = await facts(type, unrelated.id)
    const next = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 11 }])
    await ImportService.activate(next.id, userId)
    await scopeA(() => ImportService.rollbackBatch(old.id, userId))
    await scopeA(() => ImportService.activate(old.id, userId))
    expect(await facts(type, unrelated.id)).toEqual(before)
    expect((await facts(type, old.id)).map((r) => Number(r.value))).toEqual([100])
    expect(await facts(type, next.id)).toHaveLength(0)
  })

  it('回滚前检查完整快照权限，拒绝时不恢复数据也不消费快照', async () => {
    const old = await makeBatch(type, 'active', [{ companyCode: A, period: P1, value: 100 }, { companyCode: B, period: P1, value: 200 }])
    const next = await makeBatch(type, 'draft', [{ companyCode: B, period: P1, value: 22 }])
    await ImportService.activate(next.id, userId)
    const before = await facts(type, old.id)
    const snapshots = await basePrisma.factSnapshot.findMany({ where: { batchId: old.id } })
    await expect(scopeA(() => ImportService.rollbackBatch(old.id, userId))).rejects.toMatchObject({ message: expect.stringContaining('数据范围') })
    expect(await facts(type, old.id)).toEqual(before)
    expect(await basePrisma.factSnapshot.findMany({ where: { batchId: old.id } })).toEqual(snapshots)
  })

  it('并发激活同公司同月只留一份有效数据，其他公司数据保留', async () => {
    const old = await makeBatch(type, 'active', [{ companyCode: B, period: P1, value: 100 }])
    const before = await facts(type, old.id)
    const a = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 11 }])
    const b = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 22 }])
    await Promise.all([ImportService.activate(a.id, userId), ImportService.activate(b.id, userId)])
    expect((await facts(type, a.id)).length + (await facts(type, b.id)).length).toBe(1)
    expect(await facts(type, old.id)).toEqual(before)
  })

  it('并发激活不同公司同月均有效，不互相覆盖', async () => {
    const a = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 11 }])
    const b = await makeBatch(type, 'draft', [{ companyCode: B, period: P1, value: 22 }])
    await Promise.all([ImportService.activate(a.id, userId), ImportService.activate(b.id, userId)])
    expect(await facts(type, a.id)).toHaveLength(1)
    expect(await facts(type, b.id)).toHaveLength(1)
  })

  it('回滚与激活共用互斥锁，并发结束后只有一个公司月份版本生效', async () => {
    const old = await makeBatch(type, 'active', [{ companyCode: A, period: P1, value: 100 }])
    const next = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 11 }])
    await ImportService.activate(next.id, userId)
    const last = await makeBatch(type, 'draft', [{ companyCode: A, period: P1, value: 22 }])
    await Promise.all([ImportService.rollbackBatch(old.id, userId), ImportService.activate(last.id, userId)])
    const active = await basePrisma.importBatch.findMany({ where: { id: { in: [old.id, next.id, last.id] }, lifecycleStatus: 'active' } })
    expect(active).toHaveLength(1)
    expect(await facts(type, active[0].id)).toHaveLength(1)
  })
})

it('批量冲突不混淆经营与现金流，即使公司月份相同', async () => {
  const a = await makeBatch('operating', 'draft', [{ companyCode: A, period: P1, value: 11 }])
  const b = await makeBatch('cashflow', 'draft', [{ companyCode: A, period: P1, value: 22 }])
  expect((await ImportService.checkBatchActivateConflicts([a.id, b.id])).map((r) => r.crossBatchConflictCount)).toEqual([0, 0])
})
