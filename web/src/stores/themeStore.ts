import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 品牌主题色 key：与 globals.css 的 :root[data-theme] 预设一一对应 */
export type ThemeKey = 'orange' | 'blue' | 'green' | 'violet'

/** 主题选项（Header 主题切换器渲染用；hex 色值见 lib/chart-theme.ts 的 THEME_PRESETS） */
export const THEME_OPTIONS: { key: ThemeKey; label: string }[] = [
  { key: 'orange', label: '品牌橙' },
  { key: 'blue', label: '睿智蓝' },
  { key: 'green', label: '翡翠绿' },
  { key: 'violet', label: '罗兰紫' },
]

/** 将主题写入 html[data-theme]，驱动 globals.css 主题块覆盖品牌 CSS 变量 */
function applyThemeAttribute(theme: ThemeKey) {
  document.documentElement.setAttribute('data-theme', theme)
}

interface ThemeState {
  theme: ThemeKey
  setTheme: (theme: ThemeKey) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'orange',
      setTheme: (theme) => {
        applyThemeAttribute(theme)
        set({ theme })
      },
    }),
    {
      name: 'brand-theme-storage',
      partialize: (state) => ({ theme: state.theme }),
    }
  )
)

// 模块加载即应用持久化主题（persist 同步恢复，getState 已含 localStorage 值）
applyThemeAttribute(useThemeStore.getState().theme)
