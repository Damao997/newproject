import { Check, Key, LogOut, Palette, User } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { SIDEBAR_STYLE_OPTIONS, useThemeStore } from '@/stores/themeStore'
import { SIDEBAR_PRESETS } from '@/lib/chart-theme'
import { api } from '@/lib/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * 顶栏用户胶囊（参考 AntD ProLayout 风格）：
 * 头像 + 姓名（主行） + 角色（次行）两行式，hover 浅灰底；
 * 点击展开下拉菜单：个人资料 / 修改密码 / 主题色切换 / 退出登录。
 *
 * 与历史 header 的差异：
 * - 形态从「仅头像小圆按钮 + DropdownMenu」改为「头像 + 姓名 + 角色 胶囊」；
 * - 保留原 DropdownMenu 功能与权限/后端调用逻辑不变（修改密码走 openPasswordDialog，
 *   退出登录先通知后端吊销会话失败也不阻塞本地登出）；
 * - 新增主题色切换区：与 Header 风格切换器共用同一 themeStore（全站状态一致），
 *   点击即时应用（带全局颜色过渡动画），当前主题带对勾标记；点击色点不关闭菜单，
 *   便于连续预览；偏好由 themeStore persist 持久化到 localStorage，下次访问自动恢复。
 */
export function UserChip() {
  const { user, logout, openPasswordDialog } = useAuthStore()
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const setSidebarStyle = useThemeStore((s) => s.setSidebarStyle)

  const getInitials = (name: string) => name.slice(0, 1)
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="用户菜单"
          className={cn(
            'inline-flex h-9 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-left transition-colors',
            'hover:bg-muted/70',
          )}
        >
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-muted text-foreground">{user ? getInitials(user.name) : 'U'}</AvatarFallback>
          </Avatar>
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-[13px] font-medium text-foreground">{user?.name ?? '未登录'}</span>
            <span className="text-[11px] text-muted-foreground">{user ? getRoleName(user.role) : '—'}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">{user?.name}</p>
            <p className="text-xs text-muted-foreground">{user ? getRoleName(user.role) : ''}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <User className="mr-2 h-4 w-4" />
          <span>个人资料</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPasswordDialog(!!user?.mustChangePassword)}>
          <Key className="mr-2 h-4 w-4" />
          <span>修改密码</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* 主题色切换区：普通按钮组而非 MenuItem，点击不关闭菜单，可连续预览各主题 */}
        <div className="px-2 py-1.5" role="group" aria-label="主题色切换">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Palette className="h-3.5 w-3.5" />
            主题色
          </p>
          <div className="flex items-center gap-2 px-0.5 py-0.5">
            {SIDEBAR_STYLE_OPTIONS.map((opt) => {
              const active = sidebarStyle === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  aria-label={opt.label}
                  aria-pressed={active}
                  title={opt.label}
                  onClick={() => setSidebarStyle(opt.key)}
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full border transition-all duration-200',
                    'hover:scale-110 active:scale-95',
                    active
                      ? 'border-foreground ring-2 ring-ring/30 ring-offset-1 ring-offset-popover'
                      : 'border-border hover:border-foreground/40',
                  )}
                  style={{ backgroundColor: SIDEBAR_PRESETS[opt.key].primary }}
                >
                  {active && <Check className="h-3.5 w-3.5 animate-in fade-in zoom-in duration-200 text-white" strokeWidth={3} />}
                </button>
              )
            })}
          </div>
        </div>
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
  )
}

