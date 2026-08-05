import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MainLayout } from '@/components/layout/main-layout'
import { RequirePermission } from '@/components/layout/require-permission'
import { HomeRedirect } from '@/components/layout/home-redirect'
import { ErrorBoundary } from '@/components/layout/error-boundary'

const LoginPage = lazy(() => import('@/pages/login'))
const DashboardPage = lazy(() => import('@/pages/dashboard'))
const IndicatorsPage = lazy(() => import('@/pages/indicators'))
const DataPage = lazy(() => import('@/pages/data'))
const AdminUsersPage = lazy(() => import('@/pages/admin/users'))
const AdminRolesPage = lazy(() => import('@/pages/admin/roles'))
const AdminAuditLogsPage = lazy(() => import('@/pages/admin/audit-logs'))
const TransactionsPage = lazy(() => import('@/pages/transactions'))
const InventoryPage = lazy(() => import('@/pages/inventory'))
const ReportsPage = lazy(() => import('@/pages/reports'))
const ToolsPage = lazy(() => import('@/pages/tools'))
const NoAccessPage = lazy(() => import('@/pages/no-access'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-muted-foreground">加载中...</div>}>
              <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<MainLayout />}>
                {/* 根路径：权限感知首页（无匹配权限 → /no-access） */}
                <Route index element={<HomeRedirect />} />
                <Route path="dashboard" element={<RequirePermission resource="dashboard" action="view"><DashboardPage /></RequirePermission>} />
                <Route path="indicators" element={<RequirePermission resource="indicators" action="view"><IndicatorsPage /></RequirePermission>} />
                <Route path="transactions" element={<RequirePermission resource="transactions" action="view"><TransactionsPage /></RequirePermission>} />
                <Route path="inventory" element={<RequirePermission resource="inventory" action="view"><InventoryPage /></RequirePermission>} />
                <Route path="reports" element={<RequirePermission resource="reports" action="view"><ReportsPage /></RequirePermission>} />
                <Route path="tools" element={<RequirePermission resource="tools" action="view"><ToolsPage /></RequirePermission>} />
                <Route path="data" element={<RequirePermission resource="data:browse" action="view"><DataPage /></RequirePermission>} />
                <Route path="admin" element={<Navigate to="/admin/users" replace />} />
                <Route path="admin/users" element={<RequirePermission resource="admin:users" action="view"><AdminUsersPage /></RequirePermission>} />
                <Route path="admin/roles" element={<RequirePermission resource="admin:roles" action="view"><AdminRolesPage /></RequirePermission>} />
                <Route path="admin/audit-logs" element={<RequirePermission resource="admin:users" action="view"><AdminAuditLogsPage /></RequirePermission>} />
                {/* 权限不足兜底页：无任何优先级内模块权限时落地 */}
                <Route path="no-access" element={<NoAccessPage />} />
              </Route>
              {/* 未知路径：权限感知首页 */}
              <Route path="*" element={<HomeRedirect />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App
