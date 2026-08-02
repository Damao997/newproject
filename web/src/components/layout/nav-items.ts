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
  /** 菜单项完整路径（含 ?tab= / &sub= 参数）；默认子项 path 即父路径（无 query） */
  path: string
  label: string
  /** 三级子标签（当前仅「数据管理 → 维度/科目体系」使用） */
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
  { path: '/dashboard', label: '首页看板', icon: LayoutDashboard, resource: 'dashboard:view' },
  {
    path: '/indicators',
    label: '财务指标',
    icon: BarChart3,
    resource: 'indicators:view',
    children: [
      { path: '/indicators', label: '经营指标' },
      { path: '/indicators?tab=static', label: '静态指标' },
    ],
  },
  {
    path: '/transactions',
    label: '往来分析',
    icon: ArrowLeftRight,
    resource: 'transactions:view',
    children: [
      { path: '/transactions', label: '总览' },
      { path: '/transactions?tab=details', label: '明细查询' },
      { path: '/transactions?tab=aging', label: '账龄分析' },
      { path: '/transactions?tab=internal', label: '内部往来' },
      { path: '/transactions?tab=coverage', label: '导入覆盖' },
      { path: '/transactions?tab=account-filter', label: '科目过滤' },
      { path: '/transactions?tab=collections', label: '催收管理' },
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
      { path: '/reports?tab=analyses', label: '单项分析' },
    ],
  },
  { path: '/tools', label: '其他工具', icon: Wrench, resource: 'tools:view' },
  {
    path: '/data',
    label: '数据管理',
    icon: Database,
    resource: 'data:browse:view',
    children: [
      { path: '/data', label: '数据管理' },
      { path: '/data?tab=reclassify', label: '重分类记录' },
      {
        path: '/data?tab=dimensions',
        label: '维度/科目体系',
        children: [
          { path: '/data?tab=dimensions&sub=operating', label: '经营分析科目' },
          { path: '/data?tab=dimensions&sub=static', label: '静态科目' },
          { path: '/data?tab=dimensions&sub=company', label: '公司' },
          { path: '/data?tab=dimensions&sub=summary', label: '汇总主体' },
          { path: '/data?tab=dimensions&sub=category', label: '品类配置' },
          { path: '/data?tab=dimensions&sub=subject', label: '主体配置' },
        ],
      },
      { path: '/data?tab=formulas', label: '公式维护' },
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
