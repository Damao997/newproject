import type { NavChild, NavItem } from '@/components/layout/nav-items'
import type { PermissionCode } from '@/lib/permissions'

/**
 * 导航树权限过滤（依据《安全与权限规范》§2.2 权限矩阵）。
 *
 * 规则（两级）：
 * - 二级 link 项：按完整权限码过滤（自身 permission 优先，缺省继承父级；一级项用自身 resource）
 * - 一级项：children 过滤后为空或自身无权限 → 整项隐藏
 *
 * 返回新对象（浅拷贝被过滤的层级），不修改入参。
 */
export function filterNavItems(items: readonly NavItem[], permissions: readonly string[]): NavItem[] {
  const result: NavItem[] = []
  for (const item of items) {
    if (item.children?.length) {
      // 目录项自身无权限时整项隐藏（防御：子项显式权限不能穿透无父权限的一级项）
      if (!permissions.includes(item.resource)) continue
      const children = filterNavChildren(item.children, permissions, item.resource)
      if (children.length > 0) result.push({ ...item, children })
    } else if (permissions.includes(item.resource)) {
      result.push(item)
    }
  }
  return result
}

function filterNavChildren(
  children: readonly NavChild[],
  permissions: readonly string[],
  inherited: PermissionCode,
): NavChild[] {
  const result: NavChild[] = []
  for (const child of children) {
    if (permissions.includes(child.permission ?? inherited)) {
      result.push(child)
    }
  }
  return result
}

/** 导航树节点最小形状（NavItem / NavChild 均满足） */
interface NavPathNode {
  path: string
  match?: readonly string[]
  children?: readonly NavChild[]
}

/**
 * 收集节点子树内的全部叶子路径（自身 path 在前、match 集合随后，Set 去重）。
 * 一级项归并子模块（如首页看板含 /indicators/*）后，激活匹配需基于叶子集合。
 */
export function collectNavPaths(item: NavPathNode): string[] {
  const pathsSet = new Set<string>()
  const walk = (node: NavPathNode) => {
    if (!node.children?.length) {
      pathsSet.add(node.path)
      for (const p of node.match ?? []) pathsSet.add(p)
      return
    }
    for (const child of node.children) walk(child)
  }
  walk(item)
  return [...pathsSet]
}

/**
 * 边界匹配：pathname 命中子树任一叶子路径（含叶子自身）时视为激活。
 * 带 '/' 边界的 startsWith 可防 /dashboard 误匹配 /dashboard2 类前缀。
 */
export function matchesNavPath(pathname: string, item: NavPathNode): boolean {
  return collectNavPaths(item).some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * 在二级菜单中匹配 pathname 对应的项（面包屑 / 侧边栏二级高亮共用口径）：
 * 命中 = 精确匹配自身 path / match 声明的子页 / 自身 path 的边界前缀
 * （如 /data/reclassify → /data/reclassify/consolidation）；
 * 多候选命中时取路径最长者（如 /reports/analyses 优先「单项分析」而非其前缀「汇总报告」），避免歧义双匹配。
 */
export function findBestNavChild(children: readonly NavChild[], pathname: string): NavChild | null {
  let best: NavChild | null = null
  for (const child of children) {
    const hit =
      pathname === child.path ||
      child.match?.includes(pathname) === true ||
      pathname.startsWith(child.path + '/')
    if (hit && (!best || child.path.length > best.path.length)) best = child
  }
  return best
}
