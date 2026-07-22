import { describe, it, expect } from 'vitest'
import {
  formatMoney,
  formatMoneyWan,
  formatPercent,
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
  it('将小数转换为百分比字符串', () => {
    expect(formatPercent(0.1234)).toBe('12.34%')
  })

  it('处理整数百分比', () => {
    expect(formatPercent(1)).toBe('100.00%')
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
