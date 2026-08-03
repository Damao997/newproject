import { useEffect, useState } from 'react'
import { Outlet, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Header } from './header'
import { Sidebar } from './sidebar'
import { ChangePasswordDialog } from './change-password-dialog'

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed'

export function MainLayout() {
  const { isAuthenticated, user, openPasswordDialog } = useAuthStore()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  // 路由切换时自动关闭移动端抽屉
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // 首次登录强制改密：未改密前自动弹出强制对话框（后端业务接口已被 403 拦截）
  useEffect(() => {
    if (user?.mustChangePassword) openPasswordDialog(true)
  }, [user?.mustChangePassword, openPasswordDialog])

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
          <div className="container mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
      {/* 修改密码对话框（全局唯一实例：用户菜单主动改密 + 强制改密） */}
      <ChangePasswordDialog />
    </div>
  )
}
