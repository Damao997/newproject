import { useMemo } from 'react'
import { useCompanies } from '@/hooks/api-queries'
import { useCompanyDisplayStore } from '@/stores/companyDisplayStore'
import type { Company } from '@/types'

/** 获取公司显示名称：启用简称且有简称时显示简称，否则显示完整名称 */
export function getCompanyDisplayName(company: Company, useShortName: boolean): string {
  if (useShortName && company.shortName) return company.shortName
  return company.name
}

/**
 * 公司显示名统一入口：跟随全局「显示简称」开关，
 * 提供 code -> 显示名 的映射与兜底查询函数，供所有展示公司名称的组件复用。
 */
export function useCompanyDisplayName() {
  const showShortName = useCompanyDisplayStore((s) => s.showShortName)
  const { data: companies } = useCompanies()

  const displayNameMap = useMemo(
    () => new Map((companies ?? []).map((c) => [c.code, getCompanyDisplayName(c, showShortName)])),
    [companies, showShortName],
  )

  const getDisplayName = useMemo(
    () => (code: string, fallback?: string | null): string =>
      displayNameMap.get(code) ?? fallback ?? code,
    [displayNameMap],
  )

  return { showShortName, displayNameMap, getDisplayName }
}
