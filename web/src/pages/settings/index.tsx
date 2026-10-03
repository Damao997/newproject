import { NavLink, Navigate, useParams } from 'react-router-dom'
import { Palette, ShieldCheck, UserRound } from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'
import { ProfileSettings } from './profile-settings'
import { PreferenceSettings } from './preference-settings'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
const tabs = [{ key: 'profile', label: '个人资料', icon: UserRound }, { key: 'preferences', label: '使用习惯', icon: Palette }, { key: 'security', label: '账号安全', icon: ShieldCheck }]
export default function SettingsPage() {
  const { section } = useParams()
  const user = useAuthStore(s => s.user)
  if (!tabs.some(tab => tab.key === section)) return <Navigate to="/settings/profile" replace />
  return <PageContainer title="个人设置" className="settings-page">
    <div className="settings-layout"><nav className="settings-nav" aria-label="个人设置分类">{tabs.map(tab => <NavLink key={tab.key} to={'/settings/' + tab.key} className={({ isActive }) => 'settings-nav-item ' + (isActive ? 'is-active' : '')}><tab.icon className="h-4 w-4" /><span>{tab.label}</span></NavLink>)}</nav>
      <div className="settings-content" key={section}>{section === 'profile' ? <ProfileSettings /> : section === 'preferences' ? <PreferenceSettings /> :
        <Card><div className="settings-card-heading"><ShieldCheck className="h-6 w-6 text-primary" /><div><h2>账号安全</h2><p>管理你的登录凭证</p></div></div>
          <dl className="settings-account-info"><dt>登录名</dt><dd>{user?.username}</dd><dt>账号状态</dt><dd>{user?.status === 'active' ? '正常' : '停用'}</dd></dl>
          <div className="settings-security-action"><div><h3 className="font-semibold">登录密码</h3><p className="text-sm text-muted-foreground">修改后继续保持当前会话</p></div><Button variant="outline" onClick={() => useAuthStore.getState().openPasswordDialog(!!user?.mustChangePassword)}>修改密码</Button></div>
        </Card>}
      </div></div>
  </PageContainer>
}
