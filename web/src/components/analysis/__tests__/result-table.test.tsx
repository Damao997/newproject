import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultTable } from '@/components/analysis/result-table'
import type { AnalysisMetricColumn, AnalysisQueryRow } from '@/types'

/**
 * 通用结果表渲染测试（即席分析）。约束：
 * - amount → 千分位两位小数，零值显示 '-'（与全站 formatMoneyWan 口径一致）
 * - ratio  → 百分数文本（后端已 ×100，不得二次 ×100）
 * - null   → 「—」，不得显示 "null"/"NaN"
 */

const columns: AnalysisMetricColumn[] = [
  { key: 'income.ytdBudget', header: '累计预算目标', valueType: 'amount', group: '收入', tip: '财年预算 × 占比前缀和' },
  { key: 'income.ytdActual', header: '财年累计达成', valueType: 'amount', group: '收入', tip: '年初至当期实际' },
  { key: 'income.alertRate', header: '预警达成率', valueType: 'ratio', group: '收入', tip: '累计 ÷ 累计预算' },
  { key: 'income.ytdYoy', header: '财年同比', valueType: 'ratio', group: '收入', tip: '同比' },
  { key: 'marginRate', header: '毛利率', valueType: 'ratio', tip: '毛利 ÷ 收入' },
]

const rows: AnalysisQueryRow[] = [
  {
    code: 'P01', name: '灶具', level: 0, isTotal: false,
    values: { 'income.ytdBudget': 1500, 'income.ytdActual': 1234.56, 'income.alertRate': 82.3, 'income.ytdYoy': 5.2, marginRate: 25.5 },
  },
  {
    code: 'P02', name: '无预算产品', level: 0, isTotal: false,
    values: { 'income.ytdBudget': null, 'income.ytdActual': 0, 'income.alertRate': null, 'income.ytdYoy': 0, marginRate: null },
  },
]

describe('ResultTable 通用结果表', () => {
  it('渲染表头与数据行', () => {
    render(<ResultTable columns={columns} rows={rows} />)
    expect(screen.getByText('灶具')).toBeInTheDocument()
    expect(screen.getByText('无预算产品')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '累计预算目标' })).toBeInTheDocument()
  })

  it('金额按万元两位小数千分位渲染，零值显示 "-"', () => {
    render(<ResultTable columns={columns} rows={rows} />)
    expect(screen.getByText('1,500.00')).toBeInTheDocument()
    expect(screen.getByText('1,234.56')).toBeInTheDocument()
    expect(screen.getByText('-')).toBeInTheDocument() // 第二行 actual 为 0
  })

  it('null 统一显示「—」，不泄漏 null/NaN', () => {
    render(<ResultTable columns={columns} rows={rows} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('null')).toBeNull()
    expect(screen.queryByText('NaN')).toBeNull()
  })

  it('比率为百分数文本且只 ×100 一次', () => {
    render(<ResultTable columns={columns} rows={rows} />)
    expect(screen.getByText('82.3%')).toBeInTheDocument()
    expect(screen.getByText('25.5%')).toBeInTheDocument()
    // 同比为 5.2 → 涨跌胶囊 +5.2%（DeltaTag 入参为 5.2/100）
    expect(screen.getByText('+5.2%')).toBeInTheDocument()
  })

  it('多指标组维度渲染二级表头（收入）', () => {
    render(<ResultTable columns={columns} rows={rows} />)
    expect(screen.getByRole('columnheader', { name: '收入' })).toBeInTheDocument()
  })

  it('合计行带区分标识且不计入正文行数', () => {
    render(<ResultTable columns={columns} rows={rows} totals={{ values: { 'income.ytdBudget': 1500, 'income.ytdActual': 1234.56, 'income.alertRate': 82.3, 'income.ytdYoy': 5.2, marginRate: 25.5 } }} totalsLabel="合计" />)
    expect(screen.getByText('合计')).toBeInTheDocument()
    expect(screen.getByText('灶具')).toBeInTheDocument()
  })

  it('无数据时展示空态而不是空表', () => {
    render(<ResultTable columns={columns} rows={[]} emptyHint="换个维度试试" />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
    expect(screen.getByText('换个维度试试')).toBeInTheDocument()
  })

  it('零值比例的 0 不显示为「—」（有数据语义）', () => {
    render(<ResultTable columns={columns} rows={rows} />)
    expect(screen.getByText('0.0%')).toBeInTheDocument()
  })
})

