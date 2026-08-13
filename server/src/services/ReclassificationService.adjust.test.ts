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
 * - 年度预算全年模式：period 传 YYYY 按财年整体调整，历史 YYYY-MM 口径兼容。
 * afterAll 硬删除；无 DB 或 data 类叶子科目不足时跳过。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const CA = `ADJA${suffix}`.slice(0, 20)
const CB = `ADJB${suffix}`.slice(0, 20)
const batchId = `batchadj_${suffix}`
const budgetBatchId = `batchbud_${suffix}`
const period = '2096-05'
const userId = `adj-test-${suffix}`
let SRC = ''
let TGT = ''
let TGT2 = ''
// 分型测试专用科目（beforeAll 创建，afterAll 删除）
const QTY_SRC = `QTYA${suffix}`.toUpperCase()
const QTY_TGT = `QTYB${suffix}`.toUpperCase()
const RATIO_SUBJ = `RATIO${suffix}`.toUpperCase()
// 计算类/展示类科目（metric.dataType calc/display 与科目同编码，不可直接调整）
const CALC_SUBJ = `CALCA${suffix}`.toUpperCase()
const DISPLAY_SUBJ = `DSPA${suffix}`.toUpperCase()

const scope = { companyCode: null, scopeValue: null, dataScopeCodes: [CA, CB] }
const ctx = { userId }

const value = async (companyCode: string, accountCode: string): Promise<number> => {
  const rows = await basePrisma.factOperating.findMany({ where: { batchId, companyCode, accountCode } })
  return rows.reduce((s, r) => s + Number(r.value), 0)
}

