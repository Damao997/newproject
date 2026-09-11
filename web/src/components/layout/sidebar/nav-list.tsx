import { useMemo } from 'react'
import { usePermission } from '@/hooks/usePermission'
import { NAV_GROUPS, navItems } from '../nav-items'
import { filterNavItems, findActiveNavItem } from '@/lib/nav-filter'
import { NavLeafLink } from './nav-item'
import { useActivePath } from './use-active-path'

interface NavListProps {
  collapsed: boolean
  onNavigate?: () => void
  /** desktop / mobile（抽屉内联列表）；平铺菜单下两形态渲染一致，仅 collapsed 由父级传入 */
  variant?: 'desktop' | 'mobile'
}

/** 平铺一级菜单：按 NAV_GROUPS 分组聚合渲染，组间留白、组内紧凑（对齐参考图） */
export function NavList({ collapsed, onNavigate }: NavListProps) {
  const pathname = useActivePath()
  const { permissions } = usePermission()

  // 依据《安全与权限规范》§2.2，仅展示当前角色有 view 权限的模块入口
  const visibleNavItems = useMemo(() => filterNavItems(navItems, permissions), [permissions])
  // 唯一激活项（最长路径命中，嵌套路径互斥：/dashboard/analysis/* 高亮经营分析而非首页看板）
  const activePath = useMemo(
    () => findActiveNavItem(visibleNavItems, pathname)?.path ?? null,
    [visibleNavItems, pathname]
  )

  // 按 NAV_GROUPS 顺序分组聚合可见项：跳过空分组（无可见项的不渲染标题），折叠态下隐藏分组标题避免与单列图标冲突
  const groupedItems = useMemo(() => {
    if (collapsed) return null
    return NAV_GROUPS
      .map((g) => ({
        group: g,
        items: visibleNavItems.filter((i) => i.group === g.key),
      }))
      .filter((s) => s.items.length > 0)
  }, [visibleNavItems, collapsed])

  // 折叠态保持扁平渲染（仅图标 + Tooltip），分组标题隐藏
  if (collapsed || !groupedItems) {
    return (
      <nav className="sidebar-scroll flex-1 space-y-1 overflow-y-auto px-2 py-3 font-sans">
        {visibleNavItems.length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-sidebar-fg/70">当前角色无可用模块</p>
        ) : (
          visibleNavItems.map((item) => (
            <NavLeafLink key={item.path} item={item} activePath={activePath} collapsed onNavigate={onNavigate} />
          ))
        )}
      </nav>
    )
  }

  return (
    <nav className="sidebar-scroll flex-1 space-y-2 overflow-y-auto px-2 py-3 font-sans">
      {groupedItems.length === 0 ? (
        <p className="px-2 py-3 text-center text-sm text-sidebar-fg/70">当前角色无可用模块</p>
      ) : (
        groupedItems.map(({ group, items }) => (
          <div key={group.key} className="space-y-0.5">
            <p
              className="px-3 pb-1 pt-2 text-xs uppercase tracking-[1px] text-sidebar-fg/55"
              aria-label={group.title}
            >
              {group.title}
            </p>
            {items.map((item) => (
              <NavLeafLink key={item.path} item={item} activePath={activePath} onNavigate={onNavigate} />
            ))}
          </div>
        ))
      )}
    </nav>
  )
}
