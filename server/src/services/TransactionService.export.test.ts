import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import ExcelJS from 'exceljs'
import { basePrisma } from '../lib/prisma'
import { TransactionService } from './TransactionService'

/**
 * 账龄分析导出集成测试（真实 DB，无 DB 时整组跳过）。
 * 覆盖：导出 = 当前视图（数据行 + 公司小计 + 合计）、subtotalOnly 仅保留小计/合计、
 * 8 段账龄归集口径、零余额行过滤、counterparty 分组列、无数据仅表头。
 * 使用独立测试公司编码 EN999904/EN999905 隔离，afterAll 清理。
 */

const CO_A = 'EN999904'
const CO_B = 'EN999905'
const TYPE = '应付账款'
const ACC = '__EXP_1122__'
const CP_A = '__EXP_CP_A__'
const CP_B = '__EXP_CP_B__'

let dbReady = false
const createdIds: string[] = []

async function seedDetail(companyCode: string, companyName: string, counterpartyCode: string, closing: number, aging: Record<string, number> = {}) {
  const row = await basePrisma.transactionDetail.create({
    data: {
      companyCode,
      companyName,
      transactionType: TYPE,
      direction: 'AP',
      counterpartyCode,
      accountCode: ACC,
      closingBalance: closing,
      period: '2098-06',
      ...aging,
    },
  })
  createdIds.push(row.id)
}

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    // CO_A：CP_A 100（1个月 60 + 2个月 40）、CP_B 300（4-6月 = 60+40、1年至2年 120、2年至3年 80）
    await seedDetail(CO_A, '导出测试A', CP_A, 100, { aging1m: 60, aging2m: 40 })
    await seedDetail(CO_A, '导出测试A', CP_B, 300, { aging4m: 60, aging5m: 40, aging1yTo2y: 120, aging2yTo3y: 80 })
    // CO_B：700（半年以上 500 + 3年以上 200）
    await seedDetail(CO_B, '导出测试B', CP_A, 700, { aging6mTo1y: 500, aging3yPlus: 200 })
    // 零余额行：账龄 999 但余额 0，应被过滤（若未过滤 3个月 段将出现 999）
    await seedDetail(CO_A, '导出测试A', '__EXP_CP_ZERO__', 0, { aging3m: 999 })
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.transactionDetail.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined)
})

/** 读取导出 Buffer 为二维字符串表 */
async function readSheet(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  const out: string[][] = []
  for (let i = 1; i <= ws.rowCount; i++) {
    const values: string[] = []
    for (let j = 1; j <= ws.columnCount; j++) {
      values.push(ws.getRow(i).getCell(j).text)
    }
    out.push(values)
  }
  return out
}

describe('TransactionService.exportAgingAnalysis（真实 DB）', () => {
  it('导出完整视图：数据行 + 各公司小计 + 合计，金额与 8 段账龄口径正确', async () => {
    if (!dbReady) return
    const buffer = await TransactionService.exportAgingAnalysis({ groupBy: 'type', period: '2098-06', companyCodes: [CO_A, CO_B] })
    const sheet = await readSheet(buffer)
    // 表头
    expect(sheet[0]).toEqual(['公司', '往来类型', '期末余额', '1个月', '2个月', '3个月', '4-6月', '半年以上', '1年至2年', '2年至3年', '3年以上'])
    // 行序：CO_A（组内余额倒序）→ CO_A 小计 → CO_B → CO_B 小计 → 合计
    expect(sheet[1]).toEqual(['导出测试A', TYPE, '400', '60', '40', '0', '100', '0', '120', '80', '0'])
    expect(sheet[2]).toEqual(['导出测试A 小计', '', '400', '60', '40', '0', '100', '0', '120', '80', '0'])
    expect(sheet[3]).toEqual(['导出测试B', TYPE, '700', '0', '0', '0', '0', '500', '0', '0', '200'])
    expect(sheet[4]).toEqual(['导出测试B 小计', '', '700', '0', '0', '0', '0', '500', '0', '0', '200'])
    expect(sheet[5]).toEqual(['合计', '', '1100', '60', '40', '0', '100', '500', '120', '80', '200'])
    expect(sheet).toHaveLength(6)
  })

  it('counterparty 分组：含往来对象列，组内按余额倒序，小计/合计口径一致', async () => {
    if (!dbReady) return
    const buffer = await TransactionService.exportAgingAnalysis({ groupBy: 'counterparty', period: '2098-06', companyCodes: [CO_A] })
    const sheet = await readSheet(buffer)
    expect(sheet[0]).toEqual(['公司', '往来类型', '往来对象', '期末余额', '1个月', '2个月', '3个月', '4-6月', '半年以上', '1年至2年', '2年至3年', '3年以上'])
    expect(sheet[1]).toEqual(['导出测试A', TYPE, CP_B, '300', '0', '0', '0', '100', '0', '120', '80', '0'])
    expect(sheet[2]).toEqual(['导出测试A', TYPE, CP_A, '100', '60', '40', '0', '0', '0', '0', '0', '0'])
    expect(sheet[3]).toEqual(['导出测试A 小计', '', '', '400', '60', '40', '0', '100', '0', '120', '80', '0'])
    expect(sheet[4]).toEqual(['合计', '', '', '400', '60', '40', '0', '100', '0', '120', '80', '0'])
  })

  it('subtotalOnly：仅保留小计与合计行', async () => {
    if (!dbReady) return
    const buffer = await TransactionService.exportAgingAnalysis({ groupBy: 'type', period: '2098-06', companyCodes: [CO_A, CO_B], subtotalOnly: true })
    const sheet = await readSheet(buffer)
    expect(sheet[1]).toEqual(['导出测试A 小计', '', '400', '60', '40', '0', '100', '0', '120', '80', '0'])
    expect(sheet[2]).toEqual(['导出测试B 小计', '', '700', '0', '0', '0', '0', '500', '0', '0', '200'])
    expect(sheet[3]).toEqual(['合计', '', '1100', '60', '40', '0', '100', '500', '120', '80', '200'])
    expect(sheet).toHaveLength(4)
  })

  it('无数据时仅输出表头', async () => {
    if (!dbReady) return
    const buffer = await TransactionService.exportAgingAnalysis({ groupBy: 'type', period: '2098-06', companyCodes: ['EN000000'] })
    const sheet = await readSheet(buffer)
    expect(sheet).toHaveLength(1)
    expect(sheet[0][0]).toBe('公司')
  })
})
