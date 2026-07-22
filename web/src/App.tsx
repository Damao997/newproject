import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MainLayout } from '@/components/layout/main-layout'
import { RequirePermission } from '@/components/layout/require-permission'
import LoginPage from '@/pages/login'
import DashboardPage from '@/pages/dashboard'
import IndicatorsPage from '@/pages/indicators'
import DataPage from '@/pages/data'
import AdminPage from '@/pages/admin'
import TransactionsPage from '@/pages/transactions'
import InventoryPage from '@/pages/inventory'
import ReportsPage from '@/pages/reports'

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
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<RequirePermission resource="dashboard" action="view"><DashboardPage /></RequirePermission>} />
              <Route path="indicators" element={<RequirePermission resource="indicators" action="view"><IndicatorsPage /></RequirePermission>} />
              <Route path="transactions" element={<RequirePermission resource="transactions" action="view"><TransactionsPage /></RequirePermission>} />
              <Route path="inventory" element={<RequirePermission resource="inventory" action="view"><InventoryPage /></RequirePermission>} />
              <Route path="reports" element={<RequirePermission resource="reports" action="view"><ReportsPage /></RequirePermission>} />
              <Route path="data" element={<RequirePermission resource="data:browse" action="view"><DataPage /></RequirePermission>} />
              <Route path="admin" element={<RequirePermission resource="admin:users" action="view"><AdminPage /></RequirePermission>} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App
