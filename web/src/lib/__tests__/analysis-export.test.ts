import { describe, it, expect } from 'vitest'
import { analysisCsvFileName, buildAnalysisCsv } from '@/lib/analysis-export'
import type { AnalysisMetricColumn, AnalysisQueryRow, AnalysisColMember } from '@/types'

/**
 * CSV 导出测试（L1-4）。约束：
 * - 表头复合命名「成员 · 指标」（矩阵）；单轴即指标名
 * - null → 空字段（不泄漏 null/NaN）；比率保留 1 位小数（不带 %）
 * - RFC 4180 转义：逗号/引号/换行
 * - 总计行只导单轴（矩阵后端无逐成员总计）
 */

const columns: AnalysisMetricColumn[] = [
  { key: 'income.ytdActual', header: '财年累计达成', valueType: 'amount', group: '收入', tip: '' },
  { key: 'marginRate', header: '毛利率', valueType: 'ratio', tip: '' },
]

const rows: AnalysisQueryRow[] = [
  { code: 'P01', name: '灶具', level: 0, isTotal: false, values: { 'income.ytdActual': 1234.56, marginRate: 25.53 } },
  { code: 'T', name: '合计', level: 0, isTotal: true, values: { 'income.ytdActual': 1234.56, marginRate: 25.53 } },
  { code: 'P02', name: '含,逗号"引"号', level: 0, isTotal: false, values: { 'income.ytdActual': null, marginRate: null } },
]

const lines = (csv: string) => csv.split('\r\n')

describe('buildAnalysisCsv 单轴模式', () => {
  it('表头 = 行 + 指标名；isTotal 行用合计标签', () => {
    const csv = buildAnalysisCsv(columns, rows)
    const ls = lines(csv)
    expect(ls[0]).toBe('行,财年累计达成,毛利率')
    expect(ls[2]).toBe('合计,1234.56,25.5')
    // 金额保留原始精度（表格内由用户自设格式），不做两位小数补齐
  })

  it('null → 空字段，不出现 null/NaN', () => {
    const csv = buildAnalysisCsv(columns, rows)
    expect(csv).not.toMatch(/null|NaN/)
    expect(lines(csv)[3]).toBe('"含,逗号""引""号",,')
  })

  it('总计行（tfoot）附在末尾', () => {
    const csv = buildAnalysisCsv(columns, rows, undefined, { values: { 'income.ytdActual': 999, marginRate: 10 } })
    const ls = lines(csv)
    expect(ls.at(-1)).toBe('合计,999,10.0')
  })

  it('空数据返回空字符串', () => {
    expect(buildAnalysisCsv(columns, [], undefined)).toBe('')
    expect(buildAnalysisCsv([], rows, undefined)).toBe('')
  })
})

describe('buildAnalysisCsv 矩阵模式', () => {
  const members: AnalysisColMember[] = [
    { code: 'C001', name: '浙江公司', subjectCodes: [] },
    { code: 'C002', name: '金华,分支', subjectCodes: [] },
  ]
  const matrixRows: AnalysisQueryRow[] = [
    {
      code: 'P01', name: '灶具', level: 0, isTotal: false,
      values: { 'income.ytdActual': 300, marginRate: 9.2 },
      cells: {
        C001: { 'income.ytdActual': 100, marginRate: 30 },
        __total: { 'income.ytdActual': 300, marginRate: 9.2 },
      },
    },
  ]

  it('表头复合命名为「成员 · 指标」且末尾含小计列', () => {
    const ls = lines(buildAnalysisCsv(columns, matrixRows, members))
    expect(ls[0]).toBe('行,浙江公司 · 财年累计达成,浙江公司 · 毛利率,"金华,分支 · 财年累计达成","金华,分支 · 毛利率",小计 · 财年累计达成,小计 · 毛利率')
  })

  it('逐成员 cells 取值；缺成员为空；小计取 __total（不横加）', () => {
    const ls = lines(buildAnalysisCsv(columns, matrixRows, members))
    expect(ls[1]).toBe('灶具,100,30.0,,,300,9.2')
  })

  it('矩阵模式不导总计行（后端无逐成员总计）', () => {
    const csv = buildAnalysisCsv(columns, matrixRows, members, { values: { 'income.ytdActual': 300, marginRate: 9.2 } })
    expect(lines(csv)).toHaveLength(2)
  })
})

describe('analysisCsvFileName', () => {
  it('含维度与期间', () => {
    expect(analysisCsvFileName('category', '2026-09')).toBe('即席分析_category_2026-09.csv')
  })

  it('期间缺失时占位', () => {
    expect(analysisCsvFileName('product', '')).toBe('即席分析_product_unknown.csv')
  })
})