/**
 * 矩阵模式（colMembers 存在，v2）。核心约束：
 * - 列 = 列成员 × 指标，末尾固定「小计」列（= 后端 __total，与 v1 单轴一致）
 * - 小计列取后端合并口径值，**不是逐列求和**（比率类横加无意义，见 T27 记录）
 */

const matrixColumns: AnalysisMetricColumn[] = [
  { key: 'income.ytdActual', header: '财年累计达成', valueType: 'amount', group: '收入', tip: '年初至当期实际' },
  { key: 'marginRate', header: '毛利率', valueType: 'ratio', tip: '毛利 ÷ 收入' },
]

const matrixRows: AnalysisQueryRow[] = [
  {
    code: 'P01', name: '灶具', level: 0, isTotal: false,
    values: { 'income.ytdActual': 300, marginRate: 9.2 },
    cells: {
      C001: { 'income.ytdActual': 100, marginRate: 30 },
      C002: { 'income.ytdActual': 200, marginRate: 40 },
      __total: { 'income.ytdActual': 300, marginRate: 9.2 },
    },
  },
]

const matrixMembers = [
  { code: 'C001', name: '浙江公司', subjectCodes: [] },
  { code: 'C002', name: '金华公司', subjectCodes: [] },
]

describe('ResultTable 矩阵模式', () => {
  it('渲染列成员分组表头 + 末尾小计列', () => {
    render(<ResultTable columns={matrixColumns} rows={matrixRows} colMembers={matrixMembers} />)
    expect(screen.getByRole('columnheader', { name: '浙江公司' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '金华公司' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '小计' })).toBeInTheDocument()
    // 指标表头在每个成员组下重复一次（含小计列）
    expect(screen.getAllByRole('columnheader', { name: '财年累计达成' })).toHaveLength(3)
  })

  it('逐成员渲染 cells 值', () => {
    render(<ResultTable columns={matrixColumns} rows={matrixRows} colMembers={matrixMembers} />)
    expect(screen.getByText('100.00')).toBeInTheDocument()
    expect(screen.getByText('200.00')).toBeInTheDocument()
  })

  it('成员缺位显示「—」而非 0（无数据与零值语义区分）', () => {
    const rows: AnalysisQueryRow[] = [{
      code: 'P02', name: '无该成员数据', level: 0, isTotal: false,
      values: { 'income.ytdActual': 100, marginRate: null },
      cells: { C001: { 'income.ytdActual': 100, marginRate: null }, __total: { 'income.ytdActual': 100, marginRate: null } },
    }]
    render(<ResultTable columns={matrixColumns} rows={rows} colMembers={matrixMembers} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('小计列取合并口径重算值，不是逐列求和（比率不可横加）', () => {
    render(<ResultTable columns={matrixColumns} rows={matrixRows} colMembers={matrixMembers} />)
    // 逐列毛利率 30% + 40% = 70% 无意义；小计必须是合并口径重算的 9.2%
    expect(screen.getByText('9.2%')).toBeInTheDocument()
    expect(screen.queryByText('70.0%')).toBeNull()
    expect(screen.getByText('30.0%')).toBeInTheDocument()
    expect(screen.getByText('40.0%')).toBeInTheDocument()
  })

  it('多指标组维度下表头三层：成员组 → 指标组 → 指标', () => {
    render(<ResultTable columns={matrixColumns} rows={matrixRows} colMembers={matrixMembers} />)
    expect(screen.getAllByRole('columnheader', { name: '收入' })).toHaveLength(3)
  })

  it('无数据时矩阵也走空态', () => {
    render(<ResultTable columns={matrixColumns} rows={[]} colMembers={matrixMembers} />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })
})
