import {
  LayoutDashboard,
  LineChart,
  ChartPie,
  ArrowLeftRight,
  Package,
  FileText,
  Search,
  Upload,
  Shuffle,
  Layers,
  SlidersHorizontal,
  User,
  ShieldCheck,
  History,
  type LucideIcon,
} from 'lucide-react'
import type { PermissionCode } from '@/lib/permissions'

export interface NavItem {
  /** 菜单项完整路径（真实路由路径，指向模块默认子页） */
  path: string
  label: string
  icon: LucideIcon
  /** 完整权限码（resource:action），控制菜单项显隐 */
  resource: PermissionCode
  /** 所属分组 key（侧边栏按分组聚合渲染分组标题；与 navGroups 一一对应） */
  group: NavGroupKey
  /** 模块内非默认子页的完整路径集合（不含自身 path）：驱动侧边栏高亮与面包屑匹配。缺省仅按自身 path 边界前缀匹配 */
  match?: string[]
}

/** 侧边栏分组标识：与 NAV_GROUPS 一一对应（顺序决定渲染先后） */
export type NavGroupKey = 'data' | 'tools' | 'management' | 'system'

/** 侧边栏分组定义：title 用于渲染分组标题（uppercase + letter-spacing，参考 AntD ProLayout 风格） */
export const NAV_GROUPS: { key: NavGroupKey; title: string }[] = [
  { key: 'data', title: '主数据' },
  { key: 'tools', title: '业务工具' },
  { key: 'management', title: '数据管理' },
  { key: 'system', title: '系统' },
]

/**
 * 平铺一级菜单（参考图结构）：所有项均为叶子，无二级展开。
 * 高亮匹配：findActiveNavItem 按「自身 path + match 集合」边界前缀匹配，多候选取 path 最长者唯一激活
 * （嵌套路径互斥：/dashboard/analysis/* 命中「经营分析」而非前缀更短的「首页看板」）；
 * 仅「非自身前缀」的页内 Tab 路由需显式登记 match（如 /data/browse 归数据导入）。
 */
export const navItems: NavItem[] = [
  {
    path: '/dashboard',
    label: '首页看板',
    icon: LayoutDashboard,
    resource: 'dashboard:view',
    group: 'data',
  },
  {
    // 经营分析：7 个子页（关键指标表默认 / 现金流 / 应收·存货账龄 / 品类·主体预算 / 费用分析），
    // 子页由页内 Tab 切换；非 key-metrics 前缀的子路由由 match 归并高亮
    path: '/dashboard/analysis/key-metrics',
    label: '经营分析',
    icon: ChartPie,
    resource: 'dashboard:view',
    group: 'data',
    match: [
      '/dashboard/analysis/cash-flow',
      '/dashboard/analysis/receivable-aging',
      '/dashboard/analysis/inventory-aging',
      '/dashboard/analysis/category-budget',
      '/dashboard/analysis/subject-budget',
      '/dashboard/analysis/expense',
    ],
  },
  {
    path: '/indicators',
    label: '财务指标',
    icon: LineChart,
    resource: 'indicators:view',
    group: 'data',
  },
  {
    path: '/transactions/overview',
    label: '往来分析',
    icon: ArrowLeftRight,
    resource: 'transactions:view',
    group: 'data',
    match: [
      '/transactions/aging',
      '/transactions/account-filter',
      '/transactions/coverage',
      '/transactions/collections/plans',
      '/transactions/collections/salesmen',
    ],
  },
  { path: '/inventory', label: '存货管理', icon: Package, resource: 'inventory:view', group: 'data' },
  { path: '/reports', label: '分析报告', icon: FileText, resource: 'reports:view', group: 'data' },
  {
    path: '/tools/enterprise-lookup',
    label: '企业信息查询',
    icon: Search,
    resource: 'tools:view',
    group: 'tools',
  },
  {
    // 页内 Tab：导入管理（默认）/ 数据预览（/data/browse）
    path: '/data/import',
    label: '数据导入',
    icon: Upload,
    resource: 'data:browse:view',
    group: 'management',
    match: ['/data/browse'],
  },
  {
    // 页内 Tab：单体公司调整（默认）/ 汇总主体调整（/data/reclassify/consolidation 由前缀覆盖）
    path: '/data/reclassify',
    label: '重分类管理',
    icon: Shuffle,
    resource: 'data:browse:view',
    group: 'management',
  },
  {
    // 页内 Tab：经营分析科目（默认）/ 静态科目 / 主体管理 / 汇总主体映射 / 公式维护
    path: '/data/dimensions/operating',
    label: '维度管理',
    icon: Layers,
    resource: 'data:browse:view',
    group: 'management',
    match: ['/data/dimensions/static', '/data/dimensions/company', '/data/dimensions/summary', '/data/dimensions/formulas'],
  },
  {
    // 页内 Tab：品类配置（默认）/ 运营费用映射 / 主体配置 / 月度预算比例 / 产品配置
    path: '/data/board/category',
    label: '映射管理',
    icon: SlidersHorizontal,
    resource: 'data:browse:view',
    group: 'management',
    match: ['/data/board/expense', '/data/board/subject', '/data/board/budget-ratio', '/data/board/product'],
  },
  { path: '/admin/users', label: '用户管理', icon: User, resource: 'admin:users:view', group: 'system' },
  {
    // 独立权限码：finance_analyst_it 等仅持 admin:users 的角色不显示角色权限入口（避免菜单穿透）
    path: '/admin/roles',
    label: '角色权限',
    icon: ShieldCheck,
    resource: 'admin:roles:view',
    group: 'system',
  },
  {
    path: '/admin/audit-logs',
    label: '审计日志',
    icon: History,
    resource: 'admin:users:view',
    group: 'system',
  },
]
