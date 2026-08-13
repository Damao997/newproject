import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SIDEBAR_STYLE_OPTIONS, useThemeStore, type SidebarStyle } from '@/stores/themeStore'
import { SIDEBAR_PRESETS } from '@/lib/chart-theme'

/**
 * 当前风格圆点的背景样式（hex 取自 chart-theme.ts 的 SIDEBAR_PRESETS，全仓唯一 hex 来源）；
 * 浅色=白底橙描边、靛蓝=深靛蓝圆、深色=深灰圆。
 */
function styleDot(style: SidebarStyle): React.CSSProperties {
  return { backgroundColor: SIDEBAR_PRESETS[style].primary }
}

/**
 * Header 风格切换器：侧边栏风格 3 选 1（浅色 / 紫渐变 / 深色），写入 html[data-sidebar]，
 * 由 globals.css 风格块覆盖 CSS 变量（侧边栏色板 + 主页面交互色跟随），全站组件即时生效；
 * ECharts 序列主色与 antd token 经各自组件监听 themeStore 同步。
 */
export function ThemeSwitcher() {
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const setSidebarStyle = useThemeStore((s) => s.setSidebarStyle)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="切换侧边栏风格" title="侧边栏风格">
          {/* 当前风格圆点：浅色=白底橙描边 / 靛蓝=深靛蓝 / 深色=深灰，灰描边在白色顶栏上清晰可辨 */}
          <span
            className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 shadow-sm"
            style={styleDot(sidebarStyle)}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">侧边栏风格</div>
        <DropdownMenuSeparator />
        {SIDEBAR_STYLE_OPTIONS.map((opt) => {
          const active = sidebarStyle === opt.key
          return (
            <DropdownMenuItem
              key={opt.key}
              onClick={() => setSidebarStyle(opt.key)}
              className="justify-between"
              aria-checked={active}
            >
              <span className="flex items-center gap-2">
                {/* 色块圆点：取自 chart-theme.ts hex 镜像（全仓唯一 hex 来源），不受当前风格影响 */}
                <span
                  className="h-3.5 w-3.5 rounded-full border border-border"
                  style={styleDot(opt.key)}
                />
                {opt.label}
              </span>
              {active && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
