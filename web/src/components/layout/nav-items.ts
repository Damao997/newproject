import {
  LayoutDashboard,
  BarChart3,
  Database,
  Shield,
  FileText,
  Package,
  ArrowLeftRight,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export interface NavChild {
  /** 菜单项完整路径（真实路由路径，支持三级层级）；目录项 path 仅作分组 key（不可点击） */
  path: string
  label: string
  /** 三级子标签（目录项含 children，叶子项无） */
  children?: NavChild[]
}

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  resource: string
  children?: NavChild[]
}

export const navItems: NavItem[] = [
  { path: '/dashboard', label: '首页', icon: LayoutDashboard, resource: 'dashboard:view' },
  {
    path: '/indicators',
    label: '财务指标',
    icon: BarChart3,
    resource: 'indicators:view',
    children: [
      {
        path: '/indicators/data',
        label: '指标数据',
        children: [
          { path: '/indicators/operating', label: '经营指标' },
          { path: '/indicators/static', label: '静态指标' },
        ],
      },
    ],
  },
  {
    path: '/transactions',
    label: '往来分析',
    icon: ArrowLeftRight,
    resource: 'transactions:view',
    children: [
      { path: '/transactions/overview', label: '总览' },
      { path: '/transactions/aging', label: '账龄分析' },
      { path: '/transactions/internal', label: '内部往来' },
      {
        path: '/transactions/quality',
        label: '数据质量',
        children: [
          { path: '/transactions/coverage', label: '导入覆盖' },
          { path: '/transactions/account-filter', label: '科目过滤' },
        ],
      },
      { path: '/transactions/collections/plans', label: '催收计划' },
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
        path: '/data/imports',
        label: '数据导入',
        children: [
          { path: '/data/import', label: '导入管理' },
          { path: '/data/browse', label: '数据预览' },
        ],
      },
      {
        path: '/data/reclassify',
        label: '重分类管理',
        children: [
          { path: '/data/reclassify', label: '重分类记录' },
          { path: '/data/reclassify/consolidation', label: '汇总抵消调整' },
        ],
      },
      {
        path: '/data/dimensions',
        label: '维度/科目体系',
        children: [
          { path: '/data/dimensions/operating', label: '经营分析科目' },
          { path: '/data/dimensions/static', label: '静态科目' },
          { path: '/data/dimensions/company', label: '公司' },
          { path: '/data/dimensions/summary', label: '汇总主体' },
        ],
      },
      {
        path: '/data/board',
        label: '看板管理',
        children: [
          { path: '/data/board/category', label: '品类配置' },
          { path: '/data/board/expense', label: '运营费用映射' },
          { path: '/data/board/subject', label: '主体配置' },
          { path: '/data/board/budget-ratio', label: '月度预算比例' },
        ],
      },
      { path: '/data/formulas', label: '公式维护' },
    ],
  },
  {
    path: '/admin',
    label: '权限管理',
    icon: Shield,
    resource: 'admin:users:view',
    children: [
      { path: '/admin/roles', label: '角色管理' },
      { path: '/admin/users', label: '用户管理' },
      { path: '/admin/audit-logs', label: '审计日志' },
    ],
  },
]
