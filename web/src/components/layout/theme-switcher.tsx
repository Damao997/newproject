import { Palette, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { THEME_OPTIONS, useThemeStore } from '@/stores/themeStore'
import { THEME_PRESETS } from '@/lib/chart-theme'

/**
 * Header 品牌主题色切换器：选择后写入 html[data-theme]，
 * 由 globals.css 主题块覆盖品牌 CSS 变量，全站组件即时生效；
 * ECharts 序列主色与 antd token 经各自组件监听 themeStore 同步。
 */
export function ThemeSwitcher() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="切换主题颜色" title="主题颜色">
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">主题颜色</div>
        <DropdownMenuSeparator />
        {THEME_OPTIONS.map((opt) => {
          const active = theme === opt.key
          return (
            <DropdownMenuItem
              key={opt.key}
              onClick={() => setTheme(opt.key)}
              className="justify-between"
              aria-checked={active}
            >
              <span className="flex items-center gap-2">
                {/* 色板圆点：取自 chart-theme.ts hex 镜像（全仓唯一 hex 来源），不受当前主题影响 */}
                <span
                  className="h-3.5 w-3.5 rounded-full border border-border"
                  style={{ backgroundColor: THEME_PRESETS[opt.key].primary }}
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
