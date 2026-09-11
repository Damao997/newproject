import { useMemo } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { ROLE_PERMISSIONS, hasPermission } from '@/lib/permissions'

/**
 * 权限判断 Hook。
 *
 * 读取 authStore 当前用户，返回：
 *   - `can(resource, action)`：判断是否拥有某资源的某操作权限
 *   - `permissions`：当前用户的全部权限码（只读）
 *
 * 权限来源优先级：登录接口下发的 `user.permissions`（支持自定义/克隆角色）
 * > 静态矩阵 ROLE_PERMISSIONS 兜底（旧会话未携带权限列表时）。
 * 依据《安全与权限规范》§2.2 权限矩阵实现前端菜单/按钮门禁。
 */
export function usePermission() {
  const user = useAuthStore((state) => state.user)
  const role = user?.role
  const serverPermissions = user?.permissions

  const permissions = useMemo(() => {
    if (serverPermissions && serverPermissions.length > 0) return serverPermissions
    return role ? ROLE_PERMISSIONS[role] ?? [] : []
  }, [serverPermissions, role])

  const can = useMemo(
    () => (resource: string, action: string) => {
      if (serverPermissions && serverPermissions.length > 0) {
        return serverPermissions.includes(`${resource}:${action}`)
      }
      return hasPermission(role, resource, action)
    },
    [serverPermissions, role],
  )

  return { can, permissions, role }
}
