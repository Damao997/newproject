import { useMemo } from 'react'
import { Link, useInRouterContext, useLocation } from 'react-router-dom'
import { navItems, type NavItem } from './nav-items'
import { findActiveNavItem } from '@/lib/nav-filter'
import { cn } from '@/lib/utils'

interface Crumb {
  label: string
  path: string
  /** 叶子项（可点击跳转）；目录项仅作层级分组，不可点击 */
  leaf: boolean
}

/**
 * 匹配当前 pathname 在导航树中的路径链（单一数据源，与侧边栏 nav-items 保持一致；忽略 query，筛选参数不吞面包屑）。
 * 平铺一级菜单：叶子项按「自身 path + match」边界前缀匹配，嵌套路径取最长命中（唯一激活项口径与侧边栏一致）。
 */
function findCrumbPath(items: readonly NavItem[], pathname: string): Crumb[] | null {
  const item = findActiveNavItem(items, pathname)
  return item ? [{ label: item.label, path: item.path, leaf: true }] : null
}

/**
 * 面包屑导航：按当前 pathname + search 从导航树推导路径链，链首固定「首页」根。
 * 平铺一级菜单后典型链为「首页 / 一级」2 段；按「恢复面包屑显示」决议：
 * - 即便只有一段也渲染（首页/总览等独立页也展示层级标识，便于用户随时确认当前位置）
 * - 未知路径（不在导航树）不渲染
 * singleLine：顶栏场景单行显示（固定高度内不换行，超长截断）；默认换行。
 * 非 Router 上下文（如单测渲染 PageContainer）时安全降级为不渲染。
 */
export function Breadcrumb({ singleLine = false }: { singleLine?: boolean }) {
  const inRouter = useInRouterContext()
  if (!inRouter) return null
  return <BreadcrumbInner singleLine={singleLine} />
}

function BreadcrumbInner({ singleLine }: { singleLine: boolean }) {
  const location = useLocation()
  const pathname = location.pathname
  const crumbs = useMemo(() => {
    const chain = findCrumbPath(navItems, pathname)
    if (!chain) return null
    // 链首固定「首页」根；首页自身页面（已含 /dashboard 项）不重复插入
    if (chain.some((c) => c.path === '/dashboard')) return chain
    return [{ label: '首页', path: '/dashboard', leaf: true }, ...chain]
  }, [pathname])

  if (!crumbs) return null

  return (
    <nav
      aria-label="面包屑"
      className={cn(
        'flex items-center gap-1.5 text-sm text-muted-foreground',
        singleLine ? 'min-w-0 overflow-hidden whitespace-nowrap' : 'flex-wrap'
      )}
    >
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={`${crumb.path}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground/60">/</span>}
            {isLast ? (
              <span className="font-medium text-foreground">{crumb.label}</span>
            ) : crumb.leaf ? (
              <Link to={crumb.path} className="transition-colors hover:text-primary">
                {crumb.label}
              </Link>
            ) : (
              <span>{crumb.label}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
