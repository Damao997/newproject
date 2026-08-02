import type { ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { Card, CardContent } from '@/components/ui/card'

interface RequirePermissionProps {
  /** 资源编码（模块级或模块:子页面级），如 `dashboard`、`admin:users` */
  resource: string
  /** 操作类型，如 `view`、`export` */
  action: string
  children: ReactNode
}

/**
 * 路由/区块权限门禁。
 *
 * 当前用户无 `resource:action` 权限时，渲染 403 提示卡（不跳转），
 * 用于包裹受控路由元素或页面区块。
 */
export function RequirePermission({ resource, action, children }: RequirePermissionProps) {
  const { can } = usePermission()

  if (!can(resource, action)) {
    return (
      <Card className="animate-fade-in">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
            <ShieldAlert className="h-7 w-7 text-warning-strong" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">无访问权限</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            您当前的角色无权访问该模块，如需权限请联系管理员。
          </p>
        </CardContent>
      </Card>
    )
  }

  return <>{children}</>
}
