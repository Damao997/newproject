import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 侧边栏风格 key：与 globals.css 的 :root[data-sidebar] 预设一一对应（浅色 / 紫渐变 / 深色） */
export type SidebarStyle = 'light' | 'gradient' | 'dark'

/** 全部合法风格 key（持久化恢复时枚举校验用，非法值回退默认） */
export const SIDEBAR_STYLE_KEYS: readonly SidebarStyle[] = ['light', 'gradient', 'dark']

/** 风格选项（Header 风格切换器渲染用；hex 色值见 lib/chart-theme.ts 的 SIDEBAR_PRESETS） */
export const SIDEBAR_STYLE_OPTIONS: { key: SidebarStyle; label: string }[] = [
  { key: 'light', label: '浅色' },
  { key: 'gradient', label: '靛蓝' },
  { key: 'dark', label: '深色' },
]

/**
 * 将侧边栏风格写入 html[data-sidebar]，驱动 globals.css 风格块覆盖 CSS 变量
 * （侧边栏色板 + 主页面交互色跟随）；主页面恒白，不再写 data-theme 与 html.dark。
 */
function applySidebarStyle(style: SidebarStyle) {
  document.documentElement.setAttribute('data-sidebar', style)
}

interface ThemeState {
  sidebarStyle: SidebarStyle
  setSidebarStyle: (style: SidebarStyle) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      sidebarStyle: 'light',
      setSidebarStyle: (style) => {
        applySidebarStyle(style)
        set({ sidebarStyle: style })
      },
    }),
    {
      name: 'sidebar-style-storage',
      partialize: (state) => ({ sidebarStyle: state.sidebarStyle }),
      // 持久化恢复归一化：风格不在合法枚举内（旧版本残留/手动改动）时回退默认
      merge: (persisted, current) => {
        const p = persisted as Partial<ThemeState> | undefined
        const sidebarStyle: SidebarStyle =
          p?.sidebarStyle && SIDEBAR_STYLE_KEYS.includes(p.sidebarStyle as SidebarStyle)
            ? (p.sidebarStyle as SidebarStyle)
            : current.sidebarStyle
        return { ...current, ...(p ?? {}), sidebarStyle }
      },
    }
  )
)

// 模块加载即应用持久化风格（persist 同步恢复，getState 已含 localStorage 值）
applySidebarStyle(useThemeStore.getState().sidebarStyle)
