import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MainLayout } from '@/components/layout/main-layout'
import { RequirePermission } from '@/components/layout/require-permission'
import { HomeRedirect } from '@/components/layout/home-redirect'
import { ErrorBoundary } from '@/components/layout/error-boundary'

const LoginPage = lazy(() => import('@/pages/login'))
const DashboardPage = lazy(() => import('@/pages/dashboard'))
const IndicatorsOperatingPage = lazy(() => import('@/pages/indicators/operating'))
const IndicatorsStaticPage = lazy(() => import('@/pages/indicators/static'))
const TransactionsOverviewPage = lazy(() => import('@/pages/transactions/overview'))
const TransactionsAgingPage = lazy(() => import('@/pages/transactions/aging'))
const TransactionsCoveragePage = lazy(() => import('@/pages/transactions/coverage'))
const TransactionsAccountFilterPage = lazy(() => import('@/pages/transactions/account-filter'))
const CollectionsPlansPage = lazy(() => import('@/pages/transactions/collections/plans'))
const SalesmenPage = lazy(() => import('@/pages/transactions/collections/salesmen'))
const InventoryPage = lazy(() => import('@/pages/inventory'))
const ReportsPage = lazy(() => import('@/pages/reports'))
const ReportsAnalysesPage = lazy(() => import('@/pages/reports/analyses'))
const ReportEditor = lazy(() => import('@/pages/reports/report-editor').then((m) => ({ default: m.ReportEditor })))
const ToolsLookupPage = lazy(() => import('@/pages/tools/enterprise-lookup'))
const DataBrowsePage = lazy(() => import('@/pages/data/browse'))
const DataImportPage = lazy(() => import('@/pages/data/import'))
const DataReclassifyPage = lazy(() => import('@/pages/data/reclassify'))
const DataReclassifyConsolidationPage = lazy(() => import('@/pages/data/reclassify/consolidation'))
const DataDimensionsPage = lazy(() => import('@/pages/data/dimensions'))
const DataBoardPage = lazy(() => import('@/pages/data/board'))
const DataFormulasPage = lazy(() => import('@/pages/data/formulas'))
const AdminUsersPage = lazy(() => import('@/pages/admin/users'))
const AdminRolesPage = lazy(() => import('@/pages/admin/roles'))
const AdminAuditLogsPage = lazy(() => import('@/pages/admin/audit-logs'))
const NoAccessPage = lazy(() => import('@/pages/no-access'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
})

// 旧 ?tab= / &sub= URL 兼容重定向：模块根路径带 query 时映射到新的三级路径，
// 无 query 时落到默认子页（保持收藏夹/分享链接可用性）
const LEGACY_TRANSACTION_TABS = ['overview', 'aging', 'coverage', 'account-filter', 'collections']
const DIM_SUB_TABS = ['operating', 'static', 'company', 'summary']
const BOARD_SUB_TABS = ['category', 'expense', 'subject', 'budget-ratio']

