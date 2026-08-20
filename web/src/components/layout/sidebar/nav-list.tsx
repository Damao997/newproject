import { useEffect, useMemo, useState } from 'react'
import { usePermission } from '@/hooks/usePermission'
import { navItems } from '../nav-items'
import { filterNavItems, matchesNavPath } from '@/lib/nav-filter'
import { cn } from '@/lib/utils'
import { DesktopNavDropdown } from './desktop-dropdown'
import { NavItemRow, NavLeafLink } from './nav-item'
import { useActivePath } from './use-active-path'

interface NavListProps {
  collapsed: boolean
  onNavigate?: () => void
  /** desktop：折叠态点击弹层 / 展开态内联手风琴；mobile：抽屉内联列表 */
  variant?: 'desktop' | 'mobile'
}

export function NavList({ collapsed, onNavigate, variant = 'desktop' }: NavListProps) {
  const pathname = useActivePath()
  const { permissions } = usePermission()

  // 依据《安全与权限规范》§2.2，逐层过滤仅展示当前角色有 view 权限的模块入口（子级缺省继承一级权限码）
  const visibleNavItems = useMemo(() => filterNavItems(navItems, permissions), [permissions])
  // 当前激活的含子菜单一级项（子树叶子边界匹配，忽略 query；支持指标归并等跨路径归组）
  const activeGroupPath = useMemo(
    () => visibleNavItems.find((i) => i.children?.length && matchesNavPath(pathname, i))?.path ?? null,
    [visibleNavItems, pathname]
  )

  // 内联手风琴：当前展开的一级项（单开，由激活路径自动跟随；点击一级项直接跳转默认子页，无需手动展开）
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  // 折叠态弹出面板：当前打开的一级项（单开）
  const [openPanelPath, setOpenPanelPath] = useState<string | null>(null)

  // 路由跟随：仅按 pathname（query 筛选变化不重置用户展开态）；导航到其他模块时内联展开组自动切换，折叠面板关闭
  useEffect(() => {
    setExpandedPath(activeGroupPath)
    setOpenPanelPath(null)
  }, [activeGroupPath, pathname])

  const togglePanel = (path: string) => setOpenPanelPath((prev) => (prev === path ? null : path))

  return (
    <nav className="sidebar-scroll flex-1 space-y-1 overflow-y-auto px-2 py-3 font-sans">
      {visibleNavItems.length === 0 ? (
        <p className={cn('px-2 py-3 text-center text-sm text-sidebar-fg/70', collapsed && 'text-xs')}>
          {collapsed ? '无' : '当前角色无可用模块'}
        </p>
      ) : (
        visibleNavItems.map((item) => {
          if (item.children?.length) {
            return variant === 'mobile' ? (
              <NavItemRow
                key={item.path}
                item={item}
                expanded={expandedPath === item.path}
                onNavigate={onNavigate}
              />
            ) : collapsed ? (
              <DesktopNavDropdown
                key={item.path}
                item={item}
                open={openPanelPath === item.path}
                onToggle={() => togglePanel(item.path)}
                onNavigate={onNavigate}
              />
            ) : (
              <NavItemRow
                key={item.path}
                item={item}
                expanded={expandedPath === item.path}
                onNavigate={onNavigate}
              />
            )
          }
          return (
            <NavLeafLink
              key={item.path}
              item={item}
              collapsed={variant === 'mobile' ? false : collapsed}
              onNavigate={onNavigate}
            />
          )
        })
      )}
    </nav>
  )
}
