import { useFormActivity } from '@/components/forms/form-navigation'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Key, LogOut, Megaphone, Settings, User } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { api } from '@/lib/api'
import { PersonalAvatar } from '@/components/settings/personal-avatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useConfirm } from '@/components/ui/confirm-dialog'
export function UserChip() {
  const { user, logout, openPasswordDialog } = useAuthStore()
  const openNotice = useNoticeStore(s => s.openNotice)
  const navigate = useNavigate()
  const activity = useFormActivity()
  const settingsSaving = usePreferencesStore(s => s.saving)
  const { confirm, element } = useConfirm()
  const [pending, setPending] = useState(false)
  return <><DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="用户菜单" className="user-chip">
    <PersonalAvatar className="h-8 w-8" name={user?.name ?? '用户'} version={user?.avatarVersion} /><span className="hidden max-w-[110px] truncate text-sm font-medium sm:block">{user?.name ?? '未登录'}</span>
  </button></DropdownMenuTrigger><DropdownMenuContent className="w-64" align="end">
    <DropdownMenuLabel><p className="truncate font-semibold">{user?.name}</p><p className="text-xs font-normal text-muted-foreground">{user?.username}</p></DropdownMenuLabel>
    <DropdownMenuSeparator /><DropdownMenuItem onClick={() => navigate('/settings/profile')}><User className="mr-2 h-4 w-4" />个人资料</DropdownMenuItem>
    <DropdownMenuItem onClick={() => navigate('/settings/preferences')}><Settings className="mr-2 h-4 w-4" />个人设置</DropdownMenuItem>
    <DropdownMenuItem onClick={() => openPasswordDialog(!!user?.mustChangePassword)}><Key className="mr-2 h-4 w-4" />修改密码</DropdownMenuItem>
    <DropdownMenuItem onClick={() => openNotice()}><Megaphone className="mr-2 h-4 w-4" />版本与更新</DropdownMenuItem>
    <DropdownMenuSeparator /><DropdownMenuItem disabled={pending || activity.busy || settingsSaving} onClick={async () => {
      if (pending || !await confirm({ title: '退出登录？', description: '未保存的内容会丢失。', confirmText: '退出登录' })) return
      activity.discardAll(); setPending(true)
      try { await api.logout() } catch { console.error('在线登出失败，已清理本地会话') }
      logout(); navigate('/login', { replace: true }); setPending(false)
    }}><LogOut className="mr-2 h-4 w-4" />{pending ? '正在退出' : '退出登录'}</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>{element}</>
}
