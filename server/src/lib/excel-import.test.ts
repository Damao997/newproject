import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseImportWorkbook, type Resolvers } from './excel-import'
import { OPERATING_DIMS, STATIC_DIMS } from './metric-values'

/** 用 aoa 构造 xlsx Buffer */
function makeXlsx(aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

const resolvers: Resolvers = {
  companyByName: new Map([
    ['杭州公司', 'EN330059'],
    ['宁波公司', 'EN330058'],
  ]),
  subjectByName: new Map([
    ['灶具收入', 'OP_010'],
    ['热水器收入', 'OP_011'],
    ['总资产', 'ST_001'],
  ]),
  defaultFiscalYear: 'FY2025',
}

describe('excel-import 转置布局解析', () => {
  it('operating：每个日期列均存为本月实际（按各自 period），不在导入时打同期标', () => {
    const buf = makeXlsx([
      ['单体维度', '杭州公司', '杭州公司', '宁波公司', '宁波公司'],
      ['月份', new Date(2026, 2, 15), new Date(2025, 2, 15), new Date(2026, 2, 15), new Date(2025, 2, 15)],
      ['灶具收入', 100, 80, 200, 160],
      ['热水器收入', 50, 40, 60, 48],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.dataRowCount).toBe(2)
    expect(res.errors.length).toBe(0)
    expect(res.operating.length).toBe(8)
    // 全部为 ACTUAL_MONTH，无 SAME_PERIOD 打标
    expect(res.operating.every((r) => r.periodDimCode === OPERATING_DIMS.ACTUAL_MONTH)).toBe(true)
    const hzCur = res.operating.find((r) => r.companyCode === 'EN330059' && r.accountCode === 'OP_010' && r.period === '2026-03')
    expect(hzCur).toMatchObject({ fiscalYear: 'FY2026', value: 100 })
    const hzPrev = res.operating.find((r) => r.companyCode === 'EN330059' && r.accountCode === 'OP_010' && r.period === '2025-03')
    expect(hzPrev).toMatchObject({ fiscalYear: 'FY2025', value: 80 })
  })

  it('operating 多月序列：当年与上年各月均按自身 period 存为本月实际', () => {
    const buf = makeXlsx([
      ['单体维度', '杭州公司', '杭州公司', '杭州公司', '杭州公司'],
      ['月份', new Date(2026, 1, 15), new Date(2026, 2, 15), new Date(2025, 1, 15), new Date(2025, 2, 15)],
      ['灶具收入', 10, 20, 8, 16],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    const rows = res.operating.filter((r) => r.accountCode === 'OP_010')
    expect(rows.length).toBe(4)
    expect(rows.every((r) => r.periodDimCode === OPERATING_DIMS.ACTUAL_MONTH)).toBe(true)
    const periods = rows.map((r) => r.period).sort()
    expect(periods).toEqual(['2025-02', '2025-03', '2026-02', '2026-03'])
    expect(rows.find((r) => r.period === '2025-03')).toMatchObject({ fiscalYear: 'FY2025', value: 16 })
    expect(rows.find((r) => r.period === '2026-02')).toMatchObject({ fiscalYear: 'FY2026', value: 10 })
  })

  it('static：每个快照列均存为原始快照（marker=CURRENT_AMOUNT，携 snapshotDate）', () => {
    const buf = makeXlsx([
      ['公司维度', '杭州公司', '杭州公司'],
      ['月度', new Date(2026, 2, 15), new Date(2026, 0, 15)],
      ['总资产', 5000, 4500],
    ])
    const res = parseImportWorkbook(buf, 'static', resolvers)
    expect(res.static.length).toBe(2)
    // 全部为原始快照 marker，四维由聚合层按快照月份派生
    expect(res.static.every((r) => r.periodDimCode === STATIC_DIMS.CURRENT_AMOUNT)).toBe(true)
    const mar = res.static.find((r) => r.accountCode === 'ST_001' && r.snapshotDate.getUTCMonth() === 2)
    expect(mar).toMatchObject({ companyCode: 'EN330059', value: 5000 })
    const jan = res.static.find((r) => r.accountCode === 'ST_001' && r.snapshotDate.getUTCMonth() === 0)
    expect(jan).toMatchObject({ value: 4500 })
  })

  it('budget：单表头公司列，年度预算', () => {
    const buf = makeXlsx([
      ['主要指标/主体公司', '杭州公司', '宁波公司'],
      ['灶具收入', 1000, 2000],
    ])
    const res = parseImportWorkbook(buf, 'budget', resolvers)
    expect(res.budget.length).toBe(2)
    expect(res.budget[0]).toMatchObject({ companyCode: 'EN330059', accountCode: 'OP_010', period: 'annual', fiscalYear: 'FY2025', value: 1000 })
  })

  it('未知公司名与科目名记为错误', () => {
    const buf = makeXlsx([
      ['单体维度', '未知公司', '杭州公司'],
      ['月份', new Date(2026, 2, 31), new Date(2026, 2, 31)],
      ['灶具收入', 1, 2],
      ['未知科目', 3, 4],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.errors.some((e) => e.message.includes('公司名未匹配'))).toBe(true)
    expect(res.errors.some((e) => e.message.includes('科目名未匹配'))).toBe(true)
  })

  it('非数字值记为错误', () => {
    const buf = makeXlsx([
      ['单体维度', '杭州公司'],
      ['月份', new Date(2026, 2, 31)],
      ['灶具收入', 'N/A'],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.errors.some((e) => e.message.includes('值非数字'))).toBe(true)
  })
})
