import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageContainer } from '@/components/layout/page-container'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'
import { usePermission } from '@/hooks/usePermission'
import { useUsers, useRoles, useAuditLogs, useUpdateUser, useDisableUser, useDeleteRole, useCloneRole, usePurgeUser, type RoleItem } from '@/hooks/api-queries'
import { UserDialog, RoleDialog, PermissionDialog, ResetPasswordDialog } from './dialogs'
import { exportToExcel } from '@/lib/export'
import { PAGINATION, ROLE_NAMES, AUDIT_MODULE_LABELS, AUDIT_ACTION_LABELS } from '@/lib/constants'
import {
  Download,
  Plus,
  Search,
  MoreHorizontal,
  Edit,
  Key,
  UserCheck,
  UserX,
  Users,
  Shield,
  Activity,
  ShieldAlert,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { User, UserRole, AuditLog } from '@/types'

const USER_PAGE_SIZE = PAGINATION.DEFAULT_PAGE_SIZE
const AUDIT_PAGE_SIZE = 20
/** 用户列表一次性拉取上限（前端筛选/分页），超出时展示截断提示 */
const USER_FETCH_LIMIT = 500

export default function AdminPage() {
  const { can, role: currentRole } = usePermission()
  const canCreateUser = can('admin:users', 'create')
  const canUpdateUser = can('admin:users', 'update')
  const canResetPassword = can('admin:users', 'reset-password')
  const canDeleteUser = can('admin:users', 'delete')
  const canPurgeUser = can('admin:users', 'purge')
  const canExportUser = can('admin:users', 'export')
  const canViewRoles = can('admin:roles', 'view')
  const canCreateRole = can('admin:roles', 'create')
  const canUpdateRole = can('admin:roles', 'update')
  const canDeleteRole = can('admin:roles', 'delete')
  const canManagePermissions = can('admin:permissions', 'update')
  const hasUserActions = canUpdateUser || canResetPassword || canDeleteUser || canPurgeUser

  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [auditPage, setAuditPage] = useState(1)
  // 审计日志筛选：角色/模块/用户关键字/时间范围（任一变化重置到第一页）
  const [auditRole, setAuditRole] = useState('all')
  const [auditModule, setAuditModule] = useState('all')
  const [auditUsername, setAuditUsername] = useState('')
  const [auditStart, setAuditStart] = useState('')
  const [auditEnd, setAuditEnd] = useState('')

  // 弹窗状态
  const [userDialog, setUserDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; user: User | null }>({ open: false, mode: 'create', user: null })
  const [roleDialog, setRoleDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; role: RoleItem | null }>({ open: false, mode: 'create', role: null })
  const [permRole, setPermRole] = useState<RoleItem | null>(null)
  const [resetUser, setResetUser] = useState<User | null>(null)

  // 真实数据（用户量小，取较大页在前端做筛选/分页，保留原交互）
  const { data: usersData } = useUsers({ page: 1, pageSize: USER_FETCH_LIMIT })
  const { data: rolesData } = useRoles()
  const { data: auditData } = useAuditLogs({
    page: auditPage,
    pageSize: AUDIT_PAGE_SIZE,
    role: auditRole === 'all' ? undefined : auditRole,
    module: auditModule === 'all' ? undefined : auditModule,
    username: auditUsername.trim() || undefined,
    startDate: auditStart || undefined,
    endDate: auditEnd || undefined,
  })
  const updateUser = useUpdateUser()
  const disableUser = useDisableUser()
  const deleteRole = useDeleteRole()
  const cloneRole = useCloneRole()
  const purgeUser = usePurgeUser()

  const allUsers = (usersData?.items ?? []) as User[]
  const roles = (rolesData ?? []) as RoleItem[]
  const auditLogs = (auditData?.items ?? []) as AuditLog[]
  const auditTotal = auditData?.total ?? 0
  const usersTruncated = (usersData?.total ?? 0) > USER_FETCH_LIMIT

  // 防提权（前端门禁，后端子集规则兜底）：非 superadmin 不可分配 superadmin 角色
  const assignableRoles = useMemo(
    () => roles.filter((r) => currentRole === 'superadmin' || r.code !== 'superadmin'),
    [roles, currentRole],
  )

  // 角色名称：优先用后端角色列表映射（覆盖自定义/克隆角色），缺失时回退预置常量
  const roleNameMap = useMemo(() => new Map(roles.map((r) => [r.code, r.name])), [roles])
  const getRoleName = (role: UserRole) => roleNameMap.get(role) ?? ROLE_NAMES[role] ?? role

  const filteredUsers = useMemo(
    () =>
      allUsers.filter((user) => {
        if (roleFilter !== 'all' && user.role !== roleFilter) return false
        if (statusFilter !== 'all' && user.status !== statusFilter) return false
        if (searchQuery) {
          const q = searchQuery.toLowerCase()
          if (!user.username.toLowerCase().includes(q) && !user.name.toLowerCase().includes(q)) return false
        }
        return true
      }),
    [allUsers, roleFilter, statusFilter, searchQuery],
  )

  const pagedUsers = filteredUsers.slice((page - 1) * USER_PAGE_SIZE, page * USER_PAGE_SIZE)
  const resetPage = () => setPage(1)

  const stats = {
    total: allUsers.length,
    active: allUsers.filter((u) => u.status === 'active').length,
    inactive: allUsers.filter((u) => u.status === 'inactive').length,
    roles: roles.length,
  }

  const alertError = (fallback: string) => (e: unknown) => window.alert(e instanceof Error ? e.message : fallback)

  /** 停用：走专用 DELETE 接口（后端会同步吊销刷新令牌），需二次确认 */
  const handleDisableUser = (u: User) => {
    if (!window.confirm(`确认停用用户「${u.name}」？停用后其登录会话将失效。`)) return
    disableUser.mutate(u.id, { onError: alertError('停用失败') })
  }

  /** 启用：恢复账号状态 */
  const handleEnableUser = (u: User) => {
    updateUser.mutate({ id: u.id, data: { status: 'active' } }, { onError: alertError('启用失败') })
  }

  const handlePurgeUser = (u: User) => {
    if (!window.confirm(`将物理删除用户「${u.name}」（${u.username}），此操作不可恢复！确认彻底删除？`)) return
    purgeUser.mutate(u.id, { onError: alertError('彻底删除失败') })
  }

  const handleCloneRole = (role: RoleItem) => {
    if (cloneRole.isPending) return
    cloneRole.mutate({ id: role.id, name: `${role.name}-副本` }, { onError: alertError('克隆失败') })
  }

  const handleDeleteRole = (role: RoleItem) => {
    if (!window.confirm(`确认删除角色「${role.name}」？`)) return
    deleteRole.mutate(role.id, { onError: alertError('删除失败') })
  }

  const userColumns: DataTableColumn<User>[] = [
    { key: 'username', header: '用户名', cellClassName: 'font-medium' },
    { key: 'name', header: '姓名' },
    { key: 'role', header: '角色', render: (u) => <Badge variant="outline">{getRoleName(u.role)}</Badge> },
    {
      key: 'dataScope', header: '数据范围', render: (u) => {
        if (u.dataScope === '*' || u.dataScope === '全部') return '全部'
        const codes = (u.dataScopeCodes && u.dataScopeCodes.length > 0) ? u.dataScopeCodes : u.dataScope.split(',').filter(Boolean)
        if (codes.length <= 2) return u.dataScope
        // 多编码时仅展示前 2 个 + 计数，完整列表放 title 提示
        return (
          <span title={codes.join('、')} className="inline-flex items-center gap-1">
            {codes.slice(0, 2).join(',')}
            <Badge variant="secondary">+{codes.length - 2}</Badge>
          </span>
        )
      },
    },
    {
      key: 'status', header: '状态', render: (u) => (
        <Badge variant={u.status === 'active' ? 'success' : 'secondary'}>
          {u.status === 'active' ? '启用' : '停用'}
        </Badge>
      ),
    },
    {
      key: 'lastLoginAt', header: '最近登录', cellClassName: 'text-muted-foreground',
      render: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : '-'),
    },
    {
      key: 'actions', header: '操作', render: (u) =>
        hasUserActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canUpdateUser && (
                <DropdownMenuItem onClick={() => setUserDialog({ open: true, mode: 'edit', user: u })}>
                  <Edit className="mr-2 h-4 w-4" />
                  编辑用户
                </DropdownMenuItem>
              )}
              {canResetPassword && (
                <DropdownMenuItem onClick={() => setResetUser(u)}>
                  <Key className="mr-2 h-4 w-4" />
                  重置密码
                </DropdownMenuItem>
              )}
              {/* 停用走 DELETE（admin:users:delete），启用走 PUT（admin:users:update），门禁分开 */}
              {u.status === 'active' && canDeleteUser && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleDisableUser(u)}>
                    <UserX className="mr-2 h-4 w-4" />
                    停用
                  </DropdownMenuItem>
                </>
              )}
              {u.status === 'inactive' && canUpdateUser && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleEnableUser(u)}>
                    <UserCheck className="mr-2 h-4 w-4" />
                    启用
                  </DropdownMenuItem>
                </>
              )}
              {canPurgeUser && u.status === 'inactive' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handlePurgeUser(u)}>
                    <ShieldAlert className="mr-2 h-4 w-4" />
                    彻底删除
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
  ]

  const auditColumns: DataTableColumn<AuditLog>[] = [
    {
      key: 'createdAt', header: '时间', cellClassName: 'text-muted-foreground whitespace-nowrap',
      render: (log) => new Date(log.createdAt).toLocaleString('zh-CN'),
    },
    { key: 'username', header: '用户', cellClassName: 'font-medium' },
    { key: 'module', header: '模块', render: (log) => AUDIT_MODULE_LABELS[log.module] ?? log.module },
    { key: 'action', header: '操作', render: (log) => AUDIT_ACTION_LABELS[log.action] ?? log.action },
    { key: 'detail', header: '详情', cellClassName: 'text-muted-foreground' },
  ]

  const handleExportUsers = async () => {
    await exportToExcel({
      filename: `用户列表_${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: '用户列表',
      columns: [
        { header: '用户名', key: 'username', width: 16 },
        { header: '姓名', key: 'name', width: 14 },
        { header: '角色', key: 'role', width: 18 },
        { header: '数据范围', key: 'dataScope', width: 14 },
        { header: '状态', key: 'status', width: 10 },
      ],
      rows: filteredUsers.map((u) => ({
        username: u.username,
        name: u.name,
        role: getRoleName(u.role),
        dataScope: u.dataScope === '*' ? '全部' : u.dataScope,
        status: u.status === 'active' ? '启用' : '停用',
      })),
    })
  }

  return (
    <PageContainer title="权限管理" description="管理用户、角色、功能权限和数据权限">
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">总用户数</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">已启用</p>
                <p className="text-2xl font-bold text-success-strong">{stats.active}</p>
              </div>
              <UserCheck className="h-8 w-8 text-success-strong" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">已停用</p>
                <p className="text-2xl font-bold text-destructive">{stats.inactive}</p>
              </div>
              <UserX className="h-8 w-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">角色数</p>
                <p className="text-2xl font-bold">{stats.roles}</p>
              </div>
              <Shield className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 用户管理 */}
      <Card className="animate-fade-in">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>用户管理</CardTitle>
            <div className="flex items-center space-x-2">
              {canExportUser && (
                <Button variant="outline" size="sm" onClick={handleExportUsers}>
                  <Download className="mr-2 h-4 w-4" />
                  导出
                </Button>
              )}
              {canCreateUser && (
                <Button size="sm" onClick={() => setUserDialog({ open: true, mode: 'create', user: null })}>
                  <Plus className="mr-2 h-4 w-4" />
                  新增用户
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-x-2 sm:space-y-0">
            <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); resetPage() }}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部角色</SelectItem>
                {roles.map((role) => (
                  <SelectItem key={role.code} value={role.code}>{role.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); resetPage() }}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="选择状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="active">启用</SelectItem>
                <SelectItem value="inactive">停用</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索用户名或姓名..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); resetPage() }}
                className="pl-8"
              />
            </div>
          </div>

          <div className="min-h-[360px]">
            {usersTruncated && (
              <p className="mb-2 text-sm text-warning-strong">
                用户总数超过 {USER_FETCH_LIMIT}，当前仅展示前 {USER_FETCH_LIMIT} 条，请用搜索缩小范围
              </p>
            )}
            <DataTable columns={userColumns} data={pagedUsers} rowKey={(u) => u.id} emptyText="暂无用户" />
          </div>

          <Pagination page={page} pageSize={USER_PAGE_SIZE} total={filteredUsers.length} onPageChange={setPage} />
        </CardContent>
      </Card>

      {/* 角色管理 */}
      {canViewRoles && (
        <Card className="animate-fade-in">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>角色管理</CardTitle>
              {canCreateRole && (
                <Button size="sm" onClick={() => setRoleDialog({ open: true, mode: 'create', role: null })}>
                  <Plus className="mr-2 h-4 w-4" />
                  新增角色
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          </CardContent>
        </Card>
      )}

      {/* 审计日志 */}
      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Activity className="mr-2 h-5 w-5" />
            审计日志
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 筛选行：角色 / 模块 / 时间范围 / 用户关键字（任一变化重置到第一页） */}
          <div className="flex flex-col space-y-2 lg:flex-row lg:items-center lg:space-x-2 lg:space-y-0">
            <Select value={auditRole} onValueChange={(v) => { setAuditRole(v); setAuditPage(1) }}>
              <SelectTrigger className="w-full lg:w-[160px]">
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部角色</SelectItem>
                {roles.map((role) => (
                  <SelectItem key={role.code} value={role.code}>{role.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={auditModule} onValueChange={(v) => { setAuditModule(v); setAuditPage(1) }}>
              <SelectTrigger className="w-full lg:w-[160px]">
                <SelectValue placeholder="选择模块" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部模块</SelectItem>
                {Object.entries(AUDIT_MODULE_LABELS).map(([code, label]) => (
                  <SelectItem key={code} value={code}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center space-x-2">
              <Input
                type="date"
                value={auditStart}
                onChange={(e) => { setAuditStart(e.target.value); setAuditPage(1) }}
                className="w-full lg:w-[150px]"
              />
              <span className="text-muted-foreground">至</span>
              <Input
                type="date"
                value={auditEnd}
                onChange={(e) => { setAuditEnd(e.target.value); setAuditPage(1) }}
                className="w-full lg:w-[150px]"
              />
            </div>

            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索操作用户名..."
                value={auditUsername}
                onChange={(e) => { setAuditUsername(e.target.value); setAuditPage(1) }}
                className="pl-8"
              />
            </div>
          </div>

          <DataTable columns={auditColumns} data={auditLogs} rowKey={(log) => log.id} emptyText="暂无审计日志" />
          <Pagination page={auditPage} pageSize={AUDIT_PAGE_SIZE} total={auditTotal} onPageChange={setAuditPage} />
        </CardContent>
      </Card>

      {/* 弹窗 */}
      <UserDialog
        open={userDialog.open}
        mode={userDialog.mode}
        user={userDialog.user}
        roles={assignableRoles.map((r) => ({ code: r.code, name: r.name }))}
        onClose={() => setUserDialog((s) => ({ ...s, open: false }))}
      />
      <RoleDialog
        open={roleDialog.open}
        mode={roleDialog.mode}
        role={roleDialog.role}
        onClose={() => setRoleDialog((s) => ({ ...s, open: false }))}
      />
      <PermissionDialog open={!!permRole} role={permRole} onClose={() => setPermRole(null)} />
      <ResetPasswordDialog open={!!resetUser} user={resetUser} onClose={() => setResetUser(null)} />
    </PageContainer>
  )
}
