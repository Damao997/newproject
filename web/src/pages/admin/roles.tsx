import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageContainer } from '@/components/layout/page-container'
import { usePermission } from '@/hooks/usePermission'
import { useRoles, useDeleteRole, useCloneRole, type RoleItem } from '@/hooks/api-queries'
import { RoleDialog, PermissionDialog } from './dialogs'
import { Plus, Edit, Shield } from 'lucide-react'

/** 角色管理：角色的创建、编辑、删除、克隆与权限配置（预置角色只读）。 */
export default function RolesPage() {
  const { can } = usePermission()
  const canCreateRole = can('admin:roles', 'create')
  const canUpdateRole = can('admin:roles', 'update')
  const canDeleteRole = can('admin:roles', 'delete')
  const canManagePermissions = can('admin:permissions', 'update')

  // 弹窗状态
  const [roleDialog, setRoleDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; role: RoleItem | null }>({ open: false, mode: 'create', role: null })
  const [permRole, setPermRole] = useState<RoleItem | null>(null)

  const { data: rolesData } = useRoles()
  const deleteRole = useDeleteRole()
  const cloneRole = useCloneRole()

  const roles = (rolesData ?? []) as RoleItem[]

  const alertError = (fallback: string) => (e: unknown) => window.alert(e instanceof Error ? e.message : fallback)

  const handleCloneRole = (role: RoleItem) => {
    if (cloneRole.isPending) return
    cloneRole.mutate({ id: role.id, name: `${role.name}-副本` }, { onError: alertError('克隆失败') })
  }

  const handleDeleteRole = (role: RoleItem) => {
    if (!window.confirm(`确认删除角色「${role.name}」？`)) return
    deleteRole.mutate(role.id, { onError: alertError('删除失败') })
  }

  return (
    <PageContainer title="角色管理" description="创建、编辑角色并配置功能权限">
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">角色数</p>
                <p className="text-2xl font-bold">{roles.length}</p>
              </div>
              <Shield className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 角色列表（角色卡网格，卡片化形态保持；标题行） */}
      <div className="animate-fade-in">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-tight">角色列表</h3>
          {canCreateRole && (
            <Button size="sm" onClick={() => setRoleDialog({ open: true, mode: 'create', role: null })}>
              <Plus className="mr-2 h-4 w-4" />
              新增角色
            </Button>
          )}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((role) => (
              <Card key={role.id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium">{role.name}</h4>
                      <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
                    </div>
                    {role.isSystem && <Badge variant="secondary">系统</Badge>}
                  </div>
                  {(canUpdateRole || canManagePermissions) && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {canUpdateRole && (
                        <Button variant="outline" size="sm" onClick={() => setRoleDialog({ open: true, mode: 'edit', role })}>
                          <Edit className="mr-2 h-4 w-4" />
                          编辑
                        </Button>
                      )}
                      {canManagePermissions && (
                        <Button variant="ghost" size="sm" onClick={() => setPermRole(role)}>
                          <Shield className="mr-2 h-4 w-4" />
                          权限
                        </Button>
                      )}
                      {canCreateRole && (
                        <Button variant="ghost" size="sm" disabled={cloneRole.isPending} onClick={() => handleCloneRole(role)}>
                          克隆
                        </Button>
                      )}
                      {canDeleteRole && !role.isSystem && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteRole(role)}>
                          删除
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
      </div>

      {/* 弹窗 */}
      <RoleDialog
        open={roleDialog.open}
        mode={roleDialog.mode}
        role={roleDialog.role}
        onClose={() => setRoleDialog((s) => ({ ...s, open: false }))}
      />
      <PermissionDialog open={!!permRole} role={permRole} onClose={() => setPermRole(null)} />
    </PageContainer>
  )
}
