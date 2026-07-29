import { describe, it, expect } from 'vitest'
import {
  parsePeriod,
  formatPeriod,
  fiscalYearStartYear,
  fiscalYearLabel,
  fiscalYearStartPeriod,
  periodMinusYears,
  periodsInRange,
  fyLabelOfDate,
  fiscalYtdDays,
} from './period'

/** 期数工具单测：覆盖自然年与自定义起始月（S=4）两种财年口径 */

describe('period 基础解析/组装', () => {
  it('parse/format 往返与月份进位借位', () => {
    expect(parsePeriod('2026-04')).toEqual({ year: 2026, month: 4 })
    expect(formatPeriod(2026, 4)).toBe('2026-04')
    expect(formatPeriod(2026, 13)).toBe('2027-01') // 进位
    expect(formatPeriod(2026, 0)).toBe('2025-12') // 借位
  })
})

describe('财年口径：自然年（S=1）', () => {
  it('财年归属与起始期', () => {
    expect(fiscalYearStartYear('2026-04', 1)).toBe(2026)
    expect(fiscalYearLabel('2026-04', 1)).toBe('FY2026')
    expect(fiscalYearStartPeriod('2026-04', 1)).toBe('2026-01')
  })
})

describe('财年口径：自定义起始月（S=4）', () => {
  it('4 月起：2026-04 属 FY2026，2026-03 属 FY2025', () => {
    expect(fiscalYearStartYear('2026-04', 4)).toBe(2026)
    expect(fiscalYearStartYear('2026-03', 4)).toBe(2025)
    expect(fiscalYearLabel('2027-01', 4)).toBe('FY2026') // 2027-01 仍属 2026-04 起的财年
    expect(fiscalYearStartPeriod('2027-01', 4)).toBe('2026-04')
  })
})

describe('同期与区间', () => {
  it('periodMinusYears 同月往前一年', () => {
    expect(periodMinusYears('2026-04', 1)).toBe('2025-04')
  })
  it('periodsInRange 闭区间升序（跨年）', () => {
    expect(periodsInRange('2026-04', '2026-06')).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(periodsInRange('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(periodsInRange('2026-06', '2026-04')).toEqual([]) // 逆序空
  })
  it('自定义财年内累计区间：S=4 时 2027-01 的本年累计从 2026-04 起', () => {
    const p = '2027-01'
    expect(periodsInRange(fiscalYearStartPeriod(p, 4), p)).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01',
    ])
  })
})

describe('fyLabelOfDate', () => {
  it('按 UTC 年月归财年（S=4）', () => {
    expect(fyLabelOfDate(new Date(Date.UTC(2026, 3, 15)), 4)).toBe('FY2026') // 4 月
    expect(fyLabelOfDate(new Date(Date.UTC(2026, 2, 15)), 4)).toBe('FY2025') // 3 月
    expect(fyLabelOfDate(new Date(Date.UTC(2026, 3, 15)), 1)).toBe('FY2026') // 自然年
  })
})

describe('fiscalYtdDays 财年累计天数', () => {
  it('自然年（S=1）：1 月单月 / 上半年 / 全年（含闰年）', () => {
    expect(fiscalYtdDays('2026-01', 1)).toBe(31)
    expect(fiscalYtdDays('2026-06', 1)).toBe(31 + 28 + 31 + 30 + 31 + 30) // 181
    expect(fiscalYtdDays('2026-12', 1)).toBe(365)
    expect(fiscalYtdDays('2024-12', 1)).toBe(366) // 闰年
    expect(fiscalYtdDays('2024-02', 1)).toBe(31 + 29) // 闰 2 月
  })
  it('自定义起始月（S=4）：跨自然年累计', () => {
    expect(fiscalYtdDays('2026-04', 4)).toBe(30) // 起始月当月
    expect(fiscalYtdDays('2027-01', 4)).toBe(30 + 31 + 30 + 31 + 31 + 30 + 31 + 30 + 31 + 31) // 2026-04..2027-01
  })
})
