import { create } from 'zustand'
import { usePreferencesStore } from './preferencesStore'
/** 原有简称接口保留，设置统一由账号偏好管理。 */
export const useCompanyDisplayStore = create<{ showShortName: boolean; setShowShortName: (value: boolean) => void }>(() => ({
  showShortName: usePreferencesStore.getState().preferences.showShortName,
  setShowShortName: showShortName => usePreferencesStore.getState().patch({ showShortName }),
}))
usePreferencesStore.subscribe(state => useCompanyDisplayStore.setState({ showShortName: state.preferences.showShortName }))
