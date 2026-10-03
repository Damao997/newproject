import { message } from 'antd'
import { create } from 'zustand'
import { api } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { DEFAULT_PREFERENCES, type PersonalPreferences, type PreferenceSnapshot } from '@/lib/personal-settings'
import { useAuthStore } from './authStore'

interface State extends PreferenceSnapshot {
  accountId: string | null; ready: boolean; error: string | null; saving: boolean; latestPending: boolean
  install: (accountId: string, snapshot: PreferenceSnapshot) => void
  save: (changes: Partial<PersonalPreferences>, revision?: number) => Promise<PreferenceSnapshot>
  patch: (changes: Partial<PersonalPreferences>) => void
}
export const usePreferencesStore = create<State>((set, get) => ({
  preferences: DEFAULT_PREFERENCES, revision: 0, accountId: null, ready: false, error: null, saving: false, latestPending: false,
  install: (accountId, snapshot) => {
    if (useAuthStore.getState().user?.id !== accountId || (get().accountId === accountId && snapshot.revision < get().revision)) return
    set({ ...snapshot, accountId, ready: true, error: null })
    localStorage.setItem('personal-preferences:' + accountId, JSON.stringify(snapshot))
  },
  save: async (changes, revision = get().revision) => {
    if (get().saving) throw new Error('设置正在保存，请稍候')
    const id = get().accountId
    if (!id || useAuthStore.getState().user?.id !== id) throw new Error('请重新登录')
    set({ saving: true, error: null })
    try {
      const snapshot = await api.updatePreferences({ changes, revision })
      if (useAuthStore.getState().user?.id === id) get().install(id, snapshot)
      return snapshot
    } catch (cause) {
      if (get().accountId === id) set({ error: cause instanceof Error ? cause.message : '设置保存失败，请重试' })
      throw cause
    } finally { if (get().accountId === id) set({ saving: false }) }
  },
  patch: changes => { if (!get().accountId) { set({ preferences: { ...get().preferences, ...changes } }); return }
    void get().save(changes).catch(cause => {
    // 快捷入口回退至已保存设置，409 不自动覆盖远端。
    message.error(cause instanceof Error ? cause.message : '设置保存失败，请重试')
    if (!(cause instanceof ApiError)) console.error('个人偏好快捷保存失败')
  }) },
}))
