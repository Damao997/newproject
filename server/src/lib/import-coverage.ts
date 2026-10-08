import type { Prisma } from '@prisma/client'

/** 三类月度报表的最小替换单元；科目不在键内，同公司整月替换。 */
export interface CompanyPeriod {
  companyCode: string
  period: string
}

export function companyPeriodKey(key: CompanyPeriod): string {
  return key.companyCode + '|' + key.period
}

/** 仅使用实际数据行形成组合，不能将公司集合和月份集合交叉组合。 */
export function companyPeriodsOf(rows: readonly (CompanyPeriod | { companyCode: string; snapshotDate: Date })[]): CompanyPeriod[] {
  const keys = new Map<string, CompanyPeriod>()
  for (const row of rows) {
    const period = 'period' in row ? row.period : row.snapshotDate.toISOString().slice(0, 7)
    const key = { companyCode: row.companyCode, period }
    keys.set(companyPeriodKey(key), key)
  }
  return [...keys.values()].sort((a, b) => companyPeriodKey(a).localeCompare(companyPeriodKey(b)))
}

export function operatingCoverageWhere(keys: CompanyPeriod[]): Prisma.FactOperatingWhereInput {
  return { OR: keys.map(({ companyCode, period }) => ({ companyCode, period })) }
}

/** 静态表按 UTC 自然月匹配，兼容同月不同快照日期。空组合返回 OR:[]，不会全表匹配。 */
export function staticCoverageWhere(keys: CompanyPeriod[]): Prisma.FactStaticWhereInput {
  return { OR: keys.map(({ companyCode, period }) => {
    const [year, month] = period.split('-').map(Number)
    return { companyCode, snapshotDate: { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) } }
  }) }
}
