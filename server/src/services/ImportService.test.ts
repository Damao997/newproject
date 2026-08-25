import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as XLSX from 'xlsx'
import { basePrisma } from '../lib/prisma'
import { CASHFLOW_DIMS, OPERATING_DIMS } from '../lib/metric-values'
import { ImportService } from './ImportService'
import { TransactionService } from './TransactionService'

/** 用 aoa 构造 xlsx Buffer */
function makeXlsx(aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/**
 * 导入服务集成测试（真实 DB）。
 * 覆盖：getById 透出解析错误明细(errors)与 rowCount；list 仅带汇总计数不带 errors。
 * afterAll 硬删除创建的批次；无 DB 时整组跳过。
 */

let dbReady = false
let batchId = ''

const errorsFixture = [
  { row: 3, column: 'A', message: "科目名未匹配：'其他'" },
  { row: 5, column: 'C', message: "值非数字：'abc'" },
]

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const created = await basePrisma.importBatch.create({
      data: {
        fileName: '__test_import_quality__.xlsx',
        status: 'partial',
        dataType: 'operating',
        lifecycleStatus: 'draft',
        sourceType: 'upload',
        fiscalYear: 'FY2098',
        rowCount: 10,
        errorCount: errorsFixture.length,
        errorsJson: errorsFixture as never,
      },
    })
    batchId = created.id
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady || !batchId) return
  await basePrisma.importBatch.delete({ where: { id: batchId } }).catch(() => undefined)
})

describe('ImportService（真实 DB）', () => {
  it('getById 返回 rowCount 与解析错误明细 errors', async () => {
    if (!dbReady) return
    const dto = await ImportService.getById(batchId)
    expect(dto.rowCount).toBe(10)
    expect(dto.errorCount).toBe(errorsFixture.length)
    expect(dto.successCount).toBe(10 - errorsFixture.length)
    expect(Array.isArray(dto.errors)).toBe(true)
    expect(dto.errors).toHaveLength(errorsFixture.length)
    expect(dto.errors?.[0]).toMatchObject({ row: 3, column: 'A' })
  })

  it('list 返回 rowCount 汇总但不带 errors 明细（控制体积）', async () => {
    if (!dbReady) return
    const page = await ImportService.list({ page: 1, pageSize: 50, templateType: 'operating' })
    const found = page.items.find((b) => b.id === batchId)
    expect(found).toBeTruthy()
    expect(found?.rowCount).toBe(10)
    expect(found?.errors).toBeUndefined()
  })

  it('preview 非法文件抛错（magic 校验，不依赖 DB）', async () => {
    await expect(ImportService.preview({ buffer: Buffer.from('not-a-xlsx-file') }, 'operating')).rejects.toBeTruthy()
  })

  it('preview 合法 xlsx 返回数据行数与新增字段结构且不写库', async () => {
    if (!dbReady) return
    const buf = makeXlsx([
      ['单体维度', '示例公司', '示例公司'],
      ['月份', new Date(2026, 2, 31), new Date(2025, 2, 31)],
      ['某科目A', 100, 80],
      ['某科目B', 50, 40],
    ])
    const before = await basePrisma.factOperating.count()
    const res = await ImportService.preview({ buffer: buf }, 'operating')
    const after = await basePrisma.factOperating.count()
    expect(res.dataRowCount).toBe(2)
    expect(Array.isArray(res.errors)).toBe(true)
    expect(after).toBe(before) // 不写库
    // 新增字段结构：覆盖摘要 + 激活影响 + KPI 覆盖（公司/科目未匹配 → 摘要为零值）
    expect(res.summary).toMatchObject({ companyCount: 0, subjectCount: 0, duplicateCount: 0 })
    expect(res.summary).not.toHaveProperty('periods') // 内部字段不对外透出
    expect(res.summary).not.toHaveProperty('accountCodes')
    expect(res.activationImpact === null || typeof res.activationImpact === 'object').toBe(true)
    expect(res.kpiCoverage).toBeTruthy()
    expect([...res.kpiCoverage!.covered, ...res.kpiCoverage!.missing].sort()).toEqual(['壹品慧成本', '壹品慧收入', '壹品慧毛利', '壹品慧费用'].sort())
  })
})

