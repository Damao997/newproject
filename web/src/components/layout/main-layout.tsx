import { Outlet, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Header } from './header'

export function MainLayout() {
  const { isAuthenticated } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#F8FAFC]">
      <Header />
      <main className="flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        <div className="container mx-auto max-w-7xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
