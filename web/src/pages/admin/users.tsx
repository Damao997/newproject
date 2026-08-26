import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { FlashMessage } from '@/components/ui/flash-message'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'
import { usePermission } from '@/hooks/usePermission'
import { useUsers, useRoles, useUpdateUser, useDisableUser, usePurgeUser, type RoleItem } from '@/hooks/api-queries'
import { UserDialog, ResetPasswordDialog } from './dialogs'
import { exportToExcel } from '@/lib/export'
import { PAGINATION, ROLE_NAMES } from '@/lib/constants'
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
  ShieldAlert,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { User, UserRole } from '@/types'

const USER_PAGE_SIZE = PAGINATION.DEFAULT_PAGE_SIZE
/** 用户列表一次性拉取上限（前端筛选/分页），超出时展示截断提示 */
const USER_FETCH_LIMIT = 500

/** 用户管理：用户增删改查、角色分配与启用/停用状态管理。 */
export default function UsersPage() {
  const { can, role: currentRole } = usePermission()
  // 吸顶测量：标题区 + 筛选卡高度实时测量，驱动筛选卡/表格容器吸顶偏移
  const { headerRef, filterRef, headerHeight, filterHeight } = useStickyHeader()
  const stickyTop = headerHeight + filterHeight
  const canCreateUser = can('admin:users', 'create')
  const canUpdateUser = can('admin:users', 'update')
  const canResetPassword = can('admin:users', 'reset-password')
  const canDeleteUser = can('admin:users', 'delete')
  const canPurgeUser = can('admin:users', 'purge')
  const canExportUser = can('admin:users', 'export')
  const hasUserActions = canUpdateUser || canResetPassword || canDeleteUser || canPurgeUser

  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)

  // 弹窗状态
  const [userDialog, setUserDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; user: User | null }>({ open: false, mode: 'create', user: null })
  const [resetUser, setResetUser] = useState<User | null>(null)

  // 操作反馈（成功/失败，自动消失）
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 确认对话框：停用 danger 红色；彻底删除 danger + 输入用户名防呆
  const { confirm, element: confirmElement } = useConfirm()

  // 真实数据（用户量小，取较大页在前端做筛选/分页，保留原交互）
  const { data: usersData } = useUsers({ page: 1, pageSize: USER_FETCH_LIMIT })
  const { data: rolesData } = useRoles()
  const updateUser = useUpdateUser()
  const disableUser = useDisableUser()
  const purgeUser = usePurgeUser()

  const allUsers = useMemo(() => (usersData?.items ?? []) as User[], [usersData])
  const roles = useMemo(() => (rolesData ?? []) as RoleItem[], [rolesData])
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
  }

  const alertError = (fallback: string) => (e: unknown) => setFlash({ type: 'error', text: e instanceof Error ? e.message : fallback })

  /** 停用：走专用 DELETE 接口（后端会同步吊销刷新令牌），需二次确认 */
  const handleDisableUser = async (u: User) => {
    const ok = await confirm({
      title: '停用用户',
      description: `确认停用用户「${u.name}」？停用后其登录会话将失效。`,
      confirmText: '停用',
      danger: true,
    })
    if (!ok) return
    disableUser.mutate(u.id, {
      onSuccess: () => setFlash({ type: 'success', text: `已停用用户「${u.name}」` }),
      onError: alertError('停用失败'),
    })
  }

  /** 启用：恢复账号状态 */
  const handleEnableUser = (u: User) => {
    updateUser.mutate({ id: u.id, data: { status: 'active' } }, {
      onSuccess: () => setFlash({ type: 'success', text: `已启用用户「${u.name}」` }),
      onError: alertError('启用失败'),
    })
  }

  const handlePurgeUser = async (u: User) => {
    const ok = await confirm({
      title: '彻底删除用户',
      description: `将物理删除用户「${u.name}」（${u.username}），此操作不可恢复！请输入用户名确认。`,
      confirmText: '彻底删除',
      danger: true,
      requireInput: u.username,
    })
    if (!ok) return
    purgeUser.mutate(u.id, {
      onSuccess: () => setFlash({ type: 'success', text: `已彻底删除用户「${u.name}」` }),
      onError: alertError('彻底删除失败'),
    })
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
    <PageContainer title="用户管理" stickyHeader headerRef={headerRef}>
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in">
        <Card className="border border-border">
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
        <Card className="border border-border">
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
        <Card className="border border-border">
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
      </div>

      {/* 操作反馈条（成功/失败，自动消失） */}
      {flash && (
        <FlashMessage type={flash.type} autoHideMs={4000} onAutoHide={() => setFlash(null)}>
          {flash.text}
        </FlashMessage>
      )}

      {/* 用户列表（筛选卡 + 表格卡，筛选卡/表格容器吸顶） */}
      <Card className="animate-fade-in rounded-card border border-border">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h3 className="text-base font-semibold tracking-tight">用户列表</h3>
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

        {/* 控制层：筛选工具条（筛选卡，吸顶） */}
        <Card ref={filterRef} className="sticky z-10 m-4 rounded-card" style={{ top: headerHeight }}>
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
        </Card>

          {/* 展示层：用户表格（表格容器吸顶） */}
          <div className="min-h-[360px] px-4 pb-4">
            {usersTruncated && (
              <p className="mb-2 text-sm text-warning-strong">
                用户总数超过 {USER_FETCH_LIMIT}，当前仅展示前 {USER_FETCH_LIMIT} 条，请用搜索缩小范围
              </p>
            )}
            <div className="sticky rounded-card bg-background" style={{ top: stickyTop }}>
              <DataTable columns={userColumns} data={pagedUsers} rowKey={(u) => u.id} emptyText="暂无用户" maxHeight={`calc(100dvh - ${stickyTop}px - 24px)`} />
            </div>
          </div>

          <div className="border-t px-4 py-2.5">
            <Pagination page={page} pageSize={USER_PAGE_SIZE} total={filteredUsers.length} onPageChange={setPage} />
          </div>
      </Card>

      {/* 弹窗 */}
      <UserDialog
        open={userDialog.open}
        mode={userDialog.mode}
        user={userDialog.user}
        roles={assignableRoles.map((r) => ({ code: r.code, name: r.name }))}
        onClose={() => setUserDialog((s) => ({ ...s, open: false }))}
        onSaved={(name) => setFlash({ type: 'success', text: `已保存用户「${name}」` })}
      />
      <ResetPasswordDialog
        open={!!resetUser}
        user={resetUser}
        onClose={() => setResetUser(null)}
        onSuccess={() => setFlash({ type: 'success', text: '密码已重置，首次登录须修改' })}
      />
      {confirmElement}
    </PageContainer>
  )
}
