import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { ReclassificationService } from './ReclassificationService'
import { OPERATING_DIMS } from '../lib/metric-values'

/**
 * 科目间金额调整（adjustSubject）三种调整方式 + 值类型分型验证（真实 DB）。
 * 造唯一单体公司 + 独立 active 经营批次 + 现有 data 类金额叶子科目的事实行，顺序验证：
 * - increase：目标行存在时累加；无目标行时以同期模板行新建，且可 revertLog 撤销；
 * - 旧参数（不传 adjustMode）推断为仅调减，行为不变；both：调减 + 调增双向执行；
 * - increase：公司当期无任何事实行时 conflict；previewAdjustSubject increase 模式返回 targetTotal；
 * - 数量类科目：整数分摊（unit=1）、小数拒绝、detail.valueType 记录；
 * - 比率类科目拒绝调整；both 模式金额/数量混配拒绝。
 * afterAll 硬删除；无 DB 或 data 类叶子科目不足时跳过。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const CA = `ADJA${suffix}`.slice(0, 20)
const CB = `ADJB${suffix}`.slice(0, 20)
const batchId = `batchadj_${suffix}`
const period = '2096-05'
const userId = `adj-test-${suffix}`
let SRC = ''
let TGT = ''
let TGT2 = ''
// 分型测试专用科目（beforeAll 创建，afterAll 删除）
const QTY_SRC = `QTYA${suffix}`.toUpperCase()
const QTY_TGT = `QTYB${suffix}`.toUpperCase()
const RATIO_SUBJ = `RATIO${suffix}`.toUpperCase()

const scope = { companyCode: null, scopeValue: null, dataScopeCodes: [CA, CB] }
const ctx = { userId }

const value = async (companyCode: string, accountCode: string): Promise<number> => {
  const rows = await basePrisma.factOperating.findMany({ where: { batchId, companyCode, accountCode } })
  return rows.reduce((s, r) => s + Number(r.value), 0)
}

const latestLog = async () =>
  basePrisma.reclassificationLog.findFirst({ where: { sourceCompany: CA, operatedBy: userId }, orderBy: { createdAt: 'desc' } })

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    // 取 3 个 data 类经营叶子科目（源/目标/新建目标）
    const leaves = await basePrisma.accountSubject.findMany({
      where: { subjectType: 'operating', isLeaf: true, status: 'active' },
      select: { code: true },
    })
    const dataMetrics = await basePrisma.metric.findMany({
      where: { code: { in: leaves.map((l) => l.code) }, dataType: 'data' },
      select: { code: true },
      take: 20,
    })
    // 既有用例依赖金额类口径，只取 valueType='amount' 的 data 类叶子
    const amountLeaves = await basePrisma.accountSubject.findMany({
      where: { code: { in: dataMetrics.map((m) => m.code) }, valueType: 'amount' },
      select: { code: true },
      take: 3,
    })
    if (amountLeaves.length < 3) return
    ;[SRC, TGT, TGT2] = amountLeaves.map((m) => m.code)
    dbReady = true

    // 分型测试科目：数量类源/目标 + 比率类（均为经营叶子）
    await basePrisma.accountSubject.createMany({
      data: [
        { code: QTY_SRC, name: `数量源${suffix}`, subjectType: 'operating', level: 1, category: '测试', direction: 'debit', valueType: 'quantity', isLeaf: true },
        { code: QTY_TGT, name: `数量目标${suffix}`, subjectType: 'operating', level: 1, category: '测试', direction: 'debit', valueType: 'quantity', isLeaf: true },
        { code: RATIO_SUBJ, name: `比率测试${suffix}`, subjectType: 'operating', level: 1, category: '测试', direction: 'debit', valueType: 'ratio', isLeaf: true },
      ],
    })

    await basePrisma.company.createMany({
      data: [
        { code: CA, name: `调整测试A${suffix}`, entityType: 'single', status: 'active' },
        { code: CB, name: `调整测试B${suffix}`, entityType: 'single', status: 'active' },
      ],
    })
    await basePrisma.importBatch.create({
      data: { id: batchId, fileName: 'adj-test.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'active', fiscalYear: 'FY2096' },
    })
    await basePrisma.factOperating.createMany({
      data: [
        { batchId, companyCode: CA, accountCode: SRC, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2096', value: 100 },
        { batchId, companyCode: CA, accountCode: TGT, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2096', value: 40 },
        // 数量类源科目两行（不同期间维度以满足唯一键）：7 + 3 = 10
        { batchId, companyCode: CA, accountCode: QTY_SRC, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2096', value: 7 },
        { batchId, companyCode: CA, accountCode: QTY_SRC, period, periodDimCode: 'QTY_DIM_TEST', fiscalYear: 'FY2096', value: 3 },
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
  await basePrisma.company.deleteMany({ where: { code: { in: [CA, CB] } } }).catch(() => undefined)
  await basePrisma.accountSubject.deleteMany({ where: { code: { in: [QTY_SRC, QTY_TGT, RATIO_SUBJ] } } }).catch(() => undefined)
})

describe('adjustSubject 三种调整方式（真实 DB）', () => {
  it('increase：目标行存在时累加，源科目不受影响，日志记录 adjustMode', async () => {
    if (!dbReady) return
    const res = await ReclassificationService.adjustSubject(
      { templateType: 'operating', companyCode: CA, adjustMode: 'increase', targetAccountCode: TGT, increaseAmount: 30, period, reason: '补录遗漏' },
      scope, ctx,
    )
    expect(res.increaseAmount).toBe(30)
    expect(res.decreaseAmount).toBe(0)
    expect(res.mergedRows).toBe(1)
    expect(await value(CA, TGT)).toBe(70) // 40 + 30
    expect(await value(CA, SRC)).toBe(100) // 源科目不变
    const log = await latestLog()
    expect(log?.sourceSubject).toBeNull()
    expect(log?.targetSubject).toBe(TGT)
    expect((log?.detail as { adjustMode?: string })?.adjustMode).toBe('increase')
    expect((log?.detail as { decreaseAmount?: number })?.decreaseAmount).toBe(0)
  })

  it('increase：无目标行时以同期模板行新建，revertLog 撤销后删除新建行', async () => {
    if (!dbReady) return
    const res = await ReclassificationService.adjustSubject(
      { templateType: 'operating', companyCode: CA, adjustMode: 'increase', targetAccountCode: TGT2, increaseAmount: 20, period, reason: '补录新科目' },
      scope, ctx,
    )
    expect(res.createdRows).toBe(1)
    expect(res.increaseAmount).toBe(20)
    expect(await value(CA, TGT2)).toBe(20)
    const log = await latestLog()
    const revert = await ReclassificationService.revertLog(log!.id, scope, ctx)
    expect(revert.restoredRows).toBe(1)
    expect(await value(CA, TGT2)).toBe(0) // 新建行已删除
  })

  it('旧参数（不传 adjustMode）推断为仅调减，行为与既有一致', async () => {
    if (!dbReady) return
    const res = await ReclassificationService.adjustSubject(
      { templateType: 'operating', companyCode: CA, sourceAccountCode: SRC, decreaseAmount: 10, period, reason: '修正重复计算' },
      scope, ctx,
    )
    expect(res.decreaseAmount).toBe(10)
    expect(res.increaseAmount).toBe(0)
    expect(await value(CA, SRC)).toBe(90) // 100 - 10
    expect((await latestLog())?.detail).toMatchObject({ adjustMode: 'decrease' })
  })

  it('both：调减与调增双向执行', async () => {
    if (!dbReady) return
    const res = await ReclassificationService.adjustSubject(
      { templateType: 'operating', companyCode: CA, adjustMode: 'both', sourceAccountCode: SRC, targetAccountCode: TGT, decreaseAmount: 20, increaseAmount: 20, period, reason: '科目间重分类' },
      scope, ctx,
    )
    expect(res.decreaseAmount).toBe(20)
    expect(res.increaseAmount).toBe(20)
    expect(res.netChange).toBe(0)
    expect(await value(CA, SRC)).toBe(70) // 90 - 20
    expect(await value(CA, TGT)).toBe(90) // 70 + 20
  })

  it('increase：公司当期无任何事实行时 conflict', async () => {
    if (!dbReady) return
    await expect(
      ReclassificationService.adjustSubject(
        { templateType: 'operating', companyCode: CB, adjustMode: 'increase', targetAccountCode: TGT, increaseAmount: 5, period, reason: '无数据公司' },
        scope, ctx,
      ),
    ).rejects.toThrow('该公司该期间暂无生效数据，无法调增')
  })

  it('previewAdjustSubject increase 模式返回 targetTotal 与净变动', async () => {
    if (!dbReady) return
    const preview = await ReclassificationService.previewAdjustSubject(
      { templateType: 'operating', companyCode: CA, adjustMode: 'increase', targetAccountCode: TGT, increaseAmount: 15, period },
      scope,
    )
    expect(preview.targetTotal).toBe(90)
    expect(preview.affectedRows).toBe(1)
    expect(preview.decreaseAmount).toBe(0)
    expect(preview.netChange).toBe(15)
  })
})

describe('adjustSubject 值类型分型（数量/比率，真实 DB）', () => {
  it('数量类仅调减：整数分摊、合计恰等、各行不超原值，日志记 valueType', async () => {
    if (!dbReady) return
    const res = await ReclassificationService.adjustSubject(
      { templateType: 'operating', companyCode: CA, adjustMode: 'decrease', sourceAccountCode: QTY_SRC, decreaseAmount: 4, period, reason: '数量多计' },
      scope, ctx,
    )
    expect(res.decreaseAmount).toBe(4)
    expect(await value(CA, QTY_SRC)).toBe(6) // 10 - 4
    const rows = await basePrisma.factOperating.findMany({ where: { batchId, companyCode: CA, accountCode: QTY_SRC } })
    for (const r of rows) {
      expect(Number.isInteger(Number(r.value))).toBe(true) // 整数分摊，无小数残值
      expect(Number(r.value)).toBeGreaterThanOrEqual(0)
    }
    expect((await latestLog())?.detail).toMatchObject({ adjustMode: 'decrease', valueType: 'quantity' })
  })

  it('数量类传小数拒绝；仅调增预览返回 valueType=quantity', async () => {
    if (!dbReady) return
    await expect(
      ReclassificationService.adjustSubject(
        { templateType: 'operating', companyCode: CA, adjustMode: 'decrease', sourceAccountCode: QTY_SRC, decreaseAmount: 1.5, period, reason: '小数测试' },
        scope, ctx,
      ),
    ).rejects.toThrow('必须为大于 0 的整数')
    const preview = await ReclassificationService.previewAdjustSubject(
      { templateType: 'operating', companyCode: CA, adjustMode: 'increase', targetAccountCode: QTY_TGT, increaseAmount: 5, period },
      scope,
    )
    expect(preview.valueType).toBe('quantity')
    expect(preview.affectedRows).toBe(1) // 无目标行，将以模板行新建 1 行
  })

  it('比率类科目拒绝调整；both 模式金额/数量混配拒绝', async () => {
    if (!dbReady) return
    await expect(
      ReclassificationService.adjustSubject(
        { templateType: 'operating', companyCode: CA, adjustMode: 'decrease', sourceAccountCode: RATIO_SUBJ, decreaseAmount: 1, period, reason: '比率测试' },
        scope, ctx,
      ),
    ).rejects.toThrow('比率类科目由公式计算，不支持金额调整')
    await expect(
      ReclassificationService.adjustSubject(
        { templateType: 'operating', companyCode: CA, adjustMode: 'both', sourceAccountCode: SRC, targetAccountCode: QTY_TGT, decreaseAmount: 5, increaseAmount: 5, period, reason: '混配测试' },
        scope, ctx,
      ),
    ).rejects.toThrow('源科目与目标科目的值类型必须一致')
  })
})
