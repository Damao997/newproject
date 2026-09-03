import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { ReclassificationService, reapplyLog } from './ReclassificationService'
import { OPERATING_DIMS } from '../lib/metric-values'

/**
 * 重新应用（reapplyLog）核心契约验证（真实 DB）：
 * - 已撤销记录重放后：原日志 id 与 createdAt 不变、revertedAt 清空（恢复"正常/已生效"）、
 *   库内不产生新日志记录、快照刷新且旧快照与撤销轨迹归档至 detail.history；
 * - 可编辑参数重放：按新参数执行并刷新日志分类字段；
 * - 已生效记录拒绝重复重放（防止双倍调整）；日志类型与重放方式不匹配拒绝；
 * - 跨公司重分类：撤销后重放恢复转移效果，同一条日志记录复用。
 * afterAll 硬删除；无 DB 或 data 类叶子科目不足时跳过。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const RA = `RPYA${suffix}`.slice(0, 20)
const RB = `RPYB${suffix}`.slice(0, 20)
const batchId = `batchrpl_${suffix}`
const period = '2095-03'
const userId = `rpl-user-${suffix}`
const roleId = `rpl-role-${suffix}`
let SRC = ''
let TGT = ''

const scope = { companyCode: null, scopeValue: null, dataScopeCodes: [RA, RB] }
const ctx = { userId }

const value = async (companyCode: string, accountCode: string): Promise<number> => {
  const rows = await basePrisma.factOperating.findMany({ where: { batchId, companyCode, accountCode } })
  return rows.reduce((s, r) => s + Number(r.value), 0)
}

const logCount = () => basePrisma.reclassificationLog.count({ where: { operatedBy: userId } })

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
      take: 20,
    })
    const amountLeaves = await basePrisma.accountSubject.findMany({
      where: { code: { in: dataMetrics.map((m) => m.code) }, valueType: 'amount' },
      select: { code: true },
      take: 2,
    })
    if (amountLeaves.length < 2) return
    ;[SRC, TGT] = amountLeaves.map((m) => m.code)
    dbReady = true

    // 测试专用角色 + 用户：审计日志 userId 有外键约束，须真实存在
    await basePrisma.role.create({ data: { id: roleId, code: roleId, name: `重放测试角色${suffix}`, scopeValue: 'all' } })
    await basePrisma.user.create({
      data: { id: userId, username: userId, displayName: `重放测试用户${suffix}`, passwordHash: 'test-hash', roleId },
    })
    await basePrisma.company.createMany({
      data: [
        { code: RA, name: `重放测试A${suffix}`, entityType: 'single', status: 'active' },
        { code: RB, name: `重放测试B${suffix}`, entityType: 'single', status: 'active' },
      ],
    })
    await basePrisma.importBatch.create({
      data: { id: batchId, fileName: 'rpl-test.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'active', fiscalYear: 'FY2095' },
    })
    await basePrisma.factOperating.createMany({
      data: [
        { batchId, companyCode: RA, accountCode: SRC, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2095', value: 100 },
        { batchId, companyCode: RA, accountCode: TGT, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2095', value: 40 },
      ],
    })
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  await basePrisma.reclassificationLog.deleteMany({ where: { operatedBy: userId } }).catch(() => undefined)
  await basePrisma.auditLog.deleteMany({ where: { userId } }).catch(() => undefined)
  await basePrisma.factOperating.deleteMany({ where: { batchId } }).catch(() => undefined)
  await basePrisma.importBatch.delete({ where: { id: batchId } }).catch(() => undefined)
  await basePrisma.company.deleteMany({ where: { code: { in: [RA, RB] } } }).catch(() => undefined)
  await basePrisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  await basePrisma.role.delete({ where: { id: roleId } }).catch(() => undefined)
})

describe('reapplyLog 科目调整重新应用（真实 DB）', () => {
  it('撤销后重放：同一条日志恢复"正常"态，id/createdAt 不变，不新建记录，历史留痕', async () => {
    if (!dbReady) return
    // 1. 创建调整：SRC 100 → 90
    await ReclassificationService.adjustSubject(
      { templateType: 'operating', companyCode: RA, adjustMode: 'decrease', sourceAccountCode: SRC, decreaseAmount: 10, period, reason: '重复计算修正' },
      scope, ctx,
    )
    expect(await value(RA, SRC)).toBe(90)
    const log1 = await basePrisma.reclassificationLog.findFirst({ where: { sourceCompany: RA, operatedBy: userId, type: 'subject_adjust' }, orderBy: { createdAt: 'desc' } })
    expect(log1).toBeTruthy()
    // 2. 撤销：数据恢复 SRC=100，日志进入已撤销态
    await ReclassificationService.revertLog(log1!.id, scope, ctx)
    expect(await value(RA, SRC)).toBe(100)
    const reverted = await basePrisma.reclassificationLog.findUnique({ where: { id: log1!.id } })
    expect(reverted?.revertedAt).toBeTruthy()
    const createdAt = reverted!.createdAt
    const countBefore = await logCount()
    // 3. 重新应用：原参数重放
    const res = await reapplyLog(
      log1!.id,
      'subject_adjust',
      { templateType: 'operating', companyCode: RA, adjustMode: 'decrease', sourceAccountCode: SRC, decreaseAmount: 10, period, reason: '重复计算修正' },
      scope, ctx,
    )
    expect(res.logId).toBe(log1!.id)
    expect(res.previousStatus).toBe('reverted')
    expect(res.decreaseAmount).toBe(10)
    expect(await value(RA, SRC)).toBe(90)
    // 4. 原记录状态恢复"正常"（revertedAt 清空），id/createdAt 不变，无新增记录
    const after = await logCount()
    expect(after).toBe(countBefore) // 不产生新日志
    const reapplied = await basePrisma.reclassificationLog.findUnique({ where: { id: log1!.id } })
    expect(reapplied?.id).toBe(log1!.id)
    expect(reapplied?.createdAt.toISOString()).toBe(createdAt.toISOString())
    expect(reapplied?.revertedAt).toBeNull()
    expect(reapplied?.revertedBy).toBeNull()
    expect(reapplied?.affectedRows).toBe(1)
    const detail = reapplied?.detail as { snapshot?: unknown; history?: { status: string; detail?: { snapshot?: unknown } }[] }
    expect(detail.snapshot).toBeTruthy() // 新快照已刷新
    expect(detail.history).toHaveLength(1) // 旧快照与撤销轨迹归档
    expect(detail.history![0].status).toBe('reverted')
    expect(detail.history![0].detail?.snapshot).toBeTruthy()
    // 5. 审计日志记录状态变更过程
    const audit = await basePrisma.auditLog.findFirst({ where: { userId, action: 'reclassify', targetId: log1!.id }, orderBy: { createdAt: 'desc' } })
    expect((audit?.detail as { kind?: string; previousStatus?: string; status?: string } | null)).toMatchObject({ kind: 'reapply', previousStatus: 'reverted', status: 'normal' })
  })

  it('已生效记录拒绝重复重放（防止双倍调整）', async () => {
    if (!dbReady) return
    await expect(
      reapplyLog(
        (await basePrisma.reclassificationLog.findFirst({ where: { sourceCompany: RA, operatedBy: userId, type: 'subject_adjust' }, orderBy: { createdAt: 'desc' } }))!.id,
        'subject_adjust',
        { templateType: 'operating', companyCode: RA, adjustMode: 'decrease', sourceAccountCode: SRC, decreaseAmount: 10, period, reason: '重复重放' },
        scope, ctx,
      ),
    ).rejects.toThrow('该记录当前已生效，无需重新应用')
  })

  it('可编辑参数重放：按新金额执行并刷新日志明细，历史累计追加', async () => {
    if (!dbReady) return
    const log1 = await basePrisma.reclassificationLog.findFirst({ where: { sourceCompany: RA, operatedBy: userId, type: 'subject_adjust' }, orderBy: { createdAt: 'desc' } })
    await ReclassificationService.revertLog(log1!.id, scope, ctx)
    expect(await value(RA, SRC)).toBe(100)
    const res = await reapplyLog(
      log1!.id,
      'subject_adjust',
      { templateType: 'operating', companyCode: RA, adjustMode: 'decrease', sourceAccountCode: SRC, decreaseAmount: 20, period, reason: '修正金额后重放' },
      scope, ctx,
    )
    expect(res.decreaseAmount).toBe(20)
    expect(await value(RA, SRC)).toBe(80)
    const reapplied = await basePrisma.reclassificationLog.findUnique({ where: { id: log1!.id } })
    expect(reapplied?.detail).toMatchObject({ decreaseAmount: 20, reason: '修正金额后重放' })
    expect((reapplied?.detail as { history?: unknown[] }).history).toHaveLength(2)
  })

  it('日志类型与重放方式不匹配拒绝', async () => {
    if (!dbReady) return
    const log1 = await basePrisma.reclassificationLog.findFirst({ where: { sourceCompany: RA, operatedBy: userId, type: 'subject_adjust' }, orderBy: { createdAt: 'desc' } })
    await expect(
      reapplyLog(log1!.id, 'company', { templateType: 'operating', sourceCompanyCode: RA, targetCompanyCode: RB, period, transferMode: 'all' }, scope, ctx),
    ).rejects.toThrow('日志类型与重新应用方式不匹配')
  })
})

describe('reapplyLog 跨公司重分类重新应用（真实 DB）', () => {
  it('撤销后重放：行迁移恢复，原日志复用且不新建记录', async () => {
    if (!dbReady) return
    // 用未被科目调整用例改动的 TGT 科目做跨公司迁移，避免跨用例金额耦合
    await ReclassificationService.reclassifyCompany(
      { templateType: 'operating', sourceCompanyCode: RA, targetCompanyCode: RB, accountCodes: [TGT], period, transferMode: 'all' },
      scope, ctx,
    )
    expect(await value(RB, TGT)).toBe(40)
    expect(await value(RA, TGT)).toBe(0)
    const log2 = await basePrisma.reclassificationLog.findFirst({ where: { type: 'company', sourceCompany: RA, targetCompany: RB, operatedBy: userId }, orderBy: { createdAt: 'desc' } })
    expect(log2).toBeTruthy()
    // 2. 撤销：迁回 RA
    await ReclassificationService.revertLog(log2!.id, scope, ctx)
    expect(await value(RA, TGT)).toBe(40)
    expect(await value(RB, TGT)).toBe(0)
    const countBefore = await logCount()
    // 3. 重新应用：再次迁移，原日志复用
    const res = await reapplyLog(
      log2!.id,
      'company',
      { templateType: 'operating', sourceCompanyCode: RA, targetCompanyCode: RB, accountCodes: [TGT], period, transferMode: 'all' },
      scope, ctx,
    )
    expect(res.logId).toBe(log2!.id)
    expect(res.previousStatus).toBe('reverted')
    expect(await value(RB, TGT)).toBe(40)
    expect(await value(RA, TGT)).toBe(0)
    expect(await logCount()).toBe(countBefore)
    const reapplied = await basePrisma.reclassificationLog.findUnique({ where: { id: log2!.id } })
    expect(reapplied?.revertedAt).toBeNull()
    expect(reapplied?.createdAt.toISOString()).toBe(log2!.createdAt.toISOString())
    const detail = reapplied?.detail as { snapshot?: unknown; history?: unknown[] }
    expect(detail.snapshot).toBeTruthy()
    expect(detail.history).toHaveLength(1)
  })
})
