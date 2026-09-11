import { useCallback, useEffect, useMemo, useRef } from 'react'
import { message } from 'antd'
import { useCompanies, useAvailablePeriods } from '@/hooks/api-queries'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'

/**
 * 首页看板 / 经营分析共享的主体 + 期间筛选逻辑：
 * - 期间：读全局 periodStore.period（Header PeriodPill 唯一入口；null = 仅选财年未选月份 → 跟随最新期），
 *   pageStateStore.dashboard.period 停止读取（类型定义保留，旧键留存无害）；
 * - 主体维度：dimFilter（all / company:CODE / summary:CODE）保留页面内，并与全局公司口径（periodStore.companyCodes）
 *   双向联动——全局公司变化时页面内 dimFilter 自动对齐（全局优先）；页面内切换 dimFilter 时回写全局公司集合，
 *   保证跨页口径一致（Header CompanyPill 同步显示）。全局未选（null/[]）时页面内对齐「全部主体」；
 * - 单主体降级：看板查询接口（getDashboardOverview 等）公司参数均为 `companyCode?: string` 单主体形态，
 *   全局选中多家公司时取第一个并以 antd message 轻提示（同一集合仅提示一次）。
 * 返回用于顶部筛选条渲染与请求参数解析的折叠结果。
 */
export function useDashboardFilters() {
  const setDashboard = usePageStore((s) => s.setDashboard)
  const dimFilter = usePageStore((s) => s.dashboard.dim)

  // 全局口径：期间 + 公司（Header PeriodPill / CompanyPill 唯一入口）
  const globalPeriod = usePeriodStore((s) => s.period)
  const globalCompanyCodes = usePeriodStore((s) => s.companyCodes)
  const setCompanyCodes = usePeriodStore((s) => s.setCompanyCodes)
  // 全局未选期间（null = 仅选财年未选月份）→ '' 跟随最新期的既有语义
  const selectedPeriod = globalPeriod ?? ''

  // 页面内主体维度切换：更新 dim 的同时回写全局公司集合（'all' → 清空为全部公司）
  const setDimFilter = useCallback(
    (v: string) => {
      setDashboard({ dim: v })
      if (v === 'all') setCompanyCodes(null)
      else if (v.startsWith('company:') || v.startsWith('summary:')) setCompanyCodes([v.slice(v.indexOf(':') + 1)])
    },
    [setDashboard, setCompanyCodes],
  )

  // 期间候选：可用期间按全局选中财年过滤（仅用于「跟随最新期」回退计算，不再提供页面内期间下拉）
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const { data: periodsData } = useAvailablePeriods()
  const periodOptions = useMemo(
    () => filterPeriodsByFiscalYear(periodsData?.periods ?? [], fiscalYear, periodsData?.fiscalStartMonth ?? 1),
    [periodsData, fiscalYear],
  )

  // 主体维度候选：公司主数据（联动对齐 + 显示名解析）
  const { data: companies } = useCompanies()
  const companyCode = dimFilter.startsWith('company:')
    ? dimFilter.slice('company:'.length)
    : dimFilter.startsWith('summary:')
      ? dimFilter.slice('summary:'.length)
      : undefined

  // 全局公司口径 → 页面内主体维度联动（全局优先）；dimFilter 读写经 getState 直取，避免 effect 依赖循环
  const globalKey = globalCompanyCodes && globalCompanyCodes.length > 0 ? globalCompanyCodes.join(',') : ''
  const lastNoticeKey = useRef('')
  useEffect(() => {
    if (!companies) return
    const cur = usePageStore.getState().dashboard.dim
    if (!globalCompanyCodes || globalCompanyCodes.length === 0) {
      // 全局未选（全部公司）→ 页面内对齐「全部主体」
      if (cur !== 'all') setDashboard({ dim: 'all' })
      return
    }
    const code = globalCompanyCodes[0]
    const type = companies.find((c) => c.code === code)?.type
    // 公司已从主数据移除（越权/删除）时回退全部主体，避免以无效主体发起请求
    const desired = type === 'summary' ? `summary:${code}` : type === 'entity' ? `company:${code}` : 'all'
    if (cur !== desired) setDashboard({ dim: desired })
    if (globalCompanyCodes.length > 1 && lastNoticeKey.current !== globalKey) {
      lastNoticeKey.current = globalKey
      message.info('看板仅支持单主体口径，已应用首个选择')
    }
    // globalKey 为内容级依赖（集合内容变化才触发联动/提示）；globalCompanyCodes 在 globalKey 变化的同一渲染周期内取到最新值，
    // companies 变化时经幂等对齐（cur !== desired 才写入）不会造成循环
  }, [globalKey, companies, setDashboard])

  // 当前主体显示名（顶部筛选解析；全局口径下与 dimFilter 解析结果一致）
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
    periodOptions,
    companyCode,
    currentSubjectName,
  }
}
