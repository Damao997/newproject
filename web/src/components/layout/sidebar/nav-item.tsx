import { Link } from 'react-router-dom'
import type { NavItem } from '../nav-items'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { matchesNavPath } from '@/lib/nav-filter'
import { cn } from '@/lib/utils'
import { linkActive, linkBase, linkIcon, linkIdle } from './nav-shared'
import { useActivePath } from './use-active-path'

/**
 * 平铺菜单项（全部为叶子）：桌面展开态 / 桌面折叠态（仅图标 + Tooltip）/ 移动端共用。
 * activePath：父级（NavList）用 findActiveNavItem 计算的唯一激活项 path——嵌套路径
 * （如首页看板 /dashboard 与经营分析 /dashboard/analysis/key-metrics）需最长路径互斥；
 * 缺省时回退到自身边界匹配（独立使用场景）。
 */
export function NavLeafLink({
  item,
  activePath,
  collapsed = false,
  onNavigate,
}: {
  item: NavItem
  /** 当前唯一激活菜单项的 path（最长路径命中）；undefined 时回退自身边界匹配 */
  activePath?: string | null
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const pathname = useActivePath()
  const isActive =
    activePath !== undefined ? activePath === item.path : matchesNavPath(pathname, item)
  const link = (
    <Link
      to={item.path}
      onClick={onNavigate}
      className={cn(linkBase, isActive ? linkActive : linkIdle, collapsed && 'justify-center px-2')}
      aria-current={isActive ? 'page' : undefined}
    >
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