describe('preview 激活影响预告与 KPI 覆盖（真实 DB）', () => {
  let company: { code: string; name: string } | null = null
  let subject: { code: string; name: string } | null = null
  let impactBatchId = ''
  // 测试专用远期期间，避免与开发库真实数据碰撞
  const P_VANISH = '2098-01'
  const P_OVERLAP = '2098-02'
  const P_NEW = '2098-03'

  beforeAll(async () => {
    if (!dbReady) return
    company = await basePrisma.company.findFirst({ where: { entityType: 'single', status: 'active' }, select: { code: true, name: true } })
    subject = await basePrisma.accountSubject.findFirst({ where: { subjectType: 'operating', isLeaf: true, status: 'active' }, select: { code: true, name: true } })
    if (!company || !subject) return
    const b = await basePrisma.importBatch.create({
      data: { fileName: '__test_impact_active__.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'active', sourceType: 'upload', fiscalYear: 'FY2098' },
    })
    impactBatchId = b.id
    await basePrisma.factOperating.createMany({
      data: [P_VANISH, P_OVERLAP].map((p) => ({
        batchId: impactBatchId, companyCode: company!.code, accountCode: subject!.code,
        period: p, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2098', value: 1,
      })),
    })
  })

  afterAll(async () => {
    if (!impactBatchId) return
    await basePrisma.factOperating.deleteMany({ where: { batchId: impactBatchId } }).catch(() => undefined)
    await basePrisma.importBatch.delete({ where: { id: impactBatchId } }).catch(() => undefined)
  })

  it('activationImpact 返回 新增/重叠/保留 三类期间集合', async () => {
    if (!dbReady || !company || !subject || !impactBatchId) return
    // 文件包含 2098-02（重叠）与 2098-03（新增）；active 批次含 2098-01（按期间合并下将保留）
    const buf = makeXlsx([
      ['单体维度', company.name, company.name],
      ['月份', new Date(2098, 1, 15), new Date(2098, 2, 15)],
      [subject.name, 10, 20],
    ])
    const res = await ImportService.preview({ buffer: buf }, 'operating')
    expect(res.summary.companyCount).toBe(1)
    const impact = res.activationImpact
    expect(impact?.activeBatch).toBeTruthy()
    expect(impact!.overlappingPeriods).toContain(P_OVERLAP)
    expect(impact!.retainedPeriods).toContain(P_VANISH)
    expect(impact!.newPeriods).toContain(P_NEW)
    expect(impact!.retainedPeriods).not.toContain(P_OVERLAP)
    expect(impact!.newPeriods).not.toContain(P_OVERLAP)
  })

  it('kpiCoverage 覆盖文件科目上溯到的根类别', async () => {
    if (!dbReady || !company || !subject) return
    const buf = makeXlsx([
      ['单体维度', company.name],
      ['月份', new Date(2098, 1, 15)],
      [subject.name, 10],
    ])
    const res = await ImportService.preview({ buffer: buf }, 'operating')
    const kc = res.kpiCoverage!
    expect(kc).toBeTruthy()
    expect([...kc.covered, ...kc.missing].sort()).toEqual(['壹品慧成本', '壹品慧收入', '壹品慧毛利', '壹品慧费用'].sort())
    // 在测试内同样沿 parentCode 上溯，计算该科目的根类别作为期望
    const all = await basePrisma.accountSubject.findMany({ where: { subjectType: 'operating' }, select: { code: true, parentCode: true, category: true } })
    const byCode = new Map(all.map((s) => [s.code, s]))
    let cur = byCode.get(subject.code)
    while (cur?.parentCode && byCode.has(cur.parentCode)) cur = byCode.get(cur.parentCode)
    const rootCategory = cur?.category
    if (rootCategory && ['壹品慧收入', '壹品慧成本', '壹品慧毛利', '壹品慧费用'].includes(rootCategory)) {
      expect(kc.covered).toContain(rootCategory)
    }
  })
})

describe('activate 按期间合并（真实 DB）', () => {
  const P1 = '2097-01'
  const P2 = '2097-02'
  const P3 = '2097-03'
  const COMP = '__TEST_PM_COMP__'
  const ACC = '__TEST_PM_ACC__'
  const createdBatchIds: string[] = []

  const makeBatch = async (fileName: string, lifecycleStatus: 'draft' | 'active', periods: string[]) => {
    const b = await basePrisma.importBatch.create({
      data: { fileName, status: 'success', dataType: 'operating', lifecycleStatus, sourceType: 'upload', fiscalYear: 'FY2096' },
    })
    createdBatchIds.push(b.id)
    if (periods.length > 0) {
      await basePrisma.factOperating.createMany({
        data: periods.map((p) => ({
          batchId: b.id, companyCode: COMP, accountCode: ACC,
          period: p, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2096', value: 1,
        })),
      })
    }
    return b
  }

  afterAll(async () => {
    if (createdBatchIds.length === 0) return
    await basePrisma.factOperating.deleteMany({ where: { batchId: { in: createdBatchIds } } }).catch(() => undefined)
    await basePrisma.importBatch.deleteMany({ where: { id: { in: createdBatchIds } } }).catch(() => undefined)
  })

  it('重叠期间被替换、非重叠保留；旧批次清空后自动归档', async () => {
    if (!dbReady) return
    // 注意：测试会临时影响同 dataType 的现有 active 批次（测试期间与真实数据不重叠，不会删除真实事实行）
    const a = await makeBatch('__test_pm_A__.xlsx', 'active', [P1, P2])
    const b = await makeBatch('__test_pm_B__.xlsx', 'draft', [P2, P3])

    await ImportService.activate(b.id, 'test-user', 'trace')

    // A 的重叠期间 P2 行被删除，P1 保留；A 仍 active（未清空）；B active
    const aRows = await basePrisma.factOperating.findMany({ where: { batchId: a.id }, select: { period: true } })
    expect(aRows.map((r) => r.period)).toEqual([P1])
    const aBatch = await basePrisma.importBatch.findUnique({ where: { id: a.id } })
    expect(aBatch?.lifecycleStatus).toBe('active')
    const bBatch = await basePrisma.importBatch.findUnique({ where: { id: b.id } })
    expect(bBatch?.lifecycleStatus).toBe('active')

    // 再激活覆盖 P1 的批次 C：A 清空后自动归档，B 仍 active
    const c = await makeBatch('__test_pm_C__.xlsx', 'draft', [P1])
    await ImportService.activate(c.id, 'test-user', 'trace')
    const aBatch2 = await basePrisma.importBatch.findUnique({ where: { id: a.id } })
    expect(aBatch2?.lifecycleStatus).toBe('archived')
    expect(await basePrisma.factOperating.count({ where: { batchId: a.id } })).toBe(0)
    const bBatch2 = await basePrisma.importBatch.findUnique({ where: { id: b.id } })
    expect(bBatch2?.lifecycleStatus).toBe('active')

    // 多 active 批次共存：可用期间包含 P1/P2/P3（B 提供 P2/P3，C 提供 P1）
    const activeBatches = await basePrisma.importBatch.findMany({ where: { dataType: 'operating', lifecycleStatus: 'active', id: { in: createdBatchIds } }, select: { id: true } })
    const periods = await basePrisma.factOperating.findMany({ where: { batchId: { in: activeBatches.map((x) => x.id) } }, distinct: ['period'], select: { period: true } })
    expect(periods.map((r) => r.period).sort()).toEqual([P1, P2, P3])
  })
})

describe('checkBatchActivateConflicts 批量激活预检（真实 DB）', () => {
  // 独立测试公司与远期期间，避免与并行测试及真实数据干扰
  const CO = 'EN999905'
  const CO_NAME = '__预检测试公司__'
  const P_ACT = '2099-07'
  const P_NEW = '2099-08'
  const P_OTHER = '2099-09'
  const TYPE_AR = '应收账款'
  const TYPE_AP = '应付账款'
  let activeBatchId = ''
  let draftOverlapId = ''
  let draftNewId = ''
  let draftSharedId = ''
  let draftArchivedId = ''
  const cleanupDetailIds: string[] = []

  const seedDetail = async (batchId: string, period: string, transactionType: string) => {
    const row = await basePrisma.transactionDetail.create({
      data: {
        batchId, companyCode: CO, companyName: CO_NAME, transactionType,
        direction: transactionType === TYPE_AR ? 'AR' : 'AP',
        counterpartyCode: '__CHK_CP__', accountCode: '__CHK_ACC__', closingBalance: 100, period,
      },
    })
    cleanupDetailIds.push(row.id)
  }

  const makeTxnBatch = (fileName: string, lifecycleStatus: 'draft' | 'active' | 'archived') =>
    basePrisma.importBatch.create({
      data: { fileName, status: 'success', dataType: 'transaction', lifecycleStatus, sourceType: 'upload' },
    })

  beforeAll(async () => {
    if (!dbReady) return
    await basePrisma.company.upsert({
      where: { code: CO },
      update: { name: CO_NAME, entityType: 'single', status: 'active' },
      create: { code: CO, name: CO_NAME, entityType: 'single', status: 'active' },
    })
    const activeBatch = await makeTxnBatch('__chk_active__.xls', 'active')
    const draftOverlap = await makeTxnBatch('__chk_draft_overlap__.xls', 'draft')
    const draftNew = await makeTxnBatch('__chk_draft_new__.xls', 'draft')
    const draftShared = await makeTxnBatch('__chk_draft_shared__.xls', 'draft')
    const draftArchived = await makeTxnBatch('__chk_draft_archived__.xls', 'archived')
    activeBatchId = activeBatch.id
    draftOverlapId = draftOverlap.id
    draftNewId = draftNew.id
    draftSharedId = draftShared.id
    draftArchivedId = draftArchived.id
    // active：P_ACT 应收账款 × 2 条（重叠计数应 2）
    await seedDetail(activeBatchId, P_ACT, TYPE_AR)
    await seedDetail(activeBatchId, P_ACT, TYPE_AR)
    // draftOverlap：与 active 重叠（P_ACT 应收账款）+ 新组合（P_NEW 应付账款）
    await seedDetail(draftOverlapId, P_ACT, TYPE_AR)
    await seedDetail(draftOverlapId, P_NEW, TYPE_AP)
    // draftShared：与 draftOverlap 共享三元组（P_ACT 应收账款），用于批次间重叠
    await seedDetail(draftSharedId, P_ACT, TYPE_AR)
    // draftNew：全新组合
    await seedDetail(draftNewId, P_OTHER, TYPE_AP)
  })

  afterAll(async () => {
    if (!dbReady) return
    await basePrisma.transactionDetail.deleteMany({ where: { id: { in: cleanupDetailIds } } }).catch(() => undefined)
    await basePrisma.importBatch.deleteMany({ where: { id: { in: [activeBatchId, draftOverlapId, draftNewId, draftSharedId, draftArchivedId] } } }).catch(() => undefined)
    await basePrisma.company.delete({ where: { code: CO } }).catch(() => undefined)
  })

  it('transaction 草稿批次与已生效数据重叠时 conflicts 含现有笔数', async () => {
    if (!dbReady) return
    const [r] = await ImportService.checkBatchActivateConflicts([draftOverlapId])
    expect(r.status).toBe('draft')
    expect(r.conflictCount).toBe(1)
    expect(r.conflicts[0]).toMatchObject({ companyCode: CO, period: P_ACT, transactionType: TYPE_AR, existingCount: 2 })
    expect(r.crossBatchConflictCount).toBe(0)
  })

  it('无重叠批次 conflictCount 为 0', async () => {
    if (!dbReady) return
    const [r] = await ImportService.checkBatchActivateConflicts([draftNewId])
    expect(r.status).toBe('draft')
    expect(r.conflictCount).toBe(0)
    expect(r.conflicts).toEqual([])
  })

  it('非 draft 批次返回其状态且不计算冲突；不存在批次 status 为空', async () => {
    if (!dbReady) return
    const [r] = await ImportService.checkBatchActivateConflicts([draftArchivedId])
    expect(r.status).toBe('archived')
    expect(r.conflictCount).toBe(0)
    const [missing] = await ImportService.checkBatchActivateConflicts(['__no_such_batch_id__'])
    expect(missing.status).toBe('')
    expect(missing.filename).toBe('')
  })

  it('选中批次间三元组重叠计入 crossBatchConflictCount（重复 id 去重不计）', async () => {
    if (!dbReady) return
    const results = await ImportService.checkBatchActivateConflicts([draftOverlapId, draftSharedId])
    const overlap = results.find((r) => r.id === draftOverlapId)!
    const shared = results.find((r) => r.id === draftSharedId)!
    expect(overlap.crossBatchConflictCount).toBe(1)
    expect(shared.crossBatchConflictCount).toBe(1)
    // 同一 id 重复提交被去重，不产生批次间冲突
    const dup = await ImportService.checkBatchActivateConflicts([draftOverlapId, draftOverlapId])
    expect(dup).toHaveLength(1)
    expect(dup[0].crossBatchConflictCount).toBe(0)
  })
})

describe('空模板批次激活后 empty 状态保持（真实 DB）', () => {
  // 独立测试公司与期间，避开并行测试干扰
  const CO = 'EN999906'
  const CO_NAME = '__空模板测试公司__'
  const P = '2099-09'
  const TYPE_EMPTY = '预收账款'
  const TYPE_NEW = '应付账款'
  let emptyBatchId = ''
  let newBatchId = ''
  let coverBatchId = ''
  const cleanupDetailIds: string[] = []

  const seedDetail = async (batchId: string, period: string, transactionType: string) => {
    const row = await basePrisma.transactionDetail.create({
      data: {
        batchId, companyCode: CO, companyName: CO_NAME, transactionType,
        direction: transactionType === '应收账款' || transactionType === '预收账款' ? 'AR' : 'AP',
        counterpartyCode: '__EMPTY_CP__', accountCode: '__EMPTY_ACC__', closingBalance: 100, period,
      },
    })
    cleanupDetailIds.push(row.id)
  }

  const makeBatch = (fileName: string, coverage: unknown[] = []) =>
    basePrisma.importBatch.create({
      data: { fileName, status: 'success', dataType: 'transaction', lifecycleStatus: 'draft', sourceType: 'upload', coverageJson: coverage as never },
    })

  beforeAll(async () => {
    if (!dbReady) return
    await basePrisma.company.upsert({
      where: { code: CO },
      update: { name: CO_NAME, entityType: 'single', status: 'active' },
      create: { code: CO, name: CO_NAME, entityType: 'single', status: 'active' },
    })
    // 空模板批次：仅申报"该期确无往来款"，无明细
    const eb = await makeBatch('__empty_template__.xls', [{ companyCode: CO, period: P, transactionType: TYPE_EMPTY, recordCount: 0 }])
    emptyBatchId = eb.id
    await ImportService.activate(eb.id, 'test-user', 'trace')
    // 新批次：其他类型明细（不覆盖空模板申报）
    const nb = await makeBatch('__empty_new__.xls')
    newBatchId = nb.id
    await seedDetail(newBatchId, P, TYPE_NEW)
    // 覆盖批次：申报与空模板相同三元组（验证被覆盖后归档且 empty 由新申报承接）
    const cb = await makeBatch('__empty_cover__.xls', [{ companyCode: CO, period: P, transactionType: TYPE_EMPTY, recordCount: 0 }])
    coverBatchId = cb.id
  })

  afterAll(async () => {
    if (!dbReady) return
    await basePrisma.transactionDetail.deleteMany({ where: { id: { in: cleanupDetailIds } } }).catch(() => undefined)
    await basePrisma.importBatch.deleteMany({ where: { id: { in: [emptyBatchId, newBatchId, coverBatchId] } } }).catch(() => undefined)
    await basePrisma.company.delete({ where: { code: CO } }).catch(() => undefined)
  })

  it('激活不重叠的新批次后，空模板批次保持 active，申报单元格仍为 empty', async () => {
    if (!dbReady) return
    await ImportService.activate(newBatchId, 'test-user', 'trace')
    const eb = await basePrisma.importBatch.findUnique({ where: { id: emptyBatchId } })
    expect(eb?.lifecycleStatus).toBe('active')
    const cov = await TransactionService.getImportCoverage({ months: 3, companyCodes: [CO] })
    const cell = cov.cells.find((c) => c.companyCode === CO && c.period === P && c.transactionType === TYPE_EMPTY)
    expect(cell?.status).toBe('empty')
  })

  it('新批次覆盖空模板申报三元组时归档，empty 状态由新批次申报承接', async () => {
    if (!dbReady) return
    await ImportService.activate(coverBatchId, 'test-user', 'trace')
    const eb = await basePrisma.importBatch.findUnique({ where: { id: emptyBatchId } })
    expect(eb?.lifecycleStatus).toBe('archived')
    const cov = await TransactionService.getImportCoverage({ months: 3, companyCodes: [CO] })
    const cell = cov.cells.find((c) => c.companyCode === CO && c.period === P && c.transactionType === TYPE_EMPTY)
    expect(cell?.status).toBe('empty')
  })
})

describe('批次快照备份与回滚（真实 DB）', () => {
  // 独立测试公司与远期期间，避免与并行测试及真实数据干扰
  const COMP = '__TEST_RB_COMP__'
  const COMP2 = '__TEST_RB_COMP2__'
  const ACC = '__TEST_RB_ACC__'
  const ACC2 = '__TEST_RB_ACC2__'
  const P1 = '2096-04'
  const P2 = '2096-05'
  const P3 = '2096-06'
  const createdBatchIds: string[] = []
  const createdSnapshotIds: string[] = []

  const makeOpBatch = async (fileName: string, lifecycleStatus: 'draft' | 'active' | 'archived', rows: { companyCode: string; accountCode: string; period: string; value: number }[]) => {
    const b = await basePrisma.importBatch.create({
      data: { fileName, status: 'success', dataType: 'operating', lifecycleStatus, sourceType: 'upload', fiscalYear: 'FY2096' },
    })
    createdBatchIds.push(b.id)
    if (rows.length > 0) {
      await basePrisma.factOperating.createMany({
        data: rows.map((r) => ({
          batchId: b.id, companyCode: r.companyCode, accountCode: r.accountCode,
          period: r.period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2096', value: r.value,
        })),
      })
    }
    return b
  }

  const snapshotRowsOf = async (batchId: string) => basePrisma.factSnapshot.findMany({ where: { batchId } })

  afterAll(async () => {
    if (createdBatchIds.length === 0) return
    await basePrisma.factSnapshot.deleteMany({ where: { id: { in: createdSnapshotIds } } }).catch(() => undefined)
    await basePrisma.factOperating.deleteMany({ where: { batchId: { in: createdBatchIds } } }).catch(() => undefined)
    await basePrisma.importBatch.deleteMany({ where: { id: { in: createdBatchIds } } }).catch(() => undefined)
  })

  it('激活覆盖时被删行备份到 fact_snapshot（archivedByBatchId 追溯）', async () => {
    if (!dbReady) return
    const a = await makeOpBatch('__test_rb_A__.xlsx', 'active', [
      { companyCode: COMP, accountCode: ACC, period: P1, value: 100 },
      { companyCode: COMP, accountCode: ACC, period: P2, value: 200 },
    ])
    const b = await makeOpBatch('__test_rb_B__.xlsx', 'draft', [
      { companyCode: COMP, accountCode: ACC, period: P2, value: 999 },
      { companyCode: COMP, accountCode: ACC, period: P3, value: 300 },
    ])
    await ImportService.activate(b.id, 'test-user', 'trace')

    // A 的重叠期间 P2 行被删除并备份，P1 保留
    const aRows = await basePrisma.factOperating.findMany({ where: { batchId: a.id }, select: { period: true, value: true } })
    expect(aRows.map((r) => r.period)).toEqual([P1])
    const snaps = await snapshotRowsOf(a.id)
    createdSnapshotIds.push(...snaps.map((s) => s.id))
    expect(snaps).toHaveLength(1)
    expect(snaps[0]).toMatchObject({
      template: 'operating',
      companyCode: COMP,
      accountCode: ACC,
      period: P2,
      periodDimCode: OPERATING_DIMS.ACTUAL_MONTH,
      archivedByBatchId: b.id,
    })
    expect(Number(snaps[0].value)).toBe(200)
  })

  it('rollbackBatch 恢复快照行并重新激活，重叠期间被当前 active 覆盖且自动备份', async () => {
    if (!dbReady) return
    const a = await makeOpBatch('__test_rb_A2__.xlsx', 'active', [
      { companyCode: COMP2, accountCode: ACC2, period: P1, value: 100 },
      { companyCode: COMP2, accountCode: ACC2, period: P2, value: 200 },
    ])
    const b = await makeOpBatch('__test_rb_B2__.xlsx', 'draft', [
      { companyCode: COMP2, accountCode: ACC2, period: P2, value: 999 },
      { companyCode: COMP2, accountCode: ACC2, period: P3, value: 300 },
    ])
    await ImportService.activate(b.id, 'test-user', 'trace')
    const before = await snapshotRowsOf(a.id)
    createdSnapshotIds.push(...before.map((s) => s.id))

    // 回滚到 A：A 的 P2 恢复为 200，B 的 P2 被删除并备份（batchId=B），B 剩余 P3 保持 active
    const dto = await ImportService.rollbackBatch(a.id, 'test-user', 'trace')
    expect(dto.status).toBe('active')
    const aRows = await basePrisma.factOperating.findMany({ where: { batchId: a.id }, select: { period: true, value: true } })
    expect(aRows.map((r) => [r.period, Number(r.value)]).sort()).toEqual([[P1, 100], [P2, 200]].sort())
    const bRows = await basePrisma.factOperating.findMany({ where: { batchId: b.id }, select: { period: true, value: true } })
    expect(bRows.map((r) => [r.period, Number(r.value)])).toEqual([[P3, 300]])
    const bSnaps = await snapshotRowsOf(b.id)
    createdSnapshotIds.push(...bSnaps.map((s) => s.id))
    expect(bSnaps).toHaveLength(1)
    expect(bSnaps[0]).toMatchObject({ archivedByBatchId: a.id, period: P2 })
    // A 的快照已清理（下次覆盖会重新备份）
    expect(await snapshotRowsOf(a.id)).toHaveLength(0)
  })

  it('重复覆盖-回滚循环对称：A→B→A→B 值始终正确', async () => {
    if (!dbReady) return
    const a = await makeOpBatch('__test_rb_A3__.xlsx', 'active', [
      { companyCode: COMP2, accountCode: ACC2, period: P1, value: 100 },
      { companyCode: COMP2, accountCode: ACC2, period: P2, value: 200 },
    ])
    const b = await makeOpBatch('__test_rb_B3__.xlsx', 'draft', [
      { companyCode: COMP2, accountCode: ACC2, period: P2, value: 999 },
      { companyCode: COMP2, accountCode: ACC2, period: P3, value: 300 },
    ])
    await ImportService.activate(b.id, 'test-user', 'trace')
    await ImportService.rollbackBatch(a.id, 'test-user', 'trace')
    await ImportService.rollbackBatch(b.id, 'test-user', 'trace')

    // 两次轮回后 B 持有 P2=999、P3=300，A 持有 P1=100
    const aRows = await basePrisma.factOperating.findMany({ where: { batchId: a.id }, select: { period: true, value: true } })
    expect(aRows.map((r) => [r.period, Number(r.value)])).toEqual([[P1, 100]])
    const bRows = await basePrisma.factOperating.findMany({ where: { batchId: b.id }, select: { period: true, value: true } })
    expect(bRows.map((r) => [r.period, Number(r.value)]).sort()).toEqual([[P2, 999], [P3, 300]].sort())
    // B 的 P2 恢复后，A 的 P2 再次被覆盖时快照重新生成（batchId=A）
    const snaps = await snapshotRowsOf(a.id)
    createdSnapshotIds.push(...snaps.map((s) => s.id))
    expect(snaps.some((s) => s.period === P2 && Number(s.value) === 200)).toBe(true)
  })

  it('budget 批次回滚：数据未删可直接重新激活（无快照也成功）', async () => {
    if (!dbReady) return
    const fy = 'FY2093'
    const mk = async (fileName: string, lifecycleStatus: 'active' | 'draft') => {
      const b = await basePrisma.importBatch.create({
        data: { fileName, status: 'success', dataType: 'budget', lifecycleStatus, sourceType: 'upload', fiscalYear: fy },
      })
      createdBatchIds.push(b.id)
      await basePrisma.factBudget.createMany({
        data: [{ batchId: b.id, companyCode: COMP, accountCode: ACC, fiscalYear: fy, period: '2026-04', value: 111 }],
      })
      return b
    }
    const a = await mk('__test_rb_BUD_A__.xlsx', 'active')
    const b = await mk('__test_rb_BUD_B__.xlsx', 'draft')
    await ImportService.activate(b.id, 'test-user', 'trace')
    expect((await basePrisma.importBatch.findUnique({ where: { id: a.id } }))?.lifecycleStatus).toBe('archived')
    expect(await snapshotRowsOf(a.id)).toHaveLength(0) // budget 从不备份

    const dto = await ImportService.rollbackBatch(a.id, 'test-user', 'trace')
    expect(dto.status).toBe('active')
    expect((await basePrisma.importBatch.findUnique({ where: { id: b.id } }))?.lifecycleStatus).toBe('archived')
    const rows = await basePrisma.factBudget.findMany({ where: { batchId: a.id } })
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].value)).toBe(111)
  })

  it('transaction 回滚被拒绝；purged 批次回滚被拒绝', async () => {
    if (!dbReady) return
    const t = await basePrisma.importBatch.create({
      data: { fileName: '__test_rb_TXN__.xls', status: 'success', dataType: 'transaction', lifecycleStatus: 'archived', sourceType: 'upload' },
    })
    createdBatchIds.push(t.id)
    await expect(ImportService.rollbackBatch(t.id, 'test-user', 'trace')).rejects.toMatchObject({ message: expect.stringContaining('暂不支持回滚') })

    const p = await basePrisma.importBatch.create({
      data: { fileName: '__test_rb_PURGED__.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'purged', sourceType: 'upload', fiscalYear: 'FY2096' },
    })
    createdBatchIds.push(p.id)
    await expect(ImportService.rollbackBatch(p.id, 'test-user', 'trace')).rejects.toMatchObject({ message: expect.stringContaining('不可回滚') })
  })

  it('无快照且无事实行的 archived 批次回滚被拒绝（数据不可恢复）', async () => {
    if (!dbReady) return
    const x = await basePrisma.importBatch.create({
      data: { fileName: '__test_rb_LOST__.xlsx', status: 'success', dataType: 'operating', lifecycleStatus: 'archived', sourceType: 'upload', fiscalYear: 'FY2096' },
    })
    createdBatchIds.push(x.id)
    await expect(ImportService.rollbackBatch(x.id, 'test-user', 'trace')).rejects.toMatchObject({ message: expect.stringContaining('不可恢复') })
  })
})

