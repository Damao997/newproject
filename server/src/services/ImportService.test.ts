import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as XLSX from 'xlsx'
import { basePrisma } from '../lib/prisma'
import { ImportService } from './ImportService'

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

  it('preview 合法 xlsx 返回数据行数且不写库', async () => {
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
  })
})
