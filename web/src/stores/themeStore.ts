import { create } from 'zustand'
import { usePreferencesStore } from './preferencesStore'
import { APP_THEMES, APP_STYLE_KEYS, normalizeStyle, type AppStyle } from '@/lib/app-theme'

/** 保留旧接口与持久化键，将侧栏风格升级为完整的全站风格。 */
export type SidebarStyle = AppStyle
export const SIDEBAR_STYLE_KEYS = APP_STYLE_KEYS
export const SIDEBAR_STYLE_OPTIONS = APP_STYLE_KEYS.map((key) => ({ key, label: APP_THEMES[key].label }))
let themeAnimTimer: ReturnType<typeof setTimeout> | undefined

export function applySidebarStyle(style: SidebarStyle, animate = false) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.setAttribute('data-theme-anim', '')
    if (themeAnimTimer) clearTimeout(themeAnimTimer)
    themeAnimTimer = setTimeout(() => root.removeAttribute('data-theme-anim'), 250)
  }
  root.setAttribute('data-sidebar', style)
  root.classList.toggle('dark', style === 'dark')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', APP_THEMES[style].page)
}
interface ThemeState {
  sidebarStyle: SidebarStyle
  printing: boolean
  setSidebarStyle: (style: SidebarStyle) => void
}

const themeFacade = create<ThemeState>(() => ({
  sidebarStyle: typeof document === 'undefined' ? usePreferencesStore.getState().preferences.theme : normalizeStyle(document.documentElement.dataset.sidebar), printing: false,
  setSidebarStyle: value => {
    const style = normalizeStyle(value)
    usePreferencesStore.getState().patch({ theme: style })
    if (!usePreferencesStore.getState().accountId) localStorage.setItem('sidebar-style-storage', JSON.stringify({ state: { sidebarStyle: style }, version: 0 }))
  },
}))
export const useThemeStore = Object.assign(themeFacade, { persist: {
  rehydrate: async () => {
    if (usePreferencesStore.getState().accountId) return
    let style: unknown
    try { style = JSON.parse(localStorage.getItem('sidebar-style-storage') || '{}').state?.sidebarStyle } catch { console.error('旧主题缓存无效') }
    usePreferencesStore.getState().patch({ theme: normalizeStyle(style) })
    themeFacade.setState({ printing: false })
  },
} })
usePreferencesStore.subscribe(state => {
  const style = state.preferences.theme
  if (useThemeStore.getState().sidebarStyle !== style) { useThemeStore.setState({ sidebarStyle: style }); applySidebarStyle(style, true) }
})
applySidebarStyle(useThemeStore.getState().sidebarStyle)
