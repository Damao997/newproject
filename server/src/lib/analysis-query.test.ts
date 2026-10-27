import { describe, it, expect } from 'vitest'
import { analysisQuerySchema, DEFAULT_FILTERS, DEFAULT_OPTIONS } from './analysis-query'

const parse = (input: unknown) => analysisQuerySchema.safeParse(input)

describe('analysisQuerySchema 请求体校验', () => {
  it('最小合法请求（仅 rowDim）通过，可选块保持 undefined（由 service 补默认）', () => {
    const r = parse({ rowDim: 'product' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.filters).toBeUndefined()
      expect(r.data.options).toBeUndefined()
      expect(r.data.metrics).toBeUndefined()
    }
  })

  it('filters 块内部分字段缺省时，块内默认值生效', () => {
    const r = parse({ rowDim: 'expense', filters: { keyword: '费用' } })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.filters).toEqual({ excludeReclassify: false, keyword: '费用', rowCodes: [] })
  })

  it('options 块内默认值：includeTotals 缺省为 true', () => {
    const r = parse({ rowDim: 'subject', options: { level: 2 } })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.options).toEqual({ includeEmptyRows: false, includeTotals: true, level: 2 })
  })

  it('rowDim 枚举外的值 → 失败', () => {
    expect(parse({ rowDim: 'channel' }).success).toBe(false)
    expect(parse({ rowDim: '' }).success).toBe(false)
  })

  it('rowDim 必填', () => {
    expect(parse({ period: '2026-09' }).success).toBe(false)
  })

  it('期间格式必须为 YYYY-MM', () => {
    expect(parse({ rowDim: 'subject', period: '2026-09' }).success).toBe(true)
    expect(parse({ rowDim: 'subject', period: '2026/09' }).success).toBe(false)
    expect(parse({ rowDim: 'subject', period: '2026-9' }).success).toBe(false)
    expect(parse({ rowDim: 'subject', period: '26-09' }).success).toBe(false)
  })

  it('metrics 超过 60 项 → 失败（上限需容纳 company 维度 3 组 × 19 指标 = 57）', () => {
    const metrics = Array.from({ length: 61 }, (_, i) => `m${i}`)
    expect(parse({ rowDim: 'subject', metrics }).success).toBe(false)
    expect(parse({ rowDim: 'subject', metrics: metrics.slice(0, 60) }).success).toBe(true)
  })

  it('filters.rowCodes 超过 500 项 → 失败', () => {
    const rowCodes = Array.from({ length: 501 }, (_, i) => `C${i}`)
    expect(parse({ rowDim: 'subject', filters: { rowCodes } }).success).toBe(false)
    expect(parse({ rowDim: 'subject', filters: { rowCodes: rowCodes.slice(0, 500) } }).success).toBe(true)
  })

  it('options.level 超出 0–3 → 失败；null 合法', () => {
    expect(parse({ rowDim: 'subject', options: { level: 4 } }).success).toBe(false)
    expect(parse({ rowDim: 'subject', options: { level: -1 } }).success).toBe(false)
    expect(parse({ rowDim: 'subject', options: { level: 3 } }).success).toBe(true)
    expect(parse({ rowDim: 'subject', options: { level: null } }).success).toBe(true)
  })

  it('colDim 合法值与行列同维拒绝（矩阵模式 v2）', () => {
    expect(parse({ rowDim: 'category', colDim: 'company' }).success).toBe(true)
    expect(parse({ rowDim: 'category', colDim: 'category' }).success).toBe(false) // 行列同维无矩阵意义
    expect(parse({ rowDim: 'category', colDim: 'bogus' }).success).toBe(false)
    const r = parse({ rowDim: 'category', colDim: 'category' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('列维度不能与行维度相同')
  })

  it('colCodes 超过 50 项 → 失败（列成员上限防组合爆炸）', () => {
    const colCodes = Array.from({ length: 51 }, (_, i) => `C${i}`)
    expect(parse({ rowDim: 'category', colDim: 'company', colCodes }).success).toBe(false)
    expect(parse({ rowDim: 'category', colDim: 'company', colCodes: colCodes.slice(0, 50) }).success).toBe(true)
  })

  it('未知字段被 strict 拒绝（前后端契约外字段不静默吞掉）', () => {
    expect(parse({ rowDim: 'subject', foo: 1 }).success).toBe(false)
    expect(parse({ rowDim: 'subject', filters: { bar: 1 } }).success).toBe(false)
    expect(parse({ rowDim: 'subject', options: { baz: 1 } }).success).toBe(false)
  })

  it('DEFAULT_FILTERS / DEFAULT_OPTIONS 形状与块内默认一致', () => {
    expect(DEFAULT_FILTERS).toEqual({ excludeReclassify: false, keyword: '', rowCodes: [] })
    expect(DEFAULT_OPTIONS).toEqual({ includeEmptyRows: false, includeTotals: true, level: null })
  })
})
