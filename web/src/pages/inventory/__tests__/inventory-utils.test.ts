import { describe, it, expect } from 'vitest'
import {
  sortValue,
  makeComparator,
  exportColumns,
  formatDays,
  round2,
  EMPTY_ROWS,
  NUMERIC_EXPORT_COLUMNS,
  DIM_TITLES,
  DIM_EMPTY_TITLES,
  DIM_EMPTY_HINTS,
  DIM_REGION_LABELS,
  DIM_SEARCH_EMPTY_HINTS,
  type SortState,
  type ViewRow,
} from '../inventory-utils'

/** 构造 minimal ViewRow（形状对齐 detail-table.tsx viewRows 构建逻辑） */
function row(partial: Partial<ViewRow> = {}): ViewRow {
  return {
    key: 'k:test',
    label: '测试',
    searchText: '测试',
    current: 0,
    yearStart: 0,
    samePeriod: 0,
    lastYearStart: 0,
    yoy: Number.NaN,
    ...partial,
  }
}

const sort = (key: SortState['key'], dir: SortState['dir'] = 'asc'): SortState => ({ key, dir })

describe('sortValue', () => {
  it('current/yearStart/samePeriod 直接取字段值', () => {
    const r = row({ current: 123.4, yearStart: 56.7, samePeriod: 89.1 })
    expect(sortValue(r, 'current')).toBe(123.4)
    expect(sortValue(r, 'yearStart')).toBe(56.7)
    expect(sortValue(r, 'samePeriod')).toBe(89.1)
  })

  it('vsYearStart 按 (本期-年初)/年初*100 计算', () => {
    expect(sortValue(row({ current: 110, yearStart: 100 }), 'vsYearStart')).toBe(10)
    expect(sortValue(row({ current: 80, yearStart: 100 }), 'vsYearStart')).toBeCloseTo(-20)
    // 负值口径（年初为负）不在此处处理，只验证公式
    expect(sortValue(row({ current: 0, yearStart: 0 }), 'vsYearStart')).toBeNaN()
  })

  it('vsYearStart 年初为 0 时返回 NaN（无口径恒置末尾）', () => {
    expect(sortValue(row({ current: 100, yearStart: 0 }), 'vsYearStart')).toBeNaN()
  })

  it('yoy 在同期间非零时直接返回行内 yoy', () => {
    expect(sortValue(row({ samePeriod: 100, yoy: 12.5 }), 'yoy')).toBe(12.5)
    // 行内 yoy 可能本身是 NaN（聚合行），同样透传
    expect(sortValue(row({ samePeriod: 100, yoy: Number.NaN }), 'yoy')).toBeNaN()
  })

  it('yoy 同期间为 0（无口径）时返回 NaN', () => {
    expect(sortValue(row({ samePeriod: 0, yoy: 12.5 }), 'yoy')).toBeNaN()
  })
})

describe('makeComparator', () => {
  it('升序：数值从小到大', () => {
    const rows = [
      row({ key: 'a', current: 30 }),
      row({ key: 'b', current: 10 }),
      row({ key: 'c', current: 20 }),
    ]
    const sorted = [...rows].sort(makeComparator(sort('current', 'asc')))
    expect(sorted.map((r) => r.key)).toEqual(['b', 'c', 'a'])
  })

  it('降序：数值从大到小', () => {
    const rows = [
      row({ key: 'a', current: 30 }),
      row({ key: 'b', current: 10 }),
      row({ key: 'c', current: 20 }),
    ]
    const sorted = [...rows].sort(makeComparator(sort('current', 'desc')))
    expect(sorted.map((r) => r.key)).toEqual(['a', 'c', 'b'])
  })

  it('NaN 恒置末尾：asc 时 NaN 排在最后', () => {
    const rows = [
      row({ key: 'nan', current: Number.NaN }),
      row({ key: 'b', current: 20 }),
      row({ key: 'a', current: 10 }),
    ]
    const sorted = [...rows].sort(makeComparator(sort('current', 'asc')))
    expect(sorted.map((r) => r.key)).toEqual(['a', 'b', 'nan'])
  })

  it('NaN 恒置末尾：desc 时 NaN 同样排在最后', () => {
    const rows = [
      row({ key: 'nan', current: Number.NaN }),
      row({ key: 'a', current: 10 }),
      row({ key: 'b', current: 20 }),
    ]
    const sorted = [...rows].sort(makeComparator(sort('current', 'desc')))
    expect(sorted.map((r) => r.key)).toEqual(['b', 'a', 'nan'])
  })

  it('双方均为 NaN 时视为相等，不交换', () => {
    const rows = [
      row({ key: 'n1', current: Number.NaN }),
      row({ key: 'n2', current: Number.NaN }),
    ]
    const sorted = [...rows].sort(makeComparator(sort('current', 'asc')))
    expect(sorted.map((r) => r.key)).toEqual(['n1', 'n2'])
  })

  it('派生键 vsYearStart 也遵循 NaN 置底', () => {
    const rows = [
      row({ key: 'no-base', current: 100, yearStart: 0 }),
      row({ key: 'grow', current: 120, yearStart: 100 }),
      row({ key: 'shrink', current: 80, yearStart: 100 }),
    ]
    const sorted = [...rows].sort(makeComparator(sort('vsYearStart', 'desc')))
    expect(sorted.map((r) => r.key)).toEqual(['grow', 'shrink', 'no-base'])
  })

  it('稳定性：相同取值保持输入原序（Array.sort 稳定依赖）', () => {
    const rows = [
      row({ key: 'x1', current: 10 }),
      row({ key: 'x2', current: 10 }),
      row({ key: 'low', current: 5 }),
      row({ key: 'x3', current: 10 }),
    ]
    const sorted = [...rows].sort(makeComparator(sort('current', 'asc')))
    expect(sorted.map((r) => r.key)).toEqual(['low', 'x1', 'x2', 'x3'])
    // desc 方向同样稳定
    const descSorted = [...rows].sort(makeComparator(sort('current', 'desc')))
    expect(descSorted.map((r) => r.key)).toEqual(['x1', 'x2', 'x3', 'low'])
  })

  it('不修改原数组（sort 调用方自行拷贝）', () => {
    const rows = [
      row({ key: 'a', current: 30 }),
      row({ key: 'b', current: 10 }),
    ]
    const copy = [...rows]
    copy.sort(makeComparator(sort('current', 'asc')))
    expect(rows.map((r) => r.key)).toEqual(['a', 'b'])
  })
})

