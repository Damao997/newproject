import { SIDEBAR_STYLE_OPTIONS, useThemeStore } from '@/stores/themeStore'
import { SIDEBAR_PRESETS } from '@/lib/chart-theme'
import { cn } from '@/lib/utils'

/**
 * Header 风格切换器：三色点横向平铺（无文字），点击直接切换侧边栏风格（浅色/深紫/深色），
 * 写入 html[data-sidebar]，由 globals.css 风格块覆盖 CSS 变量（侧边栏色板 + 主页面交互色跟随）；
 * 选中项深色描边标识，hex 取自 chart-theme.ts 的 SIDEBAR_PRESETS（全仓唯一 hex 来源）。
 */
export function ThemeSwitcher() {
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const setSidebarStyle = useThemeStore((s) => s.setSidebarStyle)

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="侧边栏风格">
      {SIDEBAR_STYLE_OPTIONS.map((opt) => {
        const active = sidebarStyle === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            aria-label={opt.label}
            aria-pressed={active}
            title={opt.label}
            onClick={() => setSidebarStyle(opt.key)}
            className={cn(
              'h-4 w-4 rounded-full border transition-transform duration-150 hover:scale-110',
              active ? 'border-foreground' : 'border-border'
            )}
            style={{ backgroundColor: SIDEBAR_PRESETS[opt.key].primary }}
          />
        )
      })}
    </div>
  )
}
