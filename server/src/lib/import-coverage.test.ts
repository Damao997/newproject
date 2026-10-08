import { describe, expect, it } from 'vitest'
import { companyPeriodsOf, operatingCoverageWhere, staticCoverageWhere } from './import-coverage'

describe('导入公司月份范围', () => {
  it('保留实际组合并去重，不产生公司和月份的交叉组合', () => {
    const keys = companyPeriodsOf([{ companyCode: 'A', period: '2026-08' }, { companyCode: 'B', period: '2026-09' }, { companyCode: 'A', period: '2026-08' }])
    expect(operatingCoverageWhere(keys)).toEqual({ OR: [{ companyCode: 'A', period: '2026-08' }, { companyCode: 'B', period: '2026-09' }] })
  })
  it('同月不同日期归一，静态范围使用半开自然月，兼容跨年', () => {
    const keys = companyPeriodsOf([{ companyCode: 'A', snapshotDate: new Date('2026-12-01Z') }, { companyCode: 'A', snapshotDate: new Date('2026-12-31Z') }])
    expect(staticCoverageWhere(keys)).toEqual({ OR: [{ companyCode: 'A', snapshotDate: { gte: new Date('2026-12-01Z'), lt: new Date('2027-01-01Z') } }] })
  })
  it('空组合明确不匹配任何旧数据', () => {
    expect(operatingCoverageWhere([])).toEqual({ OR: [] })
    expect(staticCoverageWhere([])).toEqual({ OR: [] })
  })
})
