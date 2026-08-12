import { useMemo } from 'react'
import { Link, useInRouterContext, useLocation } from 'react-router-dom'
import { navItems, type NavChild } from './nav-items'

interface Crumb {
  label: string
  path: string
  /** 叶子项（可点击跳转）；目录项仅作层级分组，不可点击 */
  leaf: boolean
}

/** 递归匹配当前 URL 在导航树中的路径链（单一数据源，与侧边栏 nav-items 保持一致） */
function findCrumbPath(items: NavChild[], currentUrl: string): Crumb[] | null {
  for (const item of items) {
    if (item.children?.length) {
      const sub = findCrumbPath(item.children, currentUrl)
      if (sub) return [{ label: item.label, path: item.path, leaf: false }, ...sub]
    } else if (item.path === currentUrl) {
      return [{ label: item.label, path: item.path, leaf: true }]
    }
  }
  return null
}

/**
 * 面包屑导航：按当前 pathname + search 从导航树推导路径链，链首固定「首页」根。
 * 仅当含首页后层级 ≥3（如 首页 / 数据管理 / 维度/科目体系 / 经营分析科目）时渲染，
 * 单级/双级页面无层级困惑，不展示面包屑。
 * 非 Router 上下文（如单测渲染 PageContainer）时安全降级为不渲染。
 */
export function Breadcrumb() {
  const inRouter = useInRouterContext()
  if (!inRouter) return null
  return <BreadcrumbInner />
}

function BreadcrumbInner() {
  const location = useLocation()
  const currentUrl = location.pathname + location.search
  const crumbs = useMemo(() => {
    const chain = findCrumbPath(navItems, currentUrl)
    if (!chain) return null
    // 链首固定「首页」根；首页自身页面（已含 /dashboard 项）不重复插入
    if (chain.some((c) => c.path === '/dashboard')) return chain
    return [{ label: '首页', path: '/dashboard', leaf: true }, ...chain]
  }, [currentUrl])

  if (!crumbs || crumbs.length < 3) return null

  return (
    <nav aria-label="面包屑" className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={`${crumb.path}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground/60">/</span>}
            {isLast ? (
              <span className="font-medium text-foreground">{crumb.label}</span>
            ) : crumb.leaf ? (
              <Link to={crumb.path} className="transition-colors hover:text-foreground">
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
