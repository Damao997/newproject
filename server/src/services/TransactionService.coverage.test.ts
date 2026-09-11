import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as XLSX from 'xlsx'
import { basePrisma } from '../lib/prisma'
import { TransactionService } from './TransactionService'
import { ImportService } from './ImportService'

/**
 * 导入完整性管控集成测试（真实 DB，无 DB 时整组跳过）。
 * 覆盖：覆盖矩阵三态（active/draft/missing）与统计、批次覆盖明细、预览激活影响预告。
 * 使用独立测试公司 EN999904 隔离（seed 建 company + 批次 + 明细），afterAll 全部清理。
 */

const CO = 'EN999904'
const CO_NAME = '__覆盖测试公司__'

let dbReady = false
let activeBatchId = ''
let draftBatchId = ''
const cleanupDetailIds: string[] = []

/**
 * 固定测试期间：用全库最大的 2099 年份，使覆盖矩阵期间轴终点确定为 P2，
 * 避免与并行测试文件（2097/2098 期间种子）及真实数据产生干扰。
 */
const P1 = '2099-05'
const P2 = '2099-06'

async function seedDetail(batchId: string, period: string, transactionType: string, direction: string) {
  const row = await basePrisma.transactionDetail.create({
    data: {
      batchId,
      companyCode: CO,
      companyName: CO_NAME,
      transactionType,
      direction,
      counterpartyCode: '__COV_CP__',
      accountCode: '__COV_ACC__',
      closingBalance: 100,
      period,
    },
  })
  cleanupDetailIds.push(row.id)
}

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    await basePrisma.company.upsert({
      where: { code: CO },
      update: { name: CO_NAME, entityType: 'single', status: 'active' },
      create: { code: CO, name: CO_NAME, entityType: 'single', status: 'active' },
    })
    const activeBatch = await basePrisma.importBatch.create({
      data: {
        fileName: '__cov_active__.xls', status: 'success', dataType: 'transaction', lifecycleStatus: 'active', sourceType: 'upload',
        // 申报覆盖：应收有数据；预收为空 Sheet（该期确无往来款）
        coverageJson: [
          { companyCode: CO, period: P2, transactionType: '应收账款', recordCount: 1 },
          { companyCode: CO, period: P2, transactionType: '预收账款', recordCount: 0 },
        ] as never,
      },
    })
    const draftBatch = await basePrisma.importBatch.create({
      data: { fileName: '__cov_draft__.xls', status: 'success', dataType: 'transaction', lifecycleStatus: 'draft', sourceType: 'upload', detailCount: 1 },
    })
    activeBatchId = activeBatch.id
    draftBatchId = draftBatch.id
    // 生效：P2 应收账款（含一条零余额行验证明细隐藏）；草稿：P2 应付账款；预收为申报空 Sheet
    await seedDetail(activeBatchId, P2, '应收账款', 'AR')
    const zeroRow = await basePrisma.transactionDetail.create({
      data: {
        batchId: activeBatchId, companyCode: CO, companyName: CO_NAME, transactionType: '应收账款', direction: 'AR',
        counterpartyCode: '__COV_CP_ZERO__', accountCode: '__COV_ACC__', closingBalance: 0, period: P2,
      },
    })
    cleanupDetailIds.push(zeroRow.id)
    await seedDetail(draftBatchId, P2, '应付账款', 'AP')
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.transactionDetail.deleteMany({ where: { id: { in: cleanupDetailIds } } }).catch(() => undefined)
  await basePrisma.importBatch.deleteMany({ where: { id: { in: [activeBatchId, draftBatchId] } } }).catch(() => undefined)
  await basePrisma.company.delete({ where: { code: CO } }).catch(() => undefined)
})

