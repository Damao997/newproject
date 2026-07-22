import { useAuthStore } from '@/stores/authStore'

/**
 * 便捷访问认证状态。
 *
 * 封装 authStore，暴露当前用户、登录态与登出方法，
 * 供页面/组件直接读取，避免各处直接依赖 store 结构。
 */
export function useAuth() {
  const user = useAuthStore((state) => state.user)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const logout = useAuthStore((state) => state.logout)

  return { user, isAuthenticated, logout }
}