function LegacyQueryRedirect() {
  const location = useLocation()
  const [params] = useSearchParams()
  const tab = params.get('tab')
  const sub = params.get('sub')

  if (location.pathname === '/transactions') {
    // 旧 ?tab=details 收藏链接兼容：明细查询已并入账龄分析
    if (tab === 'details') return <Navigate to="/transactions/aging" replace />
    if (tab && LEGACY_TRANSACTION_TABS.includes(tab)) {
      return <Navigate to={tab === 'collections' ? '/transactions/collections/plans' : `/transactions/${tab}`} replace />
    }
    return <Navigate to="/transactions/overview" replace />
  }
  if (location.pathname === '/indicators') {
    return <Navigate to={tab === 'static' ? '/indicators/static' : '/indicators/operating'} replace />
  }
  if (location.pathname === '/data') {
    if (tab === 'dimensions') {
      const subTarget = sub && DIM_SUB_TABS.includes(sub) ? sub : 'operating'
      return <Navigate to={`/data/dimensions/${subTarget}`} replace />
    }
    if (tab === 'board') {
      const subTarget = sub && BOARD_SUB_TABS.includes(sub) ? sub : 'category'
      return <Navigate to={`/data/board/${subTarget}`} replace />
    }
    if (tab === 'reclassify') return <Navigate to="/data/reclassify" replace />
    if (tab === 'formulas') return <Navigate to="/data/formulas" replace />
    return <Navigate to="/data/browse" replace />
  }
  if (location.pathname === '/tools') {
    return <Navigate to="/tools/enterprise-lookup" replace />
  }
  return null
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-muted-foreground">加载中…</div>}>
              <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<MainLayout />}>
                {/* 根路径：权限感知首页（无匹配权限 → /no-access） */}
                <Route index element={<HomeRedirect />} />
                <Route path="dashboard" element={<RequirePermission resource="dashboard" action="view"><DashboardPage /></RequirePermission>} />
                {/* 财务指标：根路径按旧 query 或默认重定向到子页 */}
                <Route path="indicators" element={<RequirePermission resource="indicators" action="view"><LegacyQueryRedirect /></RequirePermission>} />
                <Route path="indicators/operating" element={<RequirePermission resource="indicators" action="view"><IndicatorsOperatingPage /></RequirePermission>} />
                <Route path="indicators/static" element={<RequirePermission resource="indicators" action="view"><IndicatorsStaticPage /></RequirePermission>} />
                {/* 往来分析：根路径按旧 query 或默认重定向到总览 */}
                <Route path="transactions" element={<RequirePermission resource="transactions" action="view"><LegacyQueryRedirect /></RequirePermission>} />
                <Route path="transactions/overview" element={<RequirePermission resource="transactions" action="view"><TransactionsOverviewPage /></RequirePermission>} />
                {/* 旧明细查询路径：已并入账龄分析，重定向保持分享链接可用 */}
                <Route path="transactions/details" element={<Navigate to="/transactions/aging" replace />} />
                <Route path="transactions/aging" element={<RequirePermission resource="transactions" action="view"><TransactionsAgingPage /></RequirePermission>} />
                <Route path="transactions/coverage" element={<RequirePermission resource="transactions" action="view"><TransactionsCoveragePage /></RequirePermission>} />
                <Route path="transactions/account-filter" element={<RequirePermission resource="transactions" action="view"><TransactionsAccountFilterPage /></RequirePermission>} />
                <Route path="transactions/collections/plans" element={<RequirePermission resource="transactions" action="view"><CollectionsPlansPage /></RequirePermission>} />
                <Route path="transactions/collections/salesmen" element={<RequirePermission resource="transactions:salesmen" action="view"><SalesmenPage /></RequirePermission>} />
                <Route path="inventory" element={<RequirePermission resource="inventory" action="view"><InventoryPage /></RequirePermission>} />
                {/* 分析报告：汇总报告列表页（旧 ?tab=analyses 兼容重定向在页面内处理） */}
                <Route path="reports" element={<RequirePermission resource="reports" action="view"><ReportsPage /></RequirePermission>} />
                <Route path="reports/analyses" element={<RequirePermission resource="reports" action="view"><ReportsAnalysesPage /></RequirePermission>} />
                <Route path="reports/:reportId/edit" element={<RequirePermission resource="reports" action="view"><ReportEditor /></RequirePermission>} />
                <Route path="tools" element={<RequirePermission resource="tools" action="view"><LegacyQueryRedirect /></RequirePermission>} />
                <Route path="tools/enterprise-lookup" element={<RequirePermission resource="tools" action="view"><ToolsLookupPage /></RequirePermission>} />
                {/* 数据管理：根路径按旧 query 或默认重定向到数据浏览 */}
                <Route path="data" element={<RequirePermission resource="data:browse" action="view"><LegacyQueryRedirect /></RequirePermission>} />
                <Route path="data/browse" element={<RequirePermission resource="data:browse" action="view"><DataBrowsePage /></RequirePermission>} />
                <Route path="data/import" element={<RequirePermission resource="data:browse" action="view"><DataImportPage /></RequirePermission>} />
                <Route path="data/reclassify" element={<RequirePermission resource="data:browse" action="view"><DataReclassifyPage /></RequirePermission>} />
                <Route path="data/reclassify/consolidation" element={<RequirePermission resource="data:browse" action="view"><DataReclassifyConsolidationPage /></RequirePermission>} />
                <Route path="data/dimensions/:sub" element={<RequirePermission resource="data:browse" action="view"><DataDimensionsPage /></RequirePermission>} />
                <Route path="data/board/:sub" element={<RequirePermission resource="data:browse" action="view"><DataBoardPage /></RequirePermission>} />
                <Route path="data/formulas" element={<RequirePermission resource="data:browse" action="view"><DataFormulasPage /></RequirePermission>} />
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
