import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageContainer } from '@/components/layout/page-container'
import { ShieldAlert, LogOut } from 'lucide-react'

/**
 * 权限不足兜底页：当前账号在 HOME_ROUTE_PRIORITY 清单内无任何查看权限时登录落地页。
 * 提示联系管理员，并提供退出登录入口（保留侧边栏/header，有部分权限的用户仍可手动导航）。
 */
export default function NoAccessPage() {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <PageContainer title="权限不足" description="当前账号无可用模块权限">
      <Card className="animate-fade-in">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
            <ShieldAlert className="h-7 w-7 text-warning-strong" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">暂无可用模块</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            您当前的角色未分配任何模块的访问权限，如需使用系统请联系管理员配置权限。
          </p>
          <Button variant="outline" className="mt-6" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            退出登录
          </Button>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
