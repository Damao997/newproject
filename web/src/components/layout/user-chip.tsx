import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
const getInitials = (name: string) => name.slice(0, 1)
const getRoleName = (role: string) => {
  const roleMap: Record<string, string> = {
    superadmin: '超级管理员',
    admin: '管理员',
    finance_manager: '财务主管',
    department_manager: '部门经理',
    viewer: '查看者',
    finance_analyst_it: '财务分析师(兼IT)',
  }
  return roleMap[role] || role
}

const fmtDateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('zh-CN') : '—')

/**
 * 个人资料弹窗：展示当前登录账号基础信息（只读）。
 * 打开时经 GET /auth/profile 拉取最新资料（30s 缓存，失败回退本地 store 用户），
 * 展示姓名/登录名/角色/账号状态/最近登录/创建时间。
 */
function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuthStore()
  const { data, isError } = useQuery({
    queryKey: ['auth', 'profile'],
    queryFn: () => api.getProfile(),
    enabled: open,
    staleTime: 30 * 1000,
  })
  const u = data ?? user

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>个人资料</DialogTitle>
          <DialogDescription>当前登录账号的基础信息（只读）</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarFallback className="bg-muted text-lg text-foreground">{u ? getInitials(u.name) : 'U'}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-foreground">{u?.name ?? '未登录'}</p>
            <p className="text-xs text-muted-foreground">{u ? getRoleName(u.role) : '—'}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2.5 rounded-md border border-border/60 bg-muted/30 p-4 text-sm">
          <dt className="text-muted-foreground">登录名</dt>
          <dd className="text-foreground">{u?.username ?? '—'}</dd>
          <dt className="text-muted-foreground">角色</dt>
          <dd className="text-foreground">{u ? getRoleName(u.role) : '—'}</dd>
          <dt className="text-muted-foreground">账号状态</dt>
          <dd className="text-foreground">{u ? (u.status === 'active' ? '正常' : '停用') : '—'}</dd>
          <dt className="text-muted-foreground">最近登录</dt>
          <dd className="text-foreground">{fmtDateTime(u?.lastLoginAt)}</dd>
          <dt className="text-muted-foreground">创建时间</dt>
          <dd className="text-foreground">{fmtDateTime(u?.createdAt)}</dd>
        </dl>
        {isError && <p className="text-xs text-muted-foreground">在线资料获取失败，当前展示本地缓存信息。</p>}
      </DialogContent>
    </Dialog>
  )
}

export function UserChip() {
  const { user, logout, openPasswordDialog } = useAuthStore()
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const setSidebarStyle = useThemeStore((s) => s.setSidebarStyle)
  const [profileOpen, setProfileOpen] = useState(false)

  // DropdownMenu 门面只收集 Trigger/Content 两类子节点，弹窗需作为兄弟节点渲染
  return (
    <>
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
        <DropdownMenuItem onClick={() => setProfileOpen(true)}>
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
    <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  )
}

