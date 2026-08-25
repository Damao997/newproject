import { useCallback, useEffect, useMemo } from 'react'
import { useCompanies, useAvailablePeriods } from '@/hooks/api-queries'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'

/**
 * 首页看板 / 经营分析共享的主体 + 期间筛选逻辑：
 * - 状态均持久化于 pageStateStore.dashboard（路由切换/刷新后恢复，两处口径连续）；
 * - 主体：all / company:CODE / summary:CODE 三态格式，'' = 自动模式（由后端按权限选择）；
 * - 自动对齐：无选或编码已删除/越权时回退默认主体（ET0001 → 首个汇总 → 首个单体）；
 * - 期间：可用期间按全局选中财年过滤，财年切换后已选期间不在候选内回退最新期。
 * 返回用于顶部筛选条渲染与请求参数解析的折叠结果。
 */
export function useDashboardFilters() {
  const setDashboard = usePageStore((s) => s.setDashboard)
  const selectedPeriod = usePageStore((s) => s.dashboard.period)
  const dimFilter = usePageStore((s) => s.dashboard.dim)

  const setSelectedPeriod = useCallback((v: string) => setDashboard({ period: v }), [setDashboard])
  const setDimFilter = useCallback((v: string) => setDashboard({ dim: v }), [setDashboard])

  // 期间候选：可用期间按全局选中财年过滤；未选时后端默认取最新期
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const { data: periodsData } = useAvailablePeriods()
  const periodOptions = useMemo(
    () => filterPeriodsByFiscalYear(periodsData?.periods ?? [], fiscalYear, periodsData?.fiscalStartMonth ?? 1),
    [periodsData, fiscalYear],
  )
  // 财年切换后已选期间不在候选内时回退默认（最新期）
  useEffect(() => {
    if (selectedPeriod && !periodOptions.includes(selectedPeriod)) setSelectedPeriod('')
  }, [periodOptions, selectedPeriod, setSelectedPeriod])

  // 主体维度候选：公司 / 汇总主体分组
  const { data: companies } = useCompanies()
  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  const summaryEntities = useMemo(() => (companies ?? []).filter((c) => c.type === 'summary'), [companies])
  const companyCode = dimFilter.startsWith('company:')
    ? dimFilter.slice('company:'.length)
    : dimFilter.startsWith('summary:')
      ? dimFilter.slice('summary:'.length)
      : undefined

  // 自动模式主体对齐 + 持久化主体校验：无选或编码已删除/越权时回退默认主体；
  // useCompanies 已按数据权限过滤（与后端同源：ET0001 → 首个汇总 → 首个单体），避免以越权主体发起请求
  useEffect(() => {
    if (!companies || companies.length === 0) return
    const valid = new Set(companies.map((c) => c.code))
    const fallback = () => {
      const et0001 = summaryEntities.find((c) => c.code === 'ET0001')
      if (et0001) return `summary:${et0001.code}`
      if (summaryEntities[0]) return `summary:${summaryEntities[0].code}`
      if (entityCompanies[0]) return `company:${entityCompanies[0].code}`
      return 'all'
    }
    const cur = usePageStore.getState().dashboard.dim
    if (cur === '') {
      setDimFilter(fallback())
      return
    }
    if (cur === 'all') return
    const code = cur.includes(':') ? cur.split(':')[1] : undefined
    if (!code || !valid.has(code)) setDimFilter(fallback())
  }, [dimFilter, companies, summaryEntities, entityCompanies, setDimFilter])

  // 当前主体显示名（顶部筛选解析；自动模式下用后端返回的实际生效主体，由父级传入）
  const currentSubjectName = useMemo(() => {
    if (dimFilter === '') return '全部主体'
    const code = companyCode
    if (!code) return '全部主体'
    const match = (companies ?? []).find((c) => c.code === code)
    return match?.name ?? code
  }, [dimFilter, companyCode, companies])

  return {
    dimFilter,
    setDimFilter,
    selectedPeriod,
    setSelectedPeriod,
    periodOptions,
    companyCode,
    currentSubjectName,
  }
}
