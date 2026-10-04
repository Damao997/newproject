import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert, LogOut, Home, MessageSquare } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogBody, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { resolveHomePath } from '@/lib/permissions'
import { api } from '@/lib/api'

const ROLE_LABEL: Record<string, string> = { superadmin: '超级管理员', admin: '系统管理员', finance_manager: '财务主管', department_manager: '部门经理', finance_analyst_it: '财务分析师', viewer: '只读用户' }

/** 权限不足时给出真实身份与下一步，移除未配置的联系方式与虚构信息。 */
export default function NoAccessPage() {
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const [helpOpen, setHelpOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const home = resolveHomePath(user?.permissions)
  const handleLogout = async () => {
    setLoggingOut(true)
    try { await api.logout() } catch (error) { console.error('会话吊销失败，已执行本地登出', error) }
    finally { logout(); navigate('/login', { replace: true }) }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-page p-4">
      <div className="w-full max-w-lg rounded-card border border-subtle bg-card px-6 py-10 text-center sm:px-10">
        <img src="/logo.png" alt="浙江壹品慧" className="mx-auto mb-10 h-10 w-10 object-contain" />
        <ShieldAlert className="mx-auto mb-5 h-9 w-9 text-warning-strong" aria-hidden />
        <h1 className="page-title text-2xl font-semibold text-foreground">当前账号暂无访问权限</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">请联系平台管理员，说明需要访问的模块与使用用途。</p>
        {user && <p className="mt-6 rounded-md bg-muted px-3 py-3 text-sm text-foreground">{user.name || user.username}<span className="ml-2 text-xs text-muted-foreground">{ROLE_LABEL[user.role] || user.role}</span></p>}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button onClick={() => setHelpOpen(true)}><MessageSquare className="mr-2 h-4 w-4" />联系管理员</Button>
          <Button variant="outline" disabled={!home} onClick={() => { if (home) navigate(home) }}><Home className="mr-2 h-4 w-4" />返回首页</Button>
        </div>
        <Button variant="ghost" className="mt-4 text-muted-foreground" loading={loggingOut} onClick={() => void handleLogout()}><LogOut className="mr-2 h-4 w-4" />退出登录</Button>
      </div>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>申请访问权限</DialogTitle></DialogHeader>
          <DialogBody className="space-y-3 text-sm leading-relaxed">
            <p>请通过公司内部联系方式联系平台管理员，提供登录账号、所需模块与使用用途。</p>
            {user && <p className="rounded-md bg-muted p-3">登录账号：{user.username}<br />当前角色：{ROLE_LABEL[user.role] || user.role}</p>}
          </DialogBody>
          <DialogFooter><Button variant="outline" onClick={() => setHelpOpen(false)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
