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
  it('operating：公司×日期列展开，最新日期=本月实际、较早=同期实际', () => {
    const buf = makeXlsx([
      ['单体维度', '杭州公司', '杭州公司', '宁波公司', '宁波公司'],
      ['月份', new Date(2026, 2, 31), new Date(2025, 2, 31), new Date(2026, 2, 31), new Date(2025, 2, 31)],
      ['灶具收入', 100, 80, 200, 160],
      ['热水器收入', 50, 40, 60, 48],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.dataRowCount).toBe(2)
    expect(res.errors.length).toBe(0)
    expect(res.operating.length).toBe(8)
    const hzActual = res.operating.find((r) => r.companyCode === 'EN330059' && r.accountCode === 'OP_010' && r.periodDimCode === OPERATING_DIMS.ACTUAL_MONTH)
    expect(hzActual).toMatchObject({ period: '2026-03', fiscalYear: 'FY2026', value: 100 })
    const hzSame = res.operating.find((r) => r.companyCode === 'EN330059' && r.accountCode === 'OP_010' && r.periodDimCode === OPERATING_DIMS.SAME_PERIOD_ACTUAL)
    expect(hzSame).toMatchObject({ period: '2025-03', value: 80 })
  })

  it('static：最新日期=本期金额、较早=年初金额', () => {
    const buf = makeXlsx([
      ['公司维度', '杭州公司', '杭州公司'],
      ['月度', new Date(2026, 2, 31), new Date(2026, 1, 28)],
      ['总资产', 5000, 4500],
    ])
    const res = parseImportWorkbook(buf, 'static', resolvers)
    expect(res.static.length).toBe(2)
    const cur = res.static.find((r) => r.periodDimCode === STATIC_DIMS.CURRENT_AMOUNT)
    expect(cur).toMatchObject({ companyCode: 'EN330059', accountCode: 'ST_001', value: 5000 })
    const ys = res.static.find((r) => r.periodDimCode === STATIC_DIMS.YEAR_START)
    expect(ys).toMatchObject({ value: 4500 })
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
