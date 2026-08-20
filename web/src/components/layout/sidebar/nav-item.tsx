import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import type { NavItem } from '../nav-items'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { matchesNavPath } from '@/lib/nav-filter'
import { cn } from '@/lib/utils'
import { NavSubList } from './nav-sub-list'
import { ActiveBar, linkActive, linkBase, linkIcon, linkIdle } from './nav-shared'
import { useActivePath } from './use-active-path'

/** 一级叶子项（无子菜单）：桌面展开态 / 桌面折叠态（仅图标 + Tooltip）/ 移动端共用 */
export function NavLeafLink({
  item,
  collapsed = false,
  onNavigate,
}: {
  item: NavItem
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const pathname = useActivePath()
  // 叶子项激活：边界匹配自身路径（防 /inventory2 类前缀误匹配）
  const isActive = matchesNavPath(pathname, item)
  const link = (
    <Link
      to={item.path}
      onClick={onNavigate}
      className={cn(linkBase, isActive ? linkActive : linkIdle, collapsed && 'justify-center px-2')}
    >
      {isActive && <ActiveBar />}
      <item.icon className={linkIcon} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * 一级目录项（有子菜单）：点击直接跳转首个二级子项（权限过滤后恒存在的默认页），无需手动展开选择；
 * 手风琴展开态由激活路径自动跟随（nav-list 按 activeGroupPath 驱动）。
 * 桌面展开态与移动端抽屉共用（原 DesktopInlineNavItem / MobileNavItem 渲染一致，已合并）。
 * 一级项保留 ChevronDown 旋转指示（仅指示展开态）；子项无箭头。
 */
export function NavItemRow({
  item,
  expanded,
  onNavigate,
}: {
  item: NavItem
  expanded: boolean
  onNavigate?: () => void
}) {
  const pathname = useActivePath()
  const navigate = useNavigate()
  const Icon = item.icon
  // 目录项激活：子树内任一叶子命中即高亮（支持指标归并等跨路径归组）
  const isActive = matchesNavPath(pathname, item)
  // 首个二级子项（filterNavItems 保证 children 非空）：点击一级项直达默认子页
  const defaultPath = item.children?.[0]?.path ?? item.path

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          navigate(defaultPath)
          onNavigate?.()
        }}
        className={cn(linkBase, 'w-full bg-transparent text-left', isActive ? linkActive : linkIdle)}
      >
        {isActive && <ActiveBar />}
        <Icon className={linkIcon} />
        <span className="truncate">{item.label}</span>
        <ChevronDown
          className={cn(
            'ml-auto h-3.5 w-3.5 shrink-0 text-sidebar-fg/60 transition-transform duration-150',
            expanded && 'rotate-180'
          )}
        />
      </button>
      {expanded && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-100">
          <NavSubList items={item.children!} onNavigate={onNavigate} onSurface="sidebar" />
        </div>
      )}
    </div>
  )
}
