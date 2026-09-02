import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 全局筛选状态（期间 + 公司）：由顶部 PeriodPill / CompanyPill 写入，
 * 看板/指标/数据浏览等页面读取后驱动请求参数与期间候选过滤。
 * - fiscalYear：选中财年（'FY2025' 这种格式）；null 为未初始化/无数据时的过渡态（header 会自动归一化为最新财年）。
 * - period：选中期间，格式 'YYYY-MM'（如 '2026-08'）；null 表示仅选财年未选月份（页面侧下拉仍按财年过滤）。
 *   切换财年时若当前 period 不再属于新财年候选，自动回退到该财年最新月份。
 * - companyCodes：已选公司编码列表；null = 全部公司的明确语义（未筛选），空数组语义等价（均为不筛选）。
 */
interface PeriodState {
  fiscalYear: string | null
  period: string | null
  companyCodes: string[] | null
  setFiscalYear: (fy: string | null) => void
  setPeriod: (period: string | null) => void
  setCompanyCodes: (codes: string[] | null) => void
}

export const usePeriodStore = create<PeriodState>()(
  persist(
    (set) => ({
      fiscalYear: null,
      period: null,
      companyCodes: null,
      setFiscalYear: (fiscalYear) => set({ fiscalYear }),
      setPeriod: (period) => set({ period }),
      setCompanyCodes: (companyCodes) => set({ companyCodes }),
    }),
    {
      name: 'period-storage',
      partialize: (state) => ({
        fiscalYear: state.fiscalYear,
        period: state.period,
        companyCodes: state.companyCodes,
      }),
    }
  )
)

/** 按选中财年过滤期间列表（fiscalYears 与 periods 均来自 available-periods 接口） */
export function filterPeriodsByFiscalYear(
  periods: string[],
  fiscalYear: string | null,
  fiscalStartMonth: number,
): string[] {
  // 兜底：财年尚未归一化（数据未加载/无 active 批次）时不过滤，避免过渡态下期间候选为空
  if (!fiscalYear) return periods
  const startYear = Number(fiscalYear.replace(/^FY/, ''))
  if (!Number.isFinite(startYear)) return periods
  return periods.filter((p) => {
    const [y, m] = p.split('-').map(Number)
    const fyStart = m >= fiscalStartMonth ? y : y - 1
    return fyStart === startYear
  })
}
