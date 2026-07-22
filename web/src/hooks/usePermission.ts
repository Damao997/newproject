import { useMemo } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { ROLE_PERMISSIONS, hasPermission } from '@/lib/permissions'

/**
 * 权限判断 Hook。
 *
 * 读取 authStore 当前用户角色，返回：
 *   - `can(resource, action)`：判断是否拥有某资源的某操作权限
 *   - `permissions`：当前角色的全部权限码（只读）
 *
 * 依据《安全与权限规范》§2.2 权限矩阵实现前端菜单/按钮门禁。
 */
export function usePermission() {
  const user = useAuthStore((state) => state.user)
  const role = user?.role

  const permissions = useMemo(() => (role ? ROLE_PERMISSIONS[role] ?? [] : []), [role])

  const can = useMemo(
    () => (resource: string, action: string) => hasPermission(role, resource, action),
    [role],
  )

  return { can, permissions, role }
}
