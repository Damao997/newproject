import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 全局公司简称显示状态：由公司管理面板的「显示简称」开关写入，
 * 数据浏览/往来分析/报告等所有展示公司名称的 UI 组件跟随该开关切换简称。
 */
interface CompanyDisplayState {
  showShortName: boolean
  setShowShortName: (v: boolean) => void
}

export const useCompanyDisplayStore = create<CompanyDisplayState>()(
  persist(
    (set) => ({
      showShortName: false,
      setShowShortName: (showShortName) => set({ showShortName }),
    }),
    {
      name: 'company-display-storage',
      partialize: (state) => ({ showShortName: state.showShortName }),
    }
  )
)
