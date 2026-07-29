import { describe, it, expect } from 'vitest'
import { extractCodes, validateFormula, extractOperandRefs, validateDimSuffixes } from './FormulaRuleService'

describe('公式校验纯函数', () => {
  it('extractCodes 提取 {CODE} 操作数并去重', () => {
    expect(extractCodes('{OP_040} / {OP_001}')).toEqual(['OP_040', 'OP_001'])
    expect(extractCodes('{A} + {A} - {B}')).toEqual(['A', 'B'])
    expect(extractCodes('1 + 2')).toEqual([])
  })

  it('extractCodes 剥离 @维度后缀并排除伪操作数', () => {
    expect(extractCodes('({ST_007@YEAR_START} + {ST_007}) / 2 * {DAYS_YTD} / {OP_031@YTD_ACTUAL}')).toEqual(['ST_007', 'OP_031'])
  })

  it('extractOperandRefs 返回编码与维度后缀', () => {
    expect(extractOperandRefs('{ST_007@YEAR_START} + {OP_001}')).toEqual([
      { code: 'ST_007', dim: 'YEAR_START' },
      { code: 'OP_001', dim: undefined },
    ])
  })

  it('validateDimSuffixes：非法维度码/伪操作数带后缀 → 告警；合法后缀无告警', () => {
    expect(validateDimSuffixes('{ST_007@YEAR_START} / {OP_031@YTD_ACTUAL} + {DAYS_YTD}')).toEqual([])
    expect(validateDimSuffixes('{ST_007@NOT_A_DIM}').some((w) => w.includes('无效的期间维度码'))).toBe(true)
    expect(validateDimSuffixes('{DAYS_YTD@YEAR_START}').some((w) => w.includes('不支持维度后缀'))).toBe(true)
  })

  it('validateFormula：合法公式无告警（含跨期间引用与 DAYS_YTD）', () => {
    const known = new Set(['OP_040', 'OP_001', 'ST_007'])
    expect(validateFormula('{OP_040} / {OP_001}', known, 'CALC_X')).toEqual([])
    expect(validateFormula('({ST_007@YEAR_START} + {ST_007}) / 2 * {DAYS_YTD} / {OP_040@YTD_ACTUAL}', known, 'CALC_X')).toEqual([])
  })

  it('validateFormula：未知编码 / 非法语法 / 环 各自告警', () => {
    const known = new Set(['OP_001'])
    expect(validateFormula('{OP_999} / {OP_001}', known, 'CALC_X').some((w) => w.includes('不存在'))).toBe(true)
    expect(validateFormula('{OP_001} +', known, 'CALC_X').some((w) => w.includes('语法'))).toBe(true)
    expect(validateFormula('{CALC_X}', known, 'CALC_X').some((w) => w.includes('环'))).toBe(true)
  })
})
