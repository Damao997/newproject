import { Link, useLocation } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { navItems } from './nav-items'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onMobileClose: () => void
}

interface NavListProps {
  collapsed: boolean
  onNavigate?: () => void
}

function NavList({ collapsed, onNavigate }: NavListProps) {
  const location = useLocation()
  const { permissions } = usePermission()

  // 依据《安全与权限规范》§2.2，仅展示当前角色有 view 权限的模块入口
  const visibleNavItems = navItems.filter((item) => permissions.includes(item.resource))

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
      {visibleNavItems.map((item) => {
        const Icon = item.icon
        const isActive = location.pathname.startsWith(item.path)
        const link = (
          <Link
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={cn(
              'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              collapsed && 'justify-center px-2'
            )}
          >
            {isActive && (
              <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-primary" />
            )}
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        )
        if (!collapsed) return link
        return (
          <Tooltip key={item.path}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </nav>
  )
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
        <span className="truncate text-sm font-bold">浙江壹品慧经营分析平台</span>
      )}
    </Link>
  )
}

export function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onMobileClose }: SidebarProps) {
  return (
    <TooltipProvider delayDuration={0}>
      {/* 桌面端侧边栏 */}
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r bg-background transition-[width] duration-200 md:flex',
          collapsed ? 'w-16' : 'w-60'
        )}
      >
        <SidebarBrand collapsed={collapsed} className="border-b" />
        <NavList collapsed={collapsed} />
        <div className={cn('shrink-0 border-t p-2', collapsed && 'flex justify-center')}>
          <Button
            variant="ghost"
            size="sm"
            className={cn('text-muted-foreground', collapsed ? 'w-auto px-2' : 'w-full justify-start')}
            onClick={onToggleCollapse}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronsLeft className="mr-2 h-4 w-4" />
                <span>收起侧边栏</span>
              </>
            )}
          </Button>
        </div>
      </aside>

      {/* 移动端抽屉 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onMobileClose} />
          <aside className="absolute inset-y-0 left-0 flex w-60 flex-col border-r bg-background shadow-lg animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between border-b pr-2">
              <SidebarBrand collapsed={false} />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={onMobileClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <NavList collapsed={false} onNavigate={onMobileClose} />
          </aside>
        </div>
      )}
    </TooltipProvider>
  )
}