describe('cashflow 激活按期间合并与回滚（真实 DB）', () => {
  // 独立测试公司与远期期间，避免与并行测试及真实数据干扰
  const COMP = '__TEST_CF_COMP__'
  const ACC = '__TEST_CF_ACC__'
  const P1 = '2096-01'
  const P2 = '2096-02'
  const P3 = '2096-03'
  const createdBatchIds: string[] = []

  const makeCfBatch = async (fileName: string, lifecycleStatus: 'draft' | 'active', periods: { period: string; value: number }[]) => {
    const b = await basePrisma.importBatch.create({
      data: { fileName, status: 'success', dataType: 'cashflow', lifecycleStatus, sourceType: 'upload', fiscalYear: 'FY2095' },
    })
    createdBatchIds.push(b.id)
    if (periods.length > 0) {
      await basePrisma.factOperating.createMany({
        data: periods.map((p) => ({
          batchId: b.id, companyCode: COMP, accountCode: ACC,
          period: p.period, periodDimCode: CASHFLOW_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2095', value: p.value,
        })),
      })
    }
    return b
  }

  afterAll(async () => {
    if (createdBatchIds.length === 0) return
    await basePrisma.factSnapshot.deleteMany({ where: { batchId: { in: createdBatchIds } } }).catch(() => undefined)
    await basePrisma.factOperating.deleteMany({ where: { batchId: { in: createdBatchIds } } }).catch(() => undefined)
    await basePrisma.importBatch.deleteMany({ where: { id: { in: createdBatchIds } } }).catch(() => undefined)
  })

  it('激活仅含部分期间的 cashflow 批次：重叠期间替换备份、非重叠保留、多批次共存（事故场景修复）', async () => {
    if (!dbReady) return
    // 场景复现：旧 active 批次 A 含 1、2 月，新批次 B 仅含 2、3 月 —— 修复前 B 激活会把 A 整体归档
    const a = await makeCfBatch('__test_cf_A__.xlsx', 'active', [
      { period: P1, value: 100 },
      { period: P2, value: 200 },
    ])
    const b = await makeCfBatch('__test_cf_B__.xlsx', 'draft', [
      { period: P2, value: 999 },
      { period: P3, value: 300 },
    ])

    // 批量激活预检按期间重叠报告冲突（不再落入"整体替换"提示）
    const [chk] = await ImportService.checkBatchActivateConflicts([b.id])
    expect(chk.status).toBe('draft')
    expect(chk.conflictCount).toBe(1)
    expect(chk.conflicts[0]).toMatchObject({ period: P2 })

    await ImportService.activate(b.id, 'test-user', 'trace')

    // A 的重叠期间 P2 行被删除并备份（template=cashflow），P1 保留；A 仍 active；B active
    const aRows = await basePrisma.factOperating.findMany({ where: { batchId: a.id }, select: { period: true, value: true } })
    expect(aRows.map((r) => [r.period, Number(r.value)])).toEqual([[P1, 100]])
    expect((await basePrisma.importBatch.findUnique({ where: { id: a.id } }))?.lifecycleStatus).toBe('active')
    expect((await basePrisma.importBatch.findUnique({ where: { id: b.id } }))?.lifecycleStatus).toBe('active')
    const snaps = await basePrisma.factSnapshot.findMany({ where: { batchId: a.id } })
    expect(snaps).toHaveLength(1)
    expect(snaps[0]).toMatchObject({
      template: 'cashflow',
      period: P2,
      periodDimCode: CASHFLOW_DIMS.ACTUAL_MONTH,
      archivedByBatchId: b.id,
    })
    expect(Number(snaps[0].value)).toBe(200)

    // 多 active 批次按期间共存：可用期间 = P1/P2/P3
    const activeBatches = await basePrisma.importBatch.findMany({ where: { dataType: 'cashflow', lifecycleStatus: 'active', id: { in: createdBatchIds } }, select: { id: true } })
    const periods = await basePrisma.factOperating.findMany({ where: { batchId: { in: activeBatches.map((x) => x.id) } }, distinct: ['period'], select: { period: true } })
    expect(periods.map((r) => r.period).sort()).toEqual([P1, P2, P3])
  })

  it('旧批次被完全覆盖后清空自动归档，其余批次保持 active', async () => {
    if (!dbReady) return
    const a = await makeCfBatch('__test_cf_A2__.xlsx', 'active', [
      { period: P1, value: 100 },
      { period: P2, value: 200 },
    ])
    const b = await makeCfBatch('__test_cf_B2__.xlsx', 'draft', [
      { period: P2, value: 999 },
      { period: P3, value: 300 },
    ])
    await ImportService.activate(b.id, 'test-user', 'trace')
    // 再激活仅含 P1 的 C：A 清空后自动归档，B 仍 active
    const c = await makeCfBatch('__test_cf_C2__.xlsx', 'draft', [{ period: P1, value: 111 }])
    await ImportService.activate(c.id, 'test-user', 'trace')
    expect((await basePrisma.importBatch.findUnique({ where: { id: a.id } }))?.lifecycleStatus).toBe('archived')
    expect(await basePrisma.factOperating.count({ where: { batchId: a.id } })).toBe(0)
    expect((await basePrisma.importBatch.findUnique({ where: { id: b.id } }))?.lifecycleStatus).toBe('active')
    expect((await basePrisma.importBatch.findUnique({ where: { id: c.id } }))?.lifecycleStatus).toBe('active')
  })

  it('rollbackBatch 恢复被替换的 cashflow 期间，重叠期间被当前 active 覆盖且自动备份', async () => {
    if (!dbReady) return
    const a = await makeCfBatch('__test_cf_A3__.xlsx', 'active', [
      { period: P1, value: 100 },
      { period: P2, value: 200 },
    ])
    const b = await makeCfBatch('__test_cf_B3__.xlsx', 'draft', [
      { period: P2, value: 999 },
      { period: P3, value: 300 },
    ])
    await ImportService.activate(b.id, 'test-user', 'trace')
    const c = await makeCfBatch('__test_cf_C3__.xlsx', 'draft', [{ period: P1, value: 111 }])
    await ImportService.activate(c.id, 'test-user', 'trace')

    // 回滚 A：快照（P1/P2）写回，重新激活后 C 的 P1 被覆盖归档，B 的 P3 保留
    const dto = await ImportService.rollbackBatch(a.id, 'test-user', 'trace')
    expect(dto.status).toBe('active')
    const aRows = await basePrisma.factOperating.findMany({ where: { batchId: a.id }, select: { period: true, value: true } })
    expect(aRows.map((r) => [r.period, Number(r.value)]).sort()).toEqual([[P1, 100], [P2, 200]].sort())
    const bRows = await basePrisma.factOperating.findMany({ where: { batchId: b.id }, select: { period: true, value: true } })
    expect(bRows.map((r) => [r.period, Number(r.value)])).toEqual([[P3, 300]])
    expect((await basePrisma.importBatch.findUnique({ where: { id: c.id } }))?.lifecycleStatus).toBe('archived')
    // C 被覆盖时快照重新生成（batchId=C），A 的快照已清理
    expect(await basePrisma.factSnapshot.findMany({ where: { batchId: a.id } })).toHaveLength(0)
    const cSnaps = await basePrisma.factSnapshot.findMany({ where: { batchId: c.id } })
    expect(cSnaps).toHaveLength(1)
    expect(cSnaps[0]).toMatchObject({ template: 'cashflow', period: P1, archivedByBatchId: a.id })
  })
})