const budgetValue = async (companyCode: string, accountCode: string): Promise<number> => {
  const rows = await basePrisma.factBudget.findMany({ where: { batchId: budgetBatchId, companyCode, accountCode } })
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
        { code: CALC_SUBJ, name: `计算类${suffix}`, subjectType: 'operating', level: 1, category: '测试', direction: 'debit', valueType: 'amount', isLeaf: true },
        { code: DISPLAY_SUBJ, name: `展示类${suffix}`, subjectType: 'operating', level: 1, category: '测试', direction: 'debit', valueType: 'amount', isLeaf: true },
      ],
    })
    // 计算类/展示类指标（与科目同编码，dataType 驱动调整模块过滤）
    await basePrisma.metric.createMany({
      data: [
        { code: CALC_SUBJ, name: `计算类${suffix}`, category: '测试', dataType: 'calc', formula: `${QTY_SRC}+0` },
        { code: DISPLAY_SUBJ, name: `展示类${suffix}`, category: '测试', dataType: 'display' },
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
    // 年度预算：独立 active budget 批次 + factBudget 行（period 传全年 YYYY 按财年整体匹配）
    await basePrisma.importBatch.create({
      data: { id: budgetBatchId, fileName: 'budget-test.xlsx', status: 'success', dataType: 'budget', lifecycleStatus: 'active', fiscalYear: 'FY2096' },
    })
    await basePrisma.factBudget.createMany({
      data: [
        { batchId: budgetBatchId, companyCode: CA, accountCode: SRC, fiscalYear: 'FY2096', period: '2096-01', value: 200 },
        { batchId: budgetBatchId, companyCode: CA, accountCode: TGT, fiscalYear: 'FY2096', period: '2096-01', value: 60 },
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
  await basePrisma.factBudget.deleteMany({ where: { batchId: budgetBatchId } }).catch(() => undefined)
  await basePrisma.importBatch.delete({ where: { id: budgetBatchId } }).catch(() => undefined)
  await basePrisma.company.deleteMany({ where: { code: { in: [CA, CB] } } }).catch(() => undefined)
  await basePrisma.metric.deleteMany({ where: { code: { in: [CALC_SUBJ, DISPLAY_SUBJ] } } }).catch(() => undefined)
  await basePrisma.accountSubject.deleteMany({ where: { code: { in: [QTY_SRC, QTY_TGT, RATIO_SUBJ, CALC_SUBJ, DISPLAY_SUBJ] } } }).catch(() => undefined)
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

  it('计算类/展示类科目拒绝金额调整（metric.dataType 校验）', async () => {
    if (!dbReady) return
    await expect(
      ReclassificationService.adjustSubject(
        { templateType: 'operating', companyCode: CA, adjustMode: 'decrease', sourceAccountCode: CALC_SUBJ, decreaseAmount: 1, period, reason: '计算类测试' },
        scope, ctx,
      ),
    ).rejects.toThrow('计算类/展示类科目不支持金额调整')
    await expect(
      ReclassificationService.adjustSubject(
        { templateType: 'operating', companyCode: CA, adjustMode: 'decrease', sourceAccountCode: DISPLAY_SUBJ, decreaseAmount: 1, period, reason: '展示类测试' },
        scope, ctx,
      ),
    ).rejects.toThrow('计算类/展示类科目不支持金额调整')
  })

  it('跨公司重分类预览与执行均拒绝计算类科目（accountCodes 校验）', async () => {
    if (!dbReady) return
    const p: ReclassificationService.ReclassifyCompanyParams = {
      templateType: 'operating', sourceCompanyCode: CA, targetCompanyCode: CB, accountCodes: [CALC_SUBJ], period, transferMode: 'all',
    }
    await expect(ReclassificationService.previewCompany(p, scope)).rejects.toThrow('以下科目不可重分类（比率/计算/展示类）')
    await expect(ReclassificationService.reclassifyCompany(p, scope, ctx)).rejects.toThrow('以下科目不可重分类（比率/计算/展示类）')
  })
})

describe('adjustSubject 年度预算全年模式（真实 DB）', () => {
  it('全年 YYYY：预览按财年整体匹配，both 调整不涉及月份维度', async () => {
    if (!dbReady) return
    const preview = await ReclassificationService.previewAdjustSubject(
      { templateType: 'budget', companyCode: CA, adjustMode: 'both', sourceAccountCode: SRC, targetAccountCode: TGT, decreaseAmount: 30, increaseAmount: 30, period: '2096' },
      scope,
    )
    expect(preview.affectedRows).toBe(1)
    expect(preview.sourceTotal).toBe(200)
    const res = await ReclassificationService.adjustSubject(
      { templateType: 'budget', companyCode: CA, adjustMode: 'both', sourceAccountCode: SRC, targetAccountCode: TGT, decreaseAmount: 30, increaseAmount: 30, period: '2096', reason: '全年预算重分类' },
      scope, ctx,
    )
    expect(res.decreaseAmount).toBe(30)
    expect(res.increaseAmount).toBe(30)
    expect(await budgetValue(CA, SRC)).toBe(170)
    expect(await budgetValue(CA, TGT)).toBe(90)
    const log = await latestLog()
    expect(log?.templateType).toBe('budget')
    expect(log?.period).toBe('2096')
  })

  it('历史月度口径 YYYY-MM 仍兼容（按期间所属财年匹配）', async () => {
    if (!dbReady) return
    const res = await ReclassificationService.adjustSubject(
      { templateType: 'budget', companyCode: CA, adjustMode: 'decrease', sourceAccountCode: SRC, decreaseAmount: 10, period: '2096-05', reason: '历史口径预算调减' },
      scope, ctx,
    )
    expect(res.decreaseAmount).toBe(10)
    expect(await budgetValue(CA, SRC)).toBe(160) // 170 - 10
  })

  it('非法财年格式拒绝，错误提示明确', async () => {
    if (!dbReady) return
    await expect(
      ReclassificationService.adjustSubject(
        { templateType: 'budget', companyCode: CA, adjustMode: 'decrease', sourceAccountCode: SRC, decreaseAmount: 5, period: '2096-13', reason: '非法财年' },
        scope, ctx,
      ),
    ).rejects.toThrow('请选择调整财年（YYYY）')
  })
})