describe('exportColumns', () => {
  it('company 维度：公司标识列 + 数值列', () => {
    const cols = exportColumns('company')
    expect(cols).toHaveLength(NUMERIC_EXPORT_COLUMNS.length + 1)
    expect(cols[0]).toEqual({ header: '公司', key: 'label', width: 24 })
    expect(cols.slice(1)).toEqual(NUMERIC_EXPORT_COLUMNS)
  })

  it('category 维度：品类标识列 + 数值列', () => {
    const cols = exportColumns('category')
    expect(cols).toHaveLength(NUMERIC_EXPORT_COLUMNS.length + 1)
    expect(cols[0]).toEqual({ header: '品类', key: 'label', width: 18 })
    expect(cols.slice(1)).toEqual(NUMERIC_EXPORT_COLUMNS)
  })

  it('detail 维度：公司 + 品类两列 + 数值列', () => {
    const cols = exportColumns('detail')
    expect(cols).toHaveLength(NUMERIC_EXPORT_COLUMNS.length + 2)
    expect(cols[0]).toEqual({ header: '公司', key: 'company', width: 24 })
    expect(cols[1]).toEqual({ header: '品类', key: 'category', width: 18 })
    expect(cols.slice(2)).toEqual(NUMERIC_EXPORT_COLUMNS)
  })

  it('三个维度共享同一份数值列定义（含表头文案）', () => {
    for (const dim of ['company', 'category', 'detail'] as const) {
      const headers = exportColumns(dim).map((c) => c.header)
      expect(headers).toContain('本期金额(万)')
      expect(headers).toContain('年初金额(万)')
      expect(headers).toContain('较年初')
      expect(headers).toContain('同期金额(万)')
      expect(headers).toContain('同比')
    }
  })
})

describe('formatDays', () => {
  it('正数格式化为一位小数 + 天', () => {
    expect(formatDays(12)).toBe('12.0 天')
    expect(formatDays(12.34)).toBe('12.3 天')
    expect(formatDays(0.05)).toBe('0.1 天')
  })

  it('0（无口径）显示为 -', () => {
    expect(formatDays(0)).toBe('-')
  })

  it('负数同样视为无口径显示为 -', () => {
    expect(formatDays(-5)).toBe('-')
    expect(formatDays(-0)).toBe('-')
  })
})

describe('round2', () => {
  it('金额两位小数舍入（避免二进制浮点边界值）', () => {
    expect(round2(12.25)).toBe(12.25) // 已是两位小数，原样返回
    expect(round2(12.34)).toBe(12.34)
    expect(round2(0.125)).toBe(0.13) // 进位
    expect(round2(0.124)).toBe(0.12) // 舍去
    expect(round2(-12.36)).toBe(-12.36)
  })
})

describe('常量', () => {
  it('EMPTY_ROWS 为空数组且为稳定引用', () => {
    expect(EMPTY_ROWS).toEqual([])
    expect(EMPTY_ROWS).toBe(EMPTY_ROWS)
  })

  it('NUMERIC_EXPORT_COLUMNS 五列数值口径齐备', () => {
    expect(NUMERIC_EXPORT_COLUMNS.map((c) => c.key)).toEqual([
      'current', 'yearStart', 'vsYearStart', 'samePeriod', 'yoy',
    ])
  })

  it('DIM_TITLES 三档标题齐全', () => {
    expect(DIM_TITLES).toEqual({
      company: '库存金额汇总 · 按公司',
      category: '库存金额汇总 · 按品类',
      detail: '公司 × 品类明细',
    })
    expect(Object.keys(DIM_TITLES)).toHaveLength(3)
  })

  it('DIM_EMPTY_TITLES 三档空态标题齐全', () => {
    expect(DIM_EMPTY_TITLES).toEqual({
      company: '暂无公司数据',
      category: '暂无品类数据',
      detail: '暂无存货数据',
    })
    expect(Object.keys(DIM_EMPTY_TITLES)).toHaveLength(3)
  })

  it('DIM_EMPTY_HINTS / DIM_REGION_LABELS / DIM_SEARCH_EMPTY_HINTS 三档齐全', () => {
    expect(Object.keys(DIM_EMPTY_HINTS)).toEqual(['company', 'category', 'detail'])
    expect(Object.keys(DIM_REGION_LABELS)).toEqual(['company', 'category', 'detail'])
    expect(Object.keys(DIM_SEARCH_EMPTY_HINTS)).toEqual(['company', 'category', 'detail'])
    for (const dim of ['company', 'category', 'detail'] as const) {
      expect(DIM_EMPTY_HINTS[dim]).toBeTruthy()
      expect(DIM_REGION_LABELS[dim]).toBeTruthy()
      expect(DIM_SEARCH_EMPTY_HINTS[dim]).toBeTruthy()
    }
  })
})