describe('cashflow 导入预览科目覆盖检查（真实 DB）', () => {
  let company: { code: string; name: string } | null = null
  let cfSubject: { code: string; name: string } | null = null
  let rootCategories: string[] = []

  beforeAll(async () => {
    if (!dbReady) return
    company = await basePrisma.company.findFirst({ where: { entityType: 'single', status: 'active' }, select: { code: true, name: true } })
    cfSubject = await basePrisma.accountSubject.findFirst({ where: { subjectType: 'cashflow', isLeaf: true, status: 'active' }, select: { code: true, name: true } })
    const roots = await basePrisma.accountSubject.findMany({ where: { subjectType: 'cashflow', status: 'active', level: 0 }, distinct: ['category'], select: { category: true } })
    rootCategories = roots.map((r) => r.category)
  })

  it('kpiCoverage 按现金流科目树根类别（经营/投资/筹资活动）检查', async () => {
    if (!dbReady || !company || !cfSubject || rootCategories.length === 0) return
    const buf = makeXlsx([
      ['单体维度', company.name],
      ['月份', new Date(2098, 1, 15)],
      [cfSubject.name, 10],
    ])
    const res = await ImportService.preview({ buffer: buf }, 'cashflow')
    const kc = res.kpiCoverage!
    expect(kc).toBeTruthy()
    // covered/missing 覆盖现金流科目树全部根类别
    expect([...kc.covered, ...kc.missing].sort()).toEqual([...rootCategories].sort())
    // 文件科目上溯到的根类别应计入 covered
    const all = await basePrisma.accountSubject.findMany({ where: { subjectType: 'cashflow' }, select: { code: true, parentCode: true, category: true } })
    const byCode = new Map(all.map((s) => [s.code, s]))
    let cur = byCode.get(cfSubject.code)
    while (cur?.parentCode && byCode.has(cur.parentCode)) cur = byCode.get(cur.parentCode)
    const rootCategory = cur?.category
    if (rootCategory) expect(kc.covered).toContain(rootCategory)
  })
})
