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

describe('excel-import 标准布局解析', () => {
  it('operating 标准布局：行=公司×月份，列=科目', () => {
    const buf = makeXlsx([
      ['公司名', '月份', '灶具收入', '热水器收入'],
      ['杭州公司', new Date(2026, 3, 1), 100, 50],
      ['宁波公司', new Date(2026, 3, 1), 200, 60],
      ['杭州公司', new Date(2026, 4, 1), 110, 55],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.errors.length).toBe(0)
    expect(res.dataRowCount).toBe(3)
    expect(res.operating.length).toBe(6)
    expect(res.operating.every((r) => r.periodDimCode === OPERATING_DIMS.ACTUAL_MONTH)).toBe(true)
    const hzApr = res.operating.find((r) => r.companyCode === 'EN330059' && r.accountCode === 'OP_010' && r.period === '2026-04')
    expect(hzApr).toMatchObject({ fiscalYear: 'FY2026', value: 100 })
    const nbApr = res.operating.find((r) => r.companyCode === 'EN330058' && r.accountCode === 'OP_011' && r.period === '2026-04')
    expect(nbApr).toMatchObject({ value: 60 })
  })

  it('标准布局：未知公司/科目报错', () => {
    const buf = makeXlsx([
      ['公司名', '月份', '灶具收入', '未知科目'],
      ['未知公司', new Date(2026, 3, 1), 100, 50],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.errors.some((e) => e.message.includes('科目名未匹配'))).toBe(true)
    expect(res.errors.some((e) => e.message.includes('公司名未匹配'))).toBe(true)
  })
})

describe('excel-import 月份格式识别', () => {
  it('中文月份 "2025年4月" 解析', () => {
    const buf = makeXlsx([
      ['公司名', '月份', '灶具收入'],
      ['杭州公司', '2025年4月', 88],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.errors.length).toBe(0)
    expect(res.operating.length).toBe(1)
    expect(res.operating[0].period).toBe('2025-04')
    expect(res.operating[0].value).toBe(88)
  })

  it('YYYY-MM 格式解析', () => {
    const buf = makeXlsx([
      ['公司名', '月份', '灶具收入'],
      ['杭州公司', '2025-06', 99],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.errors.length).toBe(0)
    expect(res.operating[0].period).toBe('2025-06')
  })

  it('YYYYMM 纯数字格式解析', () => {
    const buf = makeXlsx([
      ['公司名', '月份', '灶具收入'],
      ['杭州公司', '202507', 77],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.errors.length).toBe(0)
    expect(res.operating[0].period).toBe('2025-07')
  })
})

describe('excel-import sampleRows', () => {
  it('转置布局 operating 返回 sampleRows，且显示公司名/科目名而非编码', () => {
    const buf = makeXlsx([
      ['单体维度', '杭州公司'],
      ['月份', new Date(2026, 2, 15)],
      ['灶具收入', 100],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.sampleRows.headers).toEqual(['科目', '公司', '月份', '值'])
    expect(res.sampleRows.rows.length).toBeGreaterThan(0)
    expect(res.sampleRows.rows[0][0]).toBe('灶具收入')
    expect(res.sampleRows.rows[0][1]).toBe('杭州公司')
  })

  it('标准布局返回 sampleRows，表头与每行列数一致（回归表头错位 bug）', () => {
    const buf = makeXlsx([
      ['公司名', '月份', '灶具收入', '热水器收入'],
      ['杭州公司', new Date(2026, 3, 1), 100, 50],
      ['宁波公司', new Date(2026, 3, 1), 200, 60],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.sampleRows.headers).toEqual(['科目', '公司', '月份', '值'])
    expect(res.sampleRows.rows.length).toBe(4)
    for (const row of res.sampleRows.rows) expect(row.length).toBe(res.sampleRows.headers.length)
    expect(res.sampleRows.rows.some((r) => r[1] === '杭州公司')).toBe(true)
  })

  it('超过 20 条时等距分散采样，覆盖多个科目', () => {
    // 2 科目 × 24 列（同公司 24 个月）= 48 条，若取前 20 条将全是第一个科目
    const months = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(2024 + Math.floor(i / 12), i % 12, 10)))
    const buf = makeXlsx([
      ['单体维度', ...months.map(() => '杭州公司')],
      ['月份', ...months],
      ['灶具收入', ...months.map((_, i) => i + 1)],
      ['热水器收入', ...months.map((_, i) => i + 100)],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.operating.length).toBe(48)
    expect(res.sampleRows.rows.length).toBeLessThanOrEqual(20)
    const sampledSubjects = new Set(res.sampleRows.rows.map((r) => r[0]))
    expect(sampledSubjects.size).toBeGreaterThan(1)
  })
})

describe('excel-import 覆盖摘要 summary', () => {
  it('operating：公司数/科目数/期间范围/合计/零值统计', () => {
    const buf = makeXlsx([
      ['单体维度', '杭州公司', '宁波公司'],
      ['月份', new Date(2026, 2, 15), new Date(2026, 3, 15)],
      ['灶具收入', 100, 200],
      ['热水器收入', 0, 50],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.summary.companyCount).toBe(2)
    expect(res.summary.subjectCount).toBe(2)
    expect(res.summary.periodRange).toEqual({ min: '2026-03', max: '2026-04' })
    expect(res.summary.periods).toEqual(['2026-03', '2026-04'])
    expect(res.summary.totalValue).toBe(350)
    expect(res.summary.zeroValueCount).toBe(1)
    expect(res.summary.duplicateCount).toBe(0)
    expect([...res.summary.accountCodes].sort()).toEqual(['OP_010', 'OP_011'])
  })

  it('文件内重复：同公司同科目同月份被检出并按科目求和合并', () => {
    // 两列同为 2026-03，unpivot 后唯一键相同 → 入库前求和合并为一条
    const buf = makeXlsx([
      ['单体维度', '杭州公司', '杭州公司'],
      ['月份', new Date(2026, 2, 10), new Date(2026, 2, 20)],
      ['灶具收入', 100, 120],
    ])
    const res = parseImportWorkbook(buf, 'operating', resolvers)
    expect(res.operating.length).toBe(1)
    expect(res.operating[0].value).toBe(220)
    expect(res.summary.duplicateCount).toBe(1)
    expect(res.summary.duplicateSamples.length).toBe(1)
    expect(res.summary.duplicateSamples[0]).toContain('杭州公司')
    expect(res.summary.duplicateSamples[0]).toContain('灶具收入')
    expect(res.summary.duplicateSamples[0]).toContain('2026-03')
  })

  it('budget：期间为财年，重复键含财年', () => {
    const buf = makeXlsx([
      ['主要指标/主体公司', '杭州公司', '宁波公司'],
      ['灶具收入', 1000, 2000],
    ])
    const res = parseImportWorkbook(buf, 'budget', resolvers)
    expect(res.summary.periods).toEqual(['FY2025'])
    expect(res.summary.companyCount).toBe(2)
    expect(res.summary.duplicateCount).toBe(0)
    expect(res.summary.totalValue).toBe(3000)
  })
})
