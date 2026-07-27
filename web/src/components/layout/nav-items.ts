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

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  resource: string
}

export const navItems: NavItem[] = [
  { path: '/dashboard', label: '首页看板', icon: LayoutDashboard, resource: 'dashboard:view' },
  { path: '/indicators', label: '财务指标', icon: BarChart3, resource: 'indicators:view' },
  { path: '/transactions', label: '往来分析', icon: ArrowLeftRight, resource: 'transactions:view' },
  { path: '/inventory', label: '存货管理', icon: Package, resource: 'inventory:view' },
  { path: '/reports', label: '分析报告', icon: FileText, resource: 'reports:view' },
  { path: '/tools', label: '其他工具', icon: Wrench, resource: 'tools:view' },
  { path: '/data', label: '数据管理', icon: Database, resource: 'data:browse:view' },
  { path: '/admin', label: '权限管理', icon: Shield, resource: 'admin:users:view' },
]
