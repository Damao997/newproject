import { useEffect, useMemo } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { usePeriodStore } from '@/stores/periodStore'
import { useAvailablePeriods } from '@/hooks/api-queries'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Menu, LogOut, User, CalendarRange } from 'lucide-react'
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
  const { user, logout } = useAuthStore()
  // 全局财年选择：看板/指标/数据浏览的期间候选按此过滤；未选/失效时自动归一化为最新财年
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const setFiscalYear = usePeriodStore((s) => s.setFiscalYear)
  const { data: periodsData } = useAvailablePeriods()
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
    <header className="z-40 w-full shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center px-4">
        {/* 移动端：菜单按钮 + 品牌标识 */}
        <div className="flex items-center gap-2 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <img src="/logo.png" alt="壹品慧" className="h-7 w-7 object-contain" />
          <span className="text-sm font-bold">壹品慧财务分析平台</span>
        </div>

        <div className="flex flex-1 shrink-0 items-center justify-end space-x-2">
          {fiscalYears.length > 0 && (
            <div className="flex items-center gap-1.5">
              <CalendarRange className="hidden h-4 w-4 text-muted-foreground sm:block" />
              <Select
                value={fiscalYear && fiscalYears.includes(fiscalYear) ? fiscalYear : ''}
                onValueChange={(v) => setFiscalYear(v)}
              >
                <SelectTrigger className="h-8 w-[120px] text-xs" title="财年选择（影响看板/指标/数据浏览的期间候选）">
                  <SelectValue placeholder="选择财年" />
                </SelectTrigger>
                <SelectContent>
                  {fiscalYears.map((fy) => (
                    <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
