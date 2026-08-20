import { Link } from 'react-router-dom'
import type { NavChild } from '../nav-items'
import { findBestNavChild } from '@/lib/nav-filter'
import { cn } from '@/lib/utils'
import { ActiveBar } from './nav-shared'
import { useActivePath } from './use-active-path'

/**
 * 二级菜单列表（导航两级化后仅此一层）：
 * - 叶子项：普通 Link；
 * - 高亮：findBestNavChild 口径（精确 / match / 边界前缀，多候选取路径最长者，唯一高亮）；
 * - onSurface：'sidebar' = 侧边栏内联（使用侧边栏前景色系），'popover' = 白底弹层（深色文字）。
 */
export function NavSubList({
  items,
  onNavigate,
  onSurface = 'popover',
}: {
  items: NavChild[]
  onNavigate?: () => void
  onSurface?: 'sidebar' | 'popover'
}) {
  const pathname = useActivePath()
  // 全局最优命中项（唯一高亮）：与面包屑 findCrumbPath 同口径
  const best = findBestNavChild(items, pathname)
  const leafIdleCls =
    onSurface === 'sidebar'
      ? 'text-sidebar-fg/80 hover:bg-sidebar-selected-bg/40 hover:text-sidebar-fg'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'

  return (
    <div className="mt-1 space-y-1">
      {items.map((child) => {
        const isActive = child === best
        return (
          <Link
            key={child.path}
            to={child.path}
            onClick={onNavigate}
            className={cn(
              'relative flex items-center rounded-md py-1.5 pl-9 pr-3 text-sm font-medium transition-colors duration-150',
              isActive ? 'font-medium text-sidebar-selected-fg' : leafIdleCls
            )}
          >
            {isActive && <ActiveBar />}
            <span className="pl-1.5">{child.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
