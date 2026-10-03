import { Suspense, useEffect, useState } from 'react'
import { Outlet, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Header } from './header'
import { Sidebar } from './sidebar'
import { ChangePasswordDialog } from './change-password-dialog'
import { VersionNotice } from './version-notice'
import { RouteFallback } from './route-fallback'
import { PageTitleProvider } from './page-heading'

import { usePreferencesStore } from '@/stores/preferencesStore'
import { AccountBoundary } from '@/components/settings/account-boundary'

/** 小尺寸窗口（<1280px，对齐设计规范 §8：1024-1279 侧边栏收起）自动折叠；≥1280 恢复用户偏好 */
const SMALL_SCREEN_QUERY = '(max-width: 1279px)'

export function MainLayout() {
  const { isAuthenticated, user, openPasswordDialog } = useAuthStore()
  const location = useLocation()
  const collapsed = usePreferencesStore(s => s.preferences.sidebarCollapsed)
  // 小尺寸自动折叠：窗口 <1280px 时侧边栏强制进入折叠态（图标栏）；
  // 小尺寸下折叠条点击仅会话内临时展开/折叠（不写 localStorage），回到大尺寸自动清除临时状态
  const [smallScreen, setSmallScreen] = useState(() => window.matchMedia(SMALL_SCREEN_QUERY).matches)
  const [forcedExpand, setForcedExpand] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // 监听窗口尺寸：进入/离开小尺寸区间时同步状态
  useEffect(() => {
    const mq = window.matchMedia(SMALL_SCREEN_QUERY)
    const onChange = (e: MediaQueryListEvent) => {
      setSmallScreen(e.matches)
      if (!e.matches) setForcedExpand(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onDesktop = (event: MediaQueryListEvent) => { if (event.matches) setMobileOpen(false) }
    mq.addEventListener('change', onDesktop)
    return () => mq.removeEventListener('change', onDesktop)
  }, [])

  // 路由切换时自动关闭移动端抽屉
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // 首次登录强制改密：未改密前自动弹出强制对话框（后端业务接口已被 403 拦截）
  useEffect(() => {
    if (user?.mustChangePassword) openPasswordDialog(true)
  }, [user?.mustChangePassword, openPasswordDialog])

  // 实际生效的折叠态：小尺寸下以自动折叠为准，大尺寸下为用户持久化偏好
  const effectiveCollapsed = smallScreen ? !forcedExpand : collapsed

  const toggleCollapse = () => {
    if (smallScreen) {
      // 小尺寸：仅切换会话内临时展开/折叠，避免覆盖用户在大尺寸下的偏好
      setForcedExpand((prev) => !prev)
      return
    }
    usePreferencesStore.getState().patch({ sidebarCollapsed: !collapsed })
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ returnTo: location.pathname + location.search + location.hash }} replace />
  }

  return (
    <AccountBoundary><PageTitleProvider><div className="app-shell flex h-dvh overflow-hidden bg-page">
      {/* 侧边栏独立列：从页面顶部开始渲染（覆盖 Header 高度区域），全高贴边 */}
      <Sidebar
        collapsed={effectiveCollapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
          {/* 主标题在顶栏，正文从筛选或分类切换开始；列表按实际剩余高度测量。 */}
          <div className="app-content mx-auto w-full max-w-[1720px] px-4 py-4 md:px-6">
            {/* Suspense 内层：路由切换时仅内容区回退到骨架，侧边栏/Header 常驻 */}
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      {/* 修改密码对话框（全局唯一实例：用户菜单主动改密 + 强制改密） */}
      <ChangePasswordDialog />
      {/* 版本更新公告（发现需要刷新的新版本时提醒，历史公告手动查看） */}
      <VersionNotice />
    </div></PageTitleProvider></AccountBoundary>
  )
}
