import { describe, it, expect } from 'vitest'
import {
  formatMoney,
  formatMoneyWan,
  formatWan,
  formatPercent,
  formatQuantity,
  formatMetricValue,
  getChangeColor,
  getChangePrefix,
} from '@/lib/utils'

describe('formatMoney', () => {
  it('保留两位小数并追加“万”后缀', () => {
    expect(formatMoney(1234.5)).toBe('1,234.50 万')
  })

  it('处理零值：统一显示 -', () => {
    expect(formatMoney(0)).toBe('-')
    // -0 与 0 等价，同样显示 -
    expect(formatMoney(-0)).toBe('-')
  })

  it('处理负值', () => {
    expect(formatMoney(-88.1)).toBe('-88.10 万')
  })
})

describe('formatMoneyWan', () => {
  it('保留两位小数且不带后缀', () => {
    expect(formatMoneyWan(1234.5)).toBe('1,234.50')
  })

  it('零值显示 -', () => {
    expect(formatMoneyWan(0)).toBe('-')
  })
})

describe('formatWan', () => {
  it('元换算为万元（/10000）并保留两位小数千分位', () => {
    // 12,345,000 元 → 1,234.50 万
    expect(formatWan(12345000)).toBe('1,234.50')
    expect(formatWan(50000)).toBe('5.00')
  })

  it('零值显示 -（与 formatMoneyWan 口径一致）', () => {
    expect(formatWan(0)).toBe('-')
  })

  it('负值正确换算', () => {
    expect(formatWan(-881000)).toBe('-88.10')
  })
})

describe('formatPercent', () => {
  it('将小数转换为百分比字符串（保留 1 位小数）', () => {
    expect(formatPercent(0.1234)).toBe('12.3%')
    expect(formatPercent(0.235)).toBe('23.5%')
  })

  it('处理整数百分比', () => {
    expect(formatPercent(1)).toBe('100.0%')
  })

  it('零值显示 -', () => {
    expect(formatPercent(0)).toBe('-')
  })
})

describe('formatQuantity', () => {
  it('千分位整数，不带小数', () => {
    expect(formatQuantity(12345.67)).toBe('12,346')
    expect(formatQuantity(3)).toBe('3')
  })

  it('零值显示 -', () => {
    expect(formatQuantity(0)).toBe('-')
  })
})

describe('formatMetricValue', () => {
  it('金额（缺省/amount）千分位两位小数', () => {
    expect(formatMetricValue(1234.5)).toBe('1,234.50')
    expect(formatMetricValue(1234.5, 'amount')).toBe('1,234.50')
  })

  it('数量整数', () => {
    expect(formatMetricValue(3, 'quantity')).toBe('3')
  })

  it('比率百分比（1 位小数）', () => {
    expect(formatMetricValue(0.235, 'ratio')).toBe('23.5%')
  })

  it('零值显示 -（金额/数量/比率均一致）', () => {
    expect(formatMetricValue(0)).toBe('-')
    expect(formatMetricValue(0, 'amount')).toBe('-')
    expect(formatMetricValue(0, 'quantity')).toBe('-')
    expect(formatMetricValue(0, 'ratio')).toBe('-')
  })
})

describe('getChangeColor', () => {
  it('正值为红（涨）', () => {
    expect(getChangeColor(0.1)).toBe('text-finance-red')
  })

  it('负值为绿（跌）', () => {
    expect(getChangeColor(-0.1)).toBe('text-finance-green')
  })

  it('零值为灰', () => {
    expect(getChangeColor(0)).toBe('text-muted-foreground')
  })
})

describe('getChangePrefix', () => {
  it('正值带 + 前缀', () => {
    expect(getChangePrefix(0.1)).toBe('+')
  })

  it('非正值无前缀', () => {
    expect(getChangePrefix(-0.1)).toBe('')
    expect(getChangePrefix(0)).toBe('')
  })
})
