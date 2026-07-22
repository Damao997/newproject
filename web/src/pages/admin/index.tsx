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
import { exportToExcel } from '@/lib/export'
import { PAGINATION } from '@/lib/constants'
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
  Activity
} from 'lucide-react'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu'
import { mockUsers, mockRoles, mockAuditLogs } from '@/mock/data'
import type { User, UserRole, AuditLog } from '@/types'

const USER_PAGE_SIZE = PAGINATION.DEFAULT_PAGE_SIZE

export default function AdminPage() {
  const { can } = usePermission()
  const canCreateUser = can('admin:users', 'create')
  const canUpdateUser = can('admin:users', 'update')
  const canResetPassword = can('admin:users', 'reset-password')
  const canDeleteUser = can('admin:users', 'delete')
  const canExportUser = can('admin:users', 'export')
  const canViewRoles = can('admin:roles', 'view')
  const canCreateRole = can('admin:roles', 'create')
  const canUpdateRole = can('admin:roles', 'update')
  const canManagePermissions = can('admin:permissions', 'update')
  const hasUserActions = canUpdateUser || canResetPassword || canDeleteUser

  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)

  const getRoleName = (role: UserRole) => {
    const roleMap: Record<UserRole, string> = {
      admin: '管理员',
      finance_manager: '财务主管',
      department_manager: '部门经理',
      viewer: '查看者',
      finance_analyst_it: '财务分析师(兼IT)',
    }
    return roleMap[role]
  }

  const filteredUsers = useMemo(() => mockUsers.filter(user => {
    if (roleFilter !== 'all' && user.role !== roleFilter) return false
    if (statusFilter !== 'all' && user.status !== statusFilter) return false
    if (searchQuery && !user.username.includes(searchQuery) && !user.name.includes(searchQuery)) return false
    return true
  }), [roleFilter, statusFilter, searchQuery])

  const pagedUsers = filteredUsers.slice((page - 1) * USER_PAGE_SIZE, page * USER_PAGE_SIZE)
  const resetPage = () => setPage(1)

  const stats = {
    total: mockUsers.length,
    active: mockUsers.filter(u => u.status === 'active').length,
    inactive: mockUsers.filter(u => u.status === 'inactive').length,
    roles: mockRoles.length,
  }

  const userColumns: DataTableColumn<User>[] = [
    { key: 'username', header: '用户名', cellClassName: 'font-medium' },
    { key: 'name', header: '姓名' },
    { key: 'role', header: '角色', render: (u) => <Badge variant="outline">{getRoleName(u.role)}</Badge> },
    { key: 'dataScope', header: '数据范围', render: (u) => (u.dataScope === '*' ? '全部' : u.dataScope) },
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
                <DropdownMenuItem>
                  <Edit className="mr-2 h-4 w-4" />
                  编辑用户
                </DropdownMenuItem>
              )}
              {canResetPassword && (
                <DropdownMenuItem>
                  <Key className="mr-2 h-4 w-4" />
                  重置密码
                </DropdownMenuItem>
              )}
              {canDeleteUser && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    {u.status === 'active' ? (
                      <>
                        <UserX className="mr-2 h-4 w-4" />
                        停用
                      </>
                    ) : (
                      <>
                        <UserCheck className="mr-2 h-4 w-4" />
                        启用
                      </>
                    )}
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
    { key: 'module', header: '模块' },
    { key: 'action', header: '操作' },
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
        { header: '最近登录', key: 'lastLoginAt', width: 22 },
      ],
      rows: filteredUsers.map((u) => ({
        username: u.username,
        name: u.name,
        role: getRoleName(u.role),
        dataScope: u.dataScope === '*' ? '全部' : u.dataScope,
        status: u.status === 'active' ? '启用' : '停用',
        lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : '-',
      })),
    })
  }

  return (
    <PageContainer
      title="权限管理"
      description="管理用户、角色、功能权限和数据权限"
    >
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
                <p className="text-2xl font-bold text-green-600">{stats.active}</p>
              </div>
              <UserCheck className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">已停用</p>
                <p className="text-2xl font-bold text-red-600">{stats.inactive}</p>
              </div>
              <UserX className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">预置角色</p>
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
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  新增用户
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 筛选栏 */}
          <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-x-2 sm:space-y-0">
            <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); resetPage() }}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部角色</SelectItem>
                {mockRoles.map(role => (
                  <SelectItem key={role.code} value={role.code}>
                    {role.name}
                  </SelectItem>
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

          {/* 用户表格 */}
          <DataTable
            columns={userColumns}
            data={pagedUsers}
            rowKey={(u) => u.id}
            emptyText="暂无用户"
          />

          {/* 分页 */}
          <Pagination
            page={page}
            pageSize={USER_PAGE_SIZE}
            total={filteredUsers.length}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      {/* 角色管理 */}
      {canViewRoles && (
        <Card className="animate-fade-in">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>角色管理</CardTitle>
              {canCreateRole && (
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  新增角色
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {mockRoles.map((role) => (
                <Card key={role.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium">{role.name}</h4>
                        <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
                      </div>
                      {role.isSystem && (
                        <Badge variant="secondary">系统</Badge>
                      )}
                    </div>
                    {(canUpdateRole || canManagePermissions) && (
                      <div className="mt-4 flex items-center space-x-2">
                        {canUpdateRole && (
                          <Button variant="outline" size="sm">
                            <Edit className="mr-2 h-4 w-4" />
                            编辑
                          </Button>
                        )}
                        {canManagePermissions && (
                          <Button variant="ghost" size="sm">
                            <Shield className="mr-2 h-4 w-4" />
                            权限
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
        <CardContent>
          <DataTable
            columns={auditColumns}
            data={mockAuditLogs}
            rowKey={(log) => log.id}
            emptyText="暂无审计日志"
          />
        </CardContent>
      </Card>
    </PageContainer>
  )
}
