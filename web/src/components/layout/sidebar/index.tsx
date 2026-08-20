import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getCurrentVersion } from '@/lib/app-version'
import { NavList } from './nav-list'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onMobileClose: () => void
}

function SidebarBrand({ collapsed, className }: { collapsed: boolean; className?: string }) {
  return (
    <Link
      to="/dashboard"
      className={cn(
        'flex h-14 shrink-0 items-center gap-2 px-4',
        collapsed && 'justify-center px-2',
        className
      )}
    >
      <img src="/logo.png" alt="壹品慧" className="h-7 w-7 object-contain" />
      {!collapsed && (
        <span className="truncate text-sm font-bold tracking-tight text-sidebar-brand-fg">浙江壹品慧经营分析平台</span>
      )}
    </Link>
  )
}

/** 移动端抽屉：遮罩 + 左侧面板；Escape 关闭 + 初始焦点到关闭按钮（与全站抽屉/对话框行为对齐） */
function MobileDrawer({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // 初始焦点移到关闭按钮，键盘用户可直接 Escape 关闭
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // Escape 关闭（与 Dialog 行为一致）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="absolute inset-y-0 left-0 flex w-60 flex-col bg-sidebar-bg shadow-lg animate-in slide-in-from-left duration-200">
        <div className="flex items-center justify-between pr-2">
          <SidebarBrand collapsed={false} />
          <Button
            ref={closeRef}
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-sidebar-fg/60"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <NavList collapsed={false} onNavigate={onClose} variant="mobile" />
      </aside>
    </div>
  )
}

export function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onMobileClose }: SidebarProps) {
  return (
    <TooltipProvider delayDuration={0}>
      {/* 桌面端侧边栏：独立列从页面顶部开始渲染（覆盖 Header 高度区域），全高贴边；右侧上下圆角与页面卡片一致（rounded-r-card 8px），左侧直角 */}
      <aside
        className={cn(
          'relative hidden shrink-0 flex-col overflow-hidden rounded-r-card border-r border-sidebar-border bg-sidebar-bg transition-[width] duration-200 ease-brand md:flex',
          collapsed ? 'w-16' : 'w-60'
        )}
      >
        <SidebarBrand collapsed={collapsed} />
        <NavList collapsed={collapsed} />
        <div className={cn('shrink-0 p-2', collapsed && 'flex justify-center')}>
          {/* 当前部署版本（部署脚本注入 meta app-version；开发环境显示 dev） */}
          {!collapsed && (
            <p className="mb-1 px-2 text-[11px] text-sidebar-fg">版本 {getCurrentVersion()}</p>
          )}
        </div>
        {/* 折叠条：右缘透明按钮（仅箭头图标，三风格自适应）；展开态箭头半透明，hover 转选中色；收起态箭头选中色常驻 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
              onClick={onToggleCollapse}
              className="group absolute inset-y-0 right-0 z-10 flex w-6 items-center justify-center"
            >
              {collapsed ? (
                <ChevronsRight className="h-4 w-4 shrink-0 text-sidebar-selected-fg transition-transform group-hover:scale-110" />
              ) : (
                <ChevronsLeft className="h-4 w-4 shrink-0 text-sidebar-fg/60 transition-colors group-hover:text-sidebar-selected-fg" />
              )}
            </button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">展开侧边栏</TooltipContent>}
        </Tooltip>
      </aside>

      {/* 移动端抽屉 */}
      {mobileOpen && <MobileDrawer onClose={onMobileClose} />}
    </TooltipProvider>
  )
}
