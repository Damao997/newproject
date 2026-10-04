import { usePreferencesStore } from '@/stores/preferencesStore'
import { HOME_ROUTE_PRIORITY } from '@/lib/permissions'
import { Navigate } from 'react-router-dom'
import { usePermission } from '@/hooks/usePermission'
import { resolveHomePath } from '@/lib/permissions'

/**
 * 权限感知首页重定向：按 HOME_ROUTE_PRIORITY 解析第一个有权限的模块路径；
 * 无任何匹配权限时兜底跳转 /no-access（提示页）。
 * 用于根路径、未知路径与登录成功后的默认落地。
 */
export function HomeRedirect() {
  const { permissions } = usePermission()
  const preferred = usePreferencesStore(s => s.preferences.homePath)
  const allowed = HOME_ROUTE_PRIORITY.some(route => route.path === preferred && permissions.includes(route.resource))
  const home = allowed ? preferred : resolveHomePath(permissions)
  return <Navigate to={home ?? '/no-access'} replace />
}
