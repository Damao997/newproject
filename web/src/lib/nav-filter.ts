import type { NavItem } from '@/components/layout/nav-items'

/**
 * 导航权限过滤（依据《安全与权限规范》§2.2 权限矩阵）：
 * 平铺一级菜单，逐项按完整权限码过滤，无权限的项不渲染。
 * 返回新数组（过滤视图），不修改入参。
 */
export function filterNavItems(items: readonly NavItem[], permissions: readonly string[]): NavItem[] {
  return items.filter((item) => permissions.includes(item.resource))
}

/** 导航节点最小形状（NavItem 满足） */
interface NavPathNode {
  path: string
  match?: readonly string[]
}

/**
 * 收集节点激活路径集合（自身 path 在前、match 集合随后，Set 去重）。
 * 页内 Tab 等非自身前缀的子路由通过 match 登记归并到所属菜单项。
 */
export function collectNavPaths(item: NavPathNode): string[] {
  const pathsSet = new Set<string>([item.path])
  for (const p of item.match ?? []) pathsSet.add(p)
  return [...pathsSet]
}

/**
 * 边界匹配：pathname 命中节点激活路径集合任一路径时视为激活。
 * 带 '/' 边界的 startsWith 可防 /dashboard 误匹配 /dashboard2 类前缀。
 */
export function matchesNavPath(pathname: string, item: NavPathNode): boolean {
  return collectNavPaths(item).some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * 唯一激活项：在命中项中取 path 最长者（与原 findBestNavChild 同口径的多候选消歧）。
 * 解决嵌套路径互斥：如 /dashboard/analysis/key-metrics 同时命中「首页看板」（/dashboard 前缀）
 * 与「经营分析」（自身 path），取最长者保证仅「经营分析」高亮。
 */
export function findActiveNavItem<T extends NavPathNode>(items: readonly T[], pathname: string): T | null {
  let best: T | null = null
  for (const item of items) {
    if (!matchesNavPath(pathname, item)) continue
    if (!best || item.path.length > best.path.length) best = item
  }
  return best
}
