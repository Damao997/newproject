import { useEffect, useMemo } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { usePeriodStore } from '@/stores/periodStore'
import { useAvailablePeriods } from '@/hooks/api-queries'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Menu, LogOut, User, Key, CalendarRange } from 'lucide-react'
import { ThemeSwitcher } from './theme-switcher'
import { Breadcrumb } from './breadcrumb'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu'

interface HeaderProps {
  onMenuClick: () => void
}

export function Header({ onMenuClick }: HeaderProps) {
  const { user, logout, openPasswordDialog } = useAuthStore()
  // 全局财年选择：看板/指标/数据浏览的期间候选按此过滤；未选/失效时自动归一化为最新财年
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const setFiscalYear = usePeriodStore((s) => s.setFiscalYear)
  const { data: periodsData, isPending, isError } = useAvailablePeriods()
  const fiscalYears = useMemo(() => periodsData?.fiscalYears ?? [], [periodsData])

  // 归一化：未选（localStorage 遗留 null）或已选财年不在候选内（批次替换后失效）时，
  // 自动切到最新财年（fiscalYears 后端按降序返回，[0] 即最新）
  useEffect(() => {
    if (fiscalYears.length === 0) return
    if (!fiscalYear || !fiscalYears.includes(fiscalYear)) {
      setFiscalYear(fiscalYears[0])
    }
  }, [fiscalYears, fiscalYear, setFiscalYear])

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
    <header className="z-40 w-full shrink-0 border-b border-border/60 bg-background font-sans">
      <div className="flex h-14 items-center px-4">
        {/* 移动端：菜单按钮 + 品牌标识（<640px 仅 Logo 最大化内容空间，640-767px 标题单行截断） */}
        <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-foreground"
            aria-label="打开导航菜单"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <img src="/logo.png" alt="壹品慧" className="h-7 w-7 shrink-0 object-contain" />
          <span className="hidden min-w-0 truncate text-base font-bold text-foreground sm:inline">
            浙江壹品慧经营分析平台
          </span>
        </div>

        {/* 桌面端面包屑：层级 ≥3 时显示，左对齐占满剩余空间（单行截断）；<768px 隐藏（左侧为汉堡+品牌） */}
        <div className="hidden min-w-0 flex-1 items-center overflow-hidden md:flex">
          <Breadcrumb singleLine />
        </div>

        <div className="flex shrink-0 items-center space-x-2">
          {/* 侧边栏风格切换器（浅色/紫渐变/深色，全局应用，localStorage 持久化） */}
          <ThemeSwitcher />
          {/* 全局财年选择：有候选时渲染下拉；无数据/失败时显示占位提示而非静默隐藏（避免「功能不见了」的困惑） */}
          <div className="flex items-center gap-1.5">
            <CalendarRange className="hidden h-4 w-4 text-muted-foreground sm:block" />
            {fiscalYears.length > 0 ? (
              <Select
                value={fiscalYear && fiscalYears.includes(fiscalYear) ? fiscalYear : ''}
                onValueChange={(v) => setFiscalYear(v)}
              >
                <SelectTrigger className="h-8 w-[120px] text-sm" title="财年选择（影响看板/指标/数据浏览的期间候选）">
                  <SelectValue placeholder="选择财年" />
                </SelectTrigger>
                <SelectContent>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : isPending ? (
              <div className="h-8 w-[120px] animate-pulse rounded-md bg-muted" />
            ) : isError ? (
              <span className="text-sm text-muted-foreground" title="财年列表加载失败，请稍后重试">财年加载失败</span>
            ) : (
              <span className="text-sm text-muted-foreground" title="导入并激活经营数据后，此处可切换财年">暂无经营数据</span>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-muted text-foreground">
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
              <DropdownMenuItem onClick={() => openPasswordDialog(!!user?.mustChangePassword)}>
                <Key className="mr-2 h-4 w-4" />
                <span>修改密码</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* 退出登录：先通知后端吊销当前会话（黑名单+审计），失败也不阻塞本地登出 */}
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    await api.logout()
                  } catch {
                    // 忽略：令牌可能已失效/网络异常，本地登出兜底
                  } finally {
                    logout()
                  }
                }}
              >
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
