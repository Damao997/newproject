import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MainLayout } from '@/components/layout/main-layout'
import { RequirePermission } from '@/components/layout/require-permission'

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
          <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-muted-foreground">加载中...</div>}>
            <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
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
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App
