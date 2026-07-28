import { describe, it, expect } from 'vitest'
import {
  formatMoney,
  formatMoneyWan,
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

  it('处理零值', () => {
    expect(formatMoney(0)).toBe('0.00 万')
  })

  it('处理负值', () => {
    expect(formatMoney(-88.1)).toBe('-88.10 万')
  })
})

describe('formatMoneyWan', () => {
  it('保留两位小数且不带后缀', () => {
    expect(formatMoneyWan(1234.5)).toBe('1,234.50')
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
})

describe('formatQuantity', () => {
  it('千分位整数，不带小数', () => {
    expect(formatQuantity(12345.67)).toBe('12,346')
    expect(formatQuantity(3)).toBe('3')
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
})

describe('getChangeColor', () => {
  it('正值为红（涨）', () => {
    expect(getChangeColor(0.1)).toBe('text-finance-red')
  })

  it('负值为绿（跌）', () => {
    expect(getChangeColor(-0.1)).toBe('text-finance-green')
  })

  it('零值为灰', () => {
    expect(getChangeColor(0)).toBe('text-gray-500')
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