describe('TransactionService.getImportCoverage（真实 DB）', () => {
  it('覆盖矩阵三态与统计正确', async () => {
    if (!dbReady) return
    const r = await TransactionService.getImportCoverage({ months: 2 })
    expect(r.periods).toEqual([P1, P2])
    expect(r.types).toHaveLength(6)
    expect(r.companies.some((c) => c.code === CO)).toBe(true)

    const cellOf = (type: string, period: string) =>
      r.cells.find((c) => c.companyCode === CO && c.period === period && c.transactionType === type)!

    // 生效批次数据 → active + 笔数（含零余额行共 2 条）
    expect(cellOf('应收账款', P2).status).toBe('active')
    expect(cellOf('应收账款', P2).recordCount).toBe(2)
    // 无明细但被生效批次申报 → empty（已导入·该期确无往来款）
    expect(cellOf('预收账款', P2).status).toBe('empty')
    // 仅草稿批次数据 → draft + 携带批次 id
    expect(cellOf('应付账款', P2).status).toBe('draft')
    expect(cellOf('应付账款', P2).draftBatchIds).toContain(draftBatchId)
    // 无任何数据/申报 → missing
    expect(cellOf('其他应收款', P2).status).toBe('missing')
    expect(cellOf('应收账款', P1).status).toBe('missing')

    // 统计自洽：覆盖率含 empty
    expect(r.summary.expected).toBe(r.companies.length * r.periods.length * 6)
    expect(r.summary.active + r.summary.empty + r.summary.draft + r.summary.missing).toBe(r.summary.expected)
    expect(r.summary.empty).toBeGreaterThanOrEqual(1)
    expect(r.summary.coverageRate).toBeCloseTo(Number((((r.summary.active + r.summary.empty) / r.summary.expected) * 100).toFixed(1)), 5)
    // 草稿批次提醒包含测试草稿批次
    expect(r.draftBatches.some((b) => b.id === draftBatchId)).toBe(true)
  })
})

describe('TransactionService.getBatchCoverage（真实 DB）', () => {
  it('返回批次包含的三元组及笔数', async () => {
    if (!dbReady) return
    const rows = await TransactionService.getBatchCoverage(activeBatchId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ companyCode: CO, transactionType: '应收账款', recordCount: 2 })
  })

  it('批次不存在报 404', async () => {
    if (!dbReady) return
    await expect(TransactionService.getBatchCoverage('00000000-0000-0000-0000-000000000000')).rejects.toThrow('不存在')
  })
})

describe('ImportService.previewTransactions 激活影响预告（真实 DB）', () => {
  it('与已生效数据重叠的组合列入 overlappingKeys，其余列入 newKeys', async () => {
    if (!dbReady) return
    const [y, m] = P2.split('-')
    // 构造 AR 汇总表：同公司同月（与生效数据重叠）+ 另一类型 Sheet 走 newKeys 由期间差异验证（此处用下月）
    const header = ['序号', '公司编码', '公司名称', '客户编码', '客户名称', '客户性质', '会计科目编码', '会计科目说明', '子目编码', '子目说明', '自然年年初余额', '变化率', '财年年初余额', '变化率', '期末余额', '本月收款额', '期末余额账龄分析']
    const sub = [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, '1个月', '2个月', '3个月', '4个月', '5个月', '6个月', '半年到1年', '1年到2年', '2年到3年', '3年以上', '合计']
    const dataRow = ['1', CO.replace('EN', ''), CO_NAME, 'C001', '客户甲', '个体', '1122', '应收账款-测试', '0', '', 0, '', 10, '', 10, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10]
    const aoa = [
      ['应收款账龄分析明细表'],
      ['公司:' + CO_NAME, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, `截止日期:${y}-${m}-28`],
      header, sub, dataRow,
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'AR-账龄汇总表')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const [preview] = await ImportService.previewTransactions([{ originalname: 'cov-test.xlsx', buffer: buf }])
    expect(preview.errorCount).toBe(0)
    expect(preview.activationImpact.overlappingKeys).toHaveLength(1)
    expect(preview.activationImpact.overlappingKeys[0]).toMatchObject({ companyCode: CO, period: P2, transactionType: '应收账款', existingCount: 2 })
    expect(preview.activationImpact.newKeys).toHaveLength(0)
  })
})
