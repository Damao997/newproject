import { Link } from 'react-router-dom'
import { Drawer } from 'antd'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NavList } from './nav-list'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onMobileClose: () => void
}
function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link to="/dashboard" aria-label="浙江壹品慧经营分析平台首页" className={cn('sidebar-brand flex h-14 shrink-0 items-center gap-3 px-5', collapsed && 'justify-center px-2')}>
      <img src="/logo.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
      {!collapsed && <span className="min-w-0"><span className="block text-base font-semibold tracking-wide text-sidebar-brand-fg">浙江壹品慧</span><span className="block text-xs text-sidebar-fg">经营分析平台</span></span>}
    </Link>
  )
}

/** 桌面与移动端共享导航；移动抽屉由 Ant Design 管理焦点、遮罩和退出。 */
export function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onMobileClose }: SidebarProps) {
  return (
    <>
      <aside className={cn('app-sidebar hidden shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar-bg transition-[width] duration-200 ease-brand md:flex', collapsed ? 'w-16' : 'w-[232px]')}>
        <SidebarBrand collapsed={collapsed} />
        <NavList collapsed={collapsed} />
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <button type="button" aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'} onClick={onToggleCollapse} className={cn('flex h-8 w-full items-center gap-3 rounded px-2 text-xs text-sidebar-fg transition-colors hover:bg-sidebar-selected-bg', collapsed && 'justify-center px-0')}>
            {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <><PanelLeftClose className="h-4 w-4" aria-hidden /><span>收起导航</span></>}
          </button>
        </div>
      </aside>
      <Drawer
        open={mobileOpen}
        onClose={onMobileClose}
        placement="left"
        width={272}
        closable={false}
        title={<SidebarBrand collapsed={false} />}
        extra={<Button variant="ghost" size="icon" aria-label="关闭导航菜单" className="text-sidebar-fg" onClick={onMobileClose}><X className="h-4 w-4" /></Button>}
        rootClassName="navigation-drawer"
        styles={{ content: { background: 'hsl(var(--sidebar-bg))' }, header: { padding: '0 8px 0 0', borderBottom: '1px solid hsl(var(--sidebar-border))' }, body: { padding: 0, display: 'flex', minHeight: 0 } }}
      >
        <NavList collapsed={false} onNavigate={onMobileClose} variant="mobile" />
      </Drawer>
    </>
  )
}
