import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 全局财年选择状态：由顶部导航栏的财年选择器写入，
 * 看板/指标/数据浏览的期间下拉按选中财年过滤可用期间。
 * null 表示不过滤（全部财年）。
 */
interface PeriodState {
  fiscalYear: string | null
  setFiscalYear: (fy: string | null) => void
}

export const usePeriodStore = create<PeriodState>()(
  persist(
    (set) => ({
      fiscalYear: null,
      setFiscalYear: (fiscalYear) => set({ fiscalYear }),
    }),
    {
      name: 'period-storage',
      partialize: (state) => ({ fiscalYear: state.fiscalYear }),
    }
  )
)

/** 按选中财年过滤期间列表（fiscalYears 与 periods 均来自 available-periods 接口） */
export function filterPeriodsByFiscalYear(
  periods: string[],
  fiscalYear: string | null,
  fiscalStartMonth: number,
): string[] {
  if (!fiscalYear) return periods
  const startYear = Number(fiscalYear.replace(/^FY/, ''))
  if (!Number.isFinite(startYear)) return periods
  return periods.filter((p) => {
    const [y, m] = p.split('-').map(Number)
    const fyStart = m >= fiscalStartMonth ? y : y - 1
    return fyStart === startYear
  })
}
