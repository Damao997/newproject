import { describe, expect, it } from 'vitest'
import { aggregateCustomerRows } from '../receivable-aging-content'
import type { AgingAnalysisRow } from '@/types'

/** 构造 aging counterparty 行（公司×客商粒度）的简写工厂 */
function mk(counterpartyCode: string, counterpartyName: string, closingBalance: number, companyCode = 'EN330059'): AgingAnalysisRow {
  return {
    companyCode,
    companyName: companyCode,
    transactionType: '应收账款',
    counterpartyCode,
    counterpartyName,
    closingBalance,
    aging: {},
  }
}

describe('aggregateCustomerRows（客户应收余额聚合）', () => {
  it('跨公司同客商合并求和并按余额倒序', () => {
    const rows = [
      mk('CP001', '客户A', 100, 'EN330059'),
      mk('CP002', '客户B', 300, 'EN330059'),
      mk('CP001', '客户A', 50, 'EN330060'),
    ]
    const result = aggregateCustomerRows(rows)
    expect(result).toEqual([
      { code: 'CP002', name: '客户B', balance: 300 },
      { code: 'CP001', name: '客户A', balance: 150 },
    ])
  })

  it('counterpartyCode 缺失时兜底名称作为编码与标识', () => {
    const rows = [
      mk('', '客户C', 80),
      mk('', '客户C', 20),
    ]
    const result = aggregateCustomerRows(rows)
    expect(result).toEqual([{ code: '客户C', name: '客户C', balance: 100 }])
  })

  it('编码与名称均缺失的行被跳过', () => {
    const rows = [mk('', '', 100), mk('CP001', '客户A', 10)]
    const result = aggregateCustomerRows(rows)
    expect(result).toEqual([{ code: 'CP001', name: '客户A', balance: 10 }])
  })

  it('浮点求和保留 2 位小数', () => {
    const rows = [mk('CP001', '客户A', 10.1), mk('CP001', '客户A', 20.2)]
    const result = aggregateCustomerRows(rows)
    expect(result[0].balance).toBe(30.3)
  })

  it('空数组返回空列表', () => {
    expect(aggregateCustomerRows([])).toEqual([])
  })
})
