import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { usePeriodStore } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'
import { claimLegacyStorage, setStorageAccount } from '@/stores/account-storage'
import { api } from '@/lib/api'
import { DEFAULT_PREFERENCES, preferenceSchema, type PreferenceSnapshot } from '@/lib/personal-settings'
import { applySidebarStyle } from '@/stores/themeStore'

function readLegacy() {
  const read = (key: string) => { try { return JSON.parse(localStorage.getItem(key) || '{}').state ?? {} } catch { return {} } }
  return preferenceSchema.parse({ ...DEFAULT_PREFERENCES, theme: read('sidebar-style-storage').sidebarStyle || 'light',
    showShortName: !!read('company-display-storage').showShortName, sidebarCollapsed: localStorage.getItem('sidebar-collapsed') === 'true',
    indicatorDensity: read('page-state-storage').indicators?.density || 'default' })
}
export function AccountBoundary({ children }: { children: ReactNode }) {
  const user = useAuthStore(s => s.user)
  const userId = user?.id
  const mustChangePassword = user?.mustChangePassword
  const client = useQueryClient()
  const [loaded, setLoaded] = useState<string | null>(null)
  const theme = usePreferencesStore(s => s.preferences.theme)
  useEffect(() => { applySidebarStyle(theme, true) }, [theme])
  useEffect(() => {
    if (!userId) return
    let active = true
    let started = false
    client.clear()
    const inherited = claimLegacyStorage(userId)
    setStorageAccount(null)
    usePeriodStore.setState(usePeriodStore.getInitialState())
    usePageStore.setState(usePageStore.getInitialState())
    setStorageAccount(userId)
    void usePeriodStore.persist.rehydrate()
    void usePageStore.persist.rehydrate()
    let cached: PreferenceSnapshot = { preferences: DEFAULT_PREFERENCES, revision: 0 }
    try {
      const saved = JSON.parse(localStorage.getItem('personal-preferences:' + userId) || 'null')
      if (saved) cached = { preferences: preferenceSchema.parse(saved.preferences), revision: saved.revision }
      else if (inherited) cached.preferences = readLegacy()
    } catch { console.error('个人偏好缓存无效，已使用默认设置') }
    usePreferencesStore.setState({ ...cached, accountId: userId, ready: false, error: null, saving: false })
    const install = (snapshot: PreferenceSnapshot) => {
      if (!active) return
      usePreferencesStore.getState().install(userId, snapshot)
      if (!started) {
        const preferences = snapshot.preferences
        if (preferences.companyStartup !== 'remember') usePeriodStore.getState().setCompanyCodes(preferences.companyStartup === 'fixed' ? preferences.defaultCompanies : null)
        usePreferencesStore.setState({ latestPending: preferences.periodStartup === 'latest' })
        started = true
      }
      setLoaded(userId)
    }
    const refresh = async (first = false) => {
      if (mustChangePassword) { install(cached); return }
      try {
        const profile = await api.getProfile()
        if (!active) return
        if (profile?.id === userId) {
          const current = useAuthStore.getState().user
          const scopeChanged = current?.dataScope !== profile.dataScope || JSON.stringify(current?.permissions) !== JSON.stringify(profile.permissions)
          // 详细联系方式仅留在资料查询；身份缓存只更新公开字段。
          const { id, username, name, role, permissions, dataScope, status, mustChangePassword: force, createdAt, updatedAt, avatarVersion } = profile
          useAuthStore.getState().updateUser({ id, username, name, role, permissions, dataScope, status, mustChangePassword: force, createdAt, updatedAt, avatarVersion })
          if (scopeChanged) void client.resetQueries({ predicate: query => query.queryKey[0] !== 'auth' })
          if (force) { install(cached); return }
        }
        let snapshot = await api.getPreferences()
        if (!active) return
        if (first && inherited && snapshot.revision === 0 && !localStorage.getItem('preferences-migrated:' + userId)) {
          snapshot = await api.updatePreferences({ revision: 0, changes: cached.preferences })
          localStorage.setItem('preferences-migrated:' + userId, 'true')
        }
        snapshot = { preferences: preferenceSchema.parse(snapshot.preferences), revision: snapshot.revision }
        install(snapshot)
      } catch (cause) {
        if (!active) return
        if (!started) install(cached)
        usePreferencesStore.setState({ error: cause instanceof Error ? cause.message : '设置加载失败，请重试' })
      }
    }
    void refresh(true)
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { active = false; window.removeEventListener('focus', onFocus); client.clear(); setStorageAccount(null); usePreferencesStore.setState({ accountId: null, ready: false }) }
  }, [userId, mustChangePassword, client]) // 同一账号修改资料不重新应用启动策略。
  return loaded === user?.id ? children : <div role="status" className="p-6 text-sm text-muted-foreground">正在恢复你的工作台…</div>
}
