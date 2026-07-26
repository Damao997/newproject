import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { usePermission } from '@/hooks/usePermission'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { 
  LayoutDashboard, 
  BarChart3, 
  Database, 
  Shield, 
  FileText,
  TrendingUp,
  Package,
  ArrowLeftRight,
  Wrench,
  LogOut,
  User
} from 'lucide-react'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu'

const navItems = [
  { path: '/dashboard', label: '首页看板', icon: LayoutDashboard, resource: 'dashboard:view' },
  { path: '/indicators', label: '财务指标', icon: BarChart3, resource: 'indicators:view' },
  { path: '/transactions', label: '往来分析', icon: ArrowLeftRight, resource: 'transactions:view' },
  { path: '/inventory', label: '存货管理', icon: Package, resource: 'inventory:view' },
  { path: '/reports', label: '分析报告', icon: FileText, resource: 'reports:view' },
  { path: '/tools', label: '其他工具', icon: Wrench, resource: 'tools:view' },
  { path: '/data', label: '数据管理', icon: Database, resource: 'data:browse:view' },
  { path: '/admin', label: '权限管理', icon: Shield, resource: 'admin:users:view' },
]

export function Header() {
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { permissions } = usePermission()

  // 依据《安全与权限规范》§2.2，仅展示当前角色有 view 权限的模块入口
  const visibleNavItems = navItems.filter((item) => permissions.includes(item.resource))

  const getInitials = (name: string) => {
    return name.slice(0, 1)
  }

  const getRoleName = (role: string) => {
    const roleMap: Record<string, string> = {
      admin: '管理员',
      finance_manager: '财务主管',
      department_manager: '部门经理',
      viewer: '查看者',
      finance_analyst_it: '财务分析师(兼IT)',
    }
    return roleMap[role] || role
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="mr-4 hidden md:flex">
          <Link to="/dashboard" className="mr-6 flex items-center space-x-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            <span className="hidden font-bold sm:inline-block">
              壹品慧财务分析平台
            </span>
          </Link>
        </div>
        
        <nav className="flex items-center space-x-6 text-sm font-medium">
          {visibleNavItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname.startsWith(item.path)
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center space-x-1 transition-colors hover:text-primary ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline-block">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <div className="w-full flex-1 md:w-auto md:flex-none">
            {/* 搜索框可以在这里添加 */}
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {user ? getInitials(user.name) : 'U'}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <div className="flex items-center justify-start gap-2 p-2">
                <div className="flex flex-col space-y-1 leading-none">
                  <p className="font-medium">{user?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {user ? getRoleName(user.role) : ''}
                  </p>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                <span>个人资料</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>退出登录</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
