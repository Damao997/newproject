import {
  LayoutDashboard,
  Database,
  Shield,
  FileText,
  Package,
  ArrowLeftRight,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { PermissionCode } from '@/lib/permissions'

export interface NavChild {
  /** 菜单项完整路径（真实路由路径，指向模块默认子页）；仅叶子项 */
  path: string
  label: string
  /** 完整权限码（resource:action）；缺省继承父级（一级项 resource） */
  permission?: PermissionCode
  /** 模块内非默认子页的完整路径集合（不含自身 path）：驱动侧边栏高亮与面包屑匹配。缺省仅匹配自身 path */
  match?: string[]
}

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  /** 完整权限码（resource:action），作为模块入口与子项缺省继承的基线 */
  resource: PermissionCode
  children?: NavChild[]
}

export const navItems: NavItem[] = [
  {
    path: '/dashboard',
    label: '首页看板',
    icon: LayoutDashboard,
    resource: 'dashboard:view',
    children: [
      { path: '/dashboard', label: '看板总览' },
      {
        // 经营分析二级导航：壹品慧关键指标表（默认）等 7 个子页（4 个占位 + 3 个迁移自综合分析卡）
        path: '/dashboard/analysis/key-metrics',
        label: '经营分析',
        match: [
          '/dashboard/analysis/key-metrics',
          '/dashboard/analysis/cash-flow',
          '/dashboard/analysis/receivable-aging',
          '/dashboard/analysis/inventory-aging',
          '/dashboard/analysis/category-budget',
          '/dashboard/analysis/subject-budget',
          '/dashboard/analysis/expense',
        ],
      },
      {
        // 财务指标作为看板的明细层归并其下；显式权限码防无 indicators 权限角色穿透；
        // 页面内 Tab：经营指标（默认）/ 静态指标
        path: '/indicators',
        label: '财务指标',
        permission: 'indicators:view',
        match: ['/indicators/operating', '/indicators/static'],
      },
    ],
  },
  {
    path: '/transactions',
    label: '往来分析',
    icon: ArrowLeftRight,
    resource: 'transactions:view',
    children: [
      { path: '/transactions/overview', label: '往来总览' },
      {
        // 分析/任务类子页合入页内 Tab：账龄分析（默认）/ 科目过滤 / 催收计划
        path: '/transactions/aging',
        label: '分析明细',
        match: ['/transactions/account-filter', '/transactions/collections/plans'],
      },
    ],
  },
  { path: '/inventory', label: '存货管理', icon: Package, resource: 'inventory:view' },
  {
    path: '/reports',
    label: '分析报告',
    icon: FileText,
    resource: 'reports:view',
    children: [
      { path: '/reports', label: '汇总报告' },
      { path: '/reports/analyses', label: '单项分析' },
    ],
  },
  {
    path: '/tools',
    label: '其他工具',
    icon: Wrench,
    resource: 'tools:view',
    children: [
      { path: '/tools/enterprise-lookup', label: '企业查询' },
    ],
  },
  {
    path: '/data',
    label: '数据管理',
    icon: Database,
    resource: 'data:browse:view',
    children: [
      {
        // 页内 Tab：导入管理（默认）/ 数据预览
        path: '/data/import',
        label: '数据导入',
        match: ['/data/browse'],
      },
      {
        // 页内 Tab：单体公司调整（默认）/ 汇总主体调整
        path: '/data/reclassify',
        label: '重分类管理',
      },
      {
        // 页内 Tab：经营分析科目（默认）/ 静态科目 / 主体管理 / 汇总主体映射 / 公式维护
        path: '/data/dimensions/operating',
        label: '维度/科目体系',
        match: ['/data/dimensions/static', '/data/dimensions/company', '/data/dimensions/summary', '/data/dimensions/formulas'],
      },
      {
        // 页内 Tab：品类配置（默认）/ 运营费用映射 / 主体配置 / 月度预算比例 / 产品配置
        path: '/data/board/category',
        label: '看板管理',
        match: ['/data/board/expense', '/data/board/subject', '/data/board/budget-ratio', '/data/board/product'],
      },
    ],
  },
  {
    path: '/admin',
    label: '权限管理',
    icon: Shield,
    resource: 'admin:users:view',
    children: [
      // 角色管理需独立权限码：finance_analyst_it 等仅持 admin:users 的角色不显示入口（避免菜单穿透）
      { path: '/admin/roles', label: '角色管理', permission: 'admin:roles:view' },
      { path: '/admin/users', label: '用户管理' },
      { path: '/admin/audit-logs', label: '审计日志', permission: 'admin:users:view' },
    ],
  },
]
