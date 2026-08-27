import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { usePermission } from '@/hooks/usePermission'
import { useRoles, useDeleteRole, type RoleItem } from '@/hooks/api-queries'
import { RoleDialog, PermissionDialog, CloneRoleDialog, BatchPermissionDialog } from './dialogs'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { FlashMessage } from '@/components/ui/flash-message'
import { Skeleton } from '@/components/ui/skeleton'
import { isHighRiskPermission } from '@/lib/permissions'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Copy,
  Edit,
  LayoutGrid,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  Table as TableIcon,
  UserPlus,
} from 'lucide-react'

type RoleTypeFilter = 'all' | 'system' | 'custom'
type ViewMode = 'card' | 'table'

/** 视图模式持久化键：用户选择写入 localStorage，下次访问恢复 */
const VIEW_MODE_KEY = 'roles-view-mode'
/** 表格视图最小屏宽：<768px 自动回退卡片视图（表格小屏体验不佳） */
const TABLE_VIEW_MIN_WIDTH = '(min-width: 768px)'

/** 表格视图行模型：排序键均为可直接比较的原始值（名称/编码/类型序/计数/ISO 时间） */
interface RoleTableRow {
  id: string
  name: string
  code: string
  isSystem: boolean
  typeOrder: number
  typeLabel: string
  permCount: number
  highRiskCount: number
  userCount: number | null
  createdAt: string
  createdAtLabel: string
  role: RoleItem
}

/** 角色管理：角色的创建、编辑、删除、克隆与权限配置（预置角色只读）；卡片/表格双视图。 */
export default function RolesPage() {
  // 吸顶测量：标题区 + 筛选卡高度实时测量，驱动筛选卡/表格容器吸顶偏移
  const { headerRef, filterRef, headerHeight, filterHeight } = useStickyHeader()
  const stickyTop = headerHeight + filterHeight
  const { can } = usePermission()
  const canCreateRole = can('admin:roles', 'create')
  const canUpdateRole = can('admin:roles', 'update')
  const canDeleteRole = can('admin:roles', 'delete')
  const canManagePermissions = can('admin:permissions', 'update')
  const hasRowActions = canCreateRole || canUpdateRole || canDeleteRole || canManagePermissions

  // 弹窗状态
  const [roleDialog, setRoleDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; role: RoleItem | null }>({ open: false, mode: 'create', role: null })
  const [permRole, setPermRole] = useState<RoleItem | null>(null)
  const [cloneRole, setCloneRole] = useState<RoleItem | null>(null)
  const [batchRoles, setBatchRoles] = useState<RoleItem[] | null>(null)

  // 列表筛选与操作反馈
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<RoleTypeFilter>('all')
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 视图模式：默认卡片；用户选择持久化；小屏（<768px）强制卡片
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'table' ? 'table' : 'card'
    } catch {
      return 'card'
    }
  })
  const [isLargeScreen, setIsLargeScreen] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(TABLE_VIEW_MIN_WIDTH).matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(TABLE_VIEW_MIN_WIDTH)
    const onChange = (e: MediaQueryListEvent) => setIsLargeScreen(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const effectiveView: ViewMode = isLargeScreen ? viewMode : 'card'
  const setViewModeSafe = (v: ViewMode) => {
    setViewMode(v)
    try {
      localStorage.setItem(VIEW_MODE_KEY, v)
    } catch {
      /* 隐私模式等场景忽略持久化失败 */
    }
  }

  // 表格视图行选择（切换视图时清空，避免跨视图脏选）
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set())
  useEffect(() => {
    setSelectedKeys(new Set())
  }, [effectiveView])

  const { data: rolesData, isLoading } = useRoles()
  const deleteRole = useDeleteRole()
  const { confirm, element: confirmElement } = useConfirm()

  const roles = useMemo(() => (rolesData ?? []) as RoleItem[], [rolesData])

  /** 统计卡片：总数 / 系统 / 自定义 / 含高危权限角色数 */
  const stats = useMemo(() => {
    const system = roles.filter((r) => r.isSystem).length
    return {
      total: roles.length,
      system,
      custom: roles.length - system,
      highRisk: roles.filter((r) => (r.permissions ?? []).some((p) => isHighRiskPermission(p.resource))).length,
    }
  }, [roles])

  const highRiskCount = (role: RoleItem) => (role.permissions ?? []).filter((p) => isHighRiskPermission(p.resource)).length

  const filteredRoles = useMemo(() => {
    const kw = searchQuery.trim().toLowerCase()
    return roles.filter((role) => {
      if (typeFilter === 'system' && !role.isSystem) return false
      if (typeFilter === 'custom' && role.isSystem) return false
      if (!kw) return true
      return (
        role.name.toLowerCase().includes(kw) ||
        role.code.toLowerCase().includes(kw) ||
        (role.description ?? '').toLowerCase().includes(kw)
      )
    })
  }, [roles, searchQuery, typeFilter])

  /** 表格视图行模型（排序键可比较：类型用 typeOrder、计数用数值、时间用 ISO 串） */
  const tableRows = useMemo<RoleTableRow[]>(
    () =>
      filteredRoles.map((role) => ({
        id: role.id,
        name: role.name,
        code: role.code,
        isSystem: role.isSystem,
        typeOrder: role.isSystem ? 0 : 1,
        typeLabel: role.isSystem ? '系统' : '自定义',
        permCount: role.permissions.length,
        highRiskCount: highRiskCount(role),
        userCount: role.userCount ?? null,
        createdAt: role.createdAt ?? '',
        createdAtLabel: role.createdAt ? new Date(role.createdAt).toLocaleDateString('zh-CN') : '-',
        role,
      })),
    [filteredRoles],
  )

  const handleDeleteRole = async (role: RoleItem) => {
    const ok = await confirm({
      title: '删除角色',
      description: `确认删除角色「${role.name}」？删除后不可恢复，该角色仍存在活跃用户时将被拒绝。`,
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    deleteRole.mutate(role.id, {
      onSuccess: () => setFlash({ type: 'success', text: `已删除角色「${role.name}」` }),
      onError: (e) => setFlash({ type: 'error', text: e instanceof Error ? e.message : '删除失败' }),
    })
  }

  // ===== 表格视图列定义 =====
  const tableColumns: DataTableColumn<RoleTableRow>[] = [
    {
      key: 'name',
      header: '角色名称',
      sortable: true,
      width: 170,
      minWidth: 120,
      render: (row) =>
        canUpdateRole ? (
          <button
            type="button"
            onClick={() => setRoleDialog({ open: true, mode: 'edit', role: row.role })}
            className="font-medium text-primary hover:underline"
          >
            {row.name}
          </button>
        ) : (
          <span className="font-medium">{row.name}</span>
        ),
    },
    {
      key: 'code',
      header: '角色编码',
      sortable: true,
      width: 150,
      minWidth: 110,
      cellClassName: 'font-mono text-xs text-muted-foreground',
    },
    {
      key: 'typeOrder',
      header: '类型',
      sortable: true,
      align: 'center',
      width: 80,
      minWidth: 70,
      render: (row) => <Badge variant={row.isSystem ? 'secondary' : 'outline'}>{row.typeLabel}</Badge>,
    },
    {
      key: 'permCount',
      header: '权限数',
      sortable: true,
      align: 'right',
      width: 76,
      minWidth: 66,
      cellClassName: 'font-num',
    },
    {
      key: 'userCount',
      header: '成员数',
      sortable: true,
      align: 'right',
      width: 76,
      minWidth: 66,
      cellClassName: 'font-num',
      render: (row) => row.userCount ?? '-',
    },
    {
      key: 'highRiskCount',
      header: '高危',
      sortable: true,
      align: 'center',
      width: 70,
      minWidth: 60,
      render: (row) =>
        row.highRiskCount > 0 ? <Badge variant="destructive">高危</Badge> : <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'createdAt',
      header: '创建时间',
      sortable: true,
      width: 100,
      minWidth: 90,
      cellClassName: 'text-muted-foreground',
      render: (row) => row.createdAtLabel,
    },
    {
      key: 'actions',
      header: '操作',
      align: 'center',
      sticky: 'right',
      width: 190,
      minWidth: 170,
      render: (row) => (
        <div className="flex items-center justify-center gap-0.5">
          {canUpdateRole && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setRoleDialog({ open: true, mode: 'edit', role: row.role })}
            >
              <Edit className="mr-1 h-3.5 w-3.5" />
              编辑
            </Button>
          )}
          {canManagePermissions && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setPermRole(row.role)}>
              <Shield className="mr-1 h-3.5 w-3.5" />
              权限
            </Button>
          )}
          {(canCreateRole || (canDeleteRole && !row.role.isSystem)) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canCreateRole && (
                  <DropdownMenuItem onClick={() => setCloneRole(row.role)}>
                    <Copy className="mr-2 h-4 w-4" />
                    克隆角色
                  </DropdownMenuItem>
                )}
                {canDeleteRole && !row.role.isSystem && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteRole(row.role)}>
                      删除角色
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ),
    },
  ]

  /** 表格空态：真无角色 / 筛选无匹配 区分提示 */
  const tableEmpty = (
    <div className="flex flex-col items-center gap-2 py-6">
      {roles.length === 0 ? (
        <>
          <Shield className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-foreground">暂无角色</p>
          <p className="text-xs text-muted-foreground">点击右上角「新增角色」创建</p>
        </>
      ) : (
        <>
          <Search className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-foreground">无匹配角色</p>
          <p className="text-xs text-muted-foreground">请调整搜索关键词或类型筛选</p>
        </>
      )}
    </div>
  )

  return (
    <PageContainer title="角色管理" stickyHeader headerRef={headerRef}>
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in">
        <Card className="border border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">角色总数</p>
                <p className="mt-1 font-num text-2xl font-bold">{stats.total}</p>
              </div>
              <Shield className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">系统角色</p>
                <p className="mt-1 font-num text-2xl font-bold text-info">{stats.system}</p>
              </div>
              <Lock className="h-8 w-8 text-info" />
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">自定义角色</p>
                <p className="mt-1 font-num text-2xl font-bold text-primary">{stats.custom}</p>
              </div>
              <UserPlus className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">含高危权限</p>
                <p className="mt-1 font-num text-2xl font-bold text-destructive">{stats.highRisk}</p>
              </div>
              <ShieldAlert className="h-8 w-8 text-destructive" />
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

      {/* 工具条：搜索 + 类型筛选 + 视图切换（仅中大屏）+ 新增（筛选卡，吸顶） */}
      <Card ref={filterRef} className="sticky z-10 rounded-card p-4" style={{ top: headerHeight }}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索角色名称、编码或描述..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as RoleTypeFilter)}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="类型筛选" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部角色</SelectItem>
            <SelectItem value="system">系统角色</SelectItem>
            <SelectItem value="custom">自定义角色</SelectItem>
          </SelectContent>
        </Select>
        {isLargeScreen && (
          <Tabs value={viewMode} onValueChange={(v) => setViewModeSafe(v as ViewMode)}>
            <TabsList variant="line">
              <TabsTrigger value="card" className="gap-1 px-3 text-xs">
                <LayoutGrid className="h-3.5 w-3.5" />
                卡片
              </TabsTrigger>
              <TabsTrigger value="table" className="gap-1 px-3 text-xs">
                <TableIcon className="h-3.5 w-3.5" />
                表格
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {canCreateRole && (
          <Button size="sm" onClick={() => setRoleDialog({ open: true, mode: 'create', role: null })}>
            <Plus className="mr-2 h-4 w-4" />
            新增角色
          </Button>
        )}
      </div>
      </Card>

      {effectiveView === 'table' && isLargeScreen ? (
        /* ===== 表格视图（表格卡：卡头 + 批量操作条 + DataTable，表格容器吸顶） ===== */
        <Card className="animate-fade-in rounded-card border border-border">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <TableIcon className="h-4 w-4" />
              角色列表
              <span className="ml-1 text-xs font-normal text-muted-foreground">共 {filteredRoles.length} 个角色</span>
            </h3>
            {selectedKeys.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  已选 <span className="font-num font-medium">{selectedKeys.size}</span> 项
                </span>
                <Button variant="outline" size="sm" disabled={!canManagePermissions} onClick={() => setBatchRoles(tableRows.filter((r) => selectedKeys.has(r.id)).map((r) => r.role))}>
                  <Shield className="mr-1 h-3.5 w-3.5" />
                  批量分配权限
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedKeys(new Set())}>
                  取消选择
                </Button>
              </div>
            )}
          </div>
          <div className="p-2">
            <div className="sticky rounded-card bg-background" style={{ top: stickyTop }}>
              <DataTable
                columns={tableColumns}
                data={tableRows}
                rowKey={(r) => r.id}
                caption="角色列表"
                emptyText={tableEmpty}
                loading={isLoading && !rolesData}
                loadingRows={6}
                maxHeight={`calc(100dvh - ${stickyTop}px - 24px)`}
                resizable
                rowSelection={hasRowActions ? { selectedKeys, onSelectionChange: setSelectedKeys, selectAllLabel: '全选当前角色' } : undefined}
              />
            </div>
          </div>
        </Card>
      ) : (
        /* ===== 卡片视图（角色卡网格，卡片化形态保持，不套外层卡） ===== */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-fade-in">
          {isLoading && !rolesData
            ? Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="border border-border">
                  <CardContent className="space-y-3 pt-5">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-8 w-full" />
                  </CardContent>
                </Card>
              ))
            : filteredRoles.map((role) => (
                <Card key={role.id} className="flex flex-col border border-border">
                  <CardContent className="flex flex-1 flex-col pt-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate font-medium">{role.name}</h4>
                          {role.isSystem && <Badge variant="secondary">系统</Badge>}
                          {highRiskCount(role) > 0 && <Badge variant="destructive">高危</Badge>}
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">{role.code}</p>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 min-h-10 text-sm text-muted-foreground">{role.description || '暂无描述'}</p>
                    {/* 统计行：权限数 / 高危数 / 成员数 */}
                    <div className="mt-4 flex items-center gap-5 border-t pt-3 text-body text-muted-foreground">
                      <span>权限 <span className="font-num font-medium text-foreground">{role.permissions.length}</span></span>
                      <span>高危 <span className="font-num font-medium text-destructive">{highRiskCount(role)}</span></span>
                      <span>成员 <span className="font-num font-medium text-foreground">{role.userCount ?? '-'}</span></span>
                    </div>
                    {/* 操作区：权限/编辑常驻，克隆/删除收进下拉 */}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {canManagePermissions && (
                        <Button variant="outline" size="sm" onClick={() => setPermRole(role)}>
                          <Shield className="mr-2 h-4 w-4" />
                          权限
                        </Button>
                      )}
                      {canUpdateRole && (
                        <Button variant="ghost" size="sm" onClick={() => setRoleDialog({ open: true, mode: 'edit', role })}>
                          <Edit className="mr-2 h-4 w-4" />
                          编辑
                        </Button>
                      )}
                      {(canCreateRole || (canDeleteRole && !role.isSystem)) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="ml-auto">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canCreateRole && (
                              <DropdownMenuItem onClick={() => setCloneRole(role)}>
                                <Copy className="mr-2 h-4 w-4" />
                                克隆角色
                              </DropdownMenuItem>
                            )}
                            {canDeleteRole && !role.isSystem && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteRole(role)}>
                                  删除角色
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
        </div>
      )}
      {effectiveView === 'card' && !isLoading && filteredRoles.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">无匹配角色</p>
      )}

      {/* 弹窗 */}
      <RoleDialog
        open={roleDialog.open}
        mode={roleDialog.mode}
        role={roleDialog.role}
        onClose={() => setRoleDialog((s) => ({ ...s, open: false }))}
        onSaved={(name) => setFlash({ type: 'success', text: `已保存角色「${name}」` })}
      />
      <PermissionDialog
        open={!!permRole}
        role={permRole}
        onClose={() => setPermRole(null)}
        onSaved={(name) => setFlash({ type: 'success', text: `已保存角色「${name}」的权限` })}
      />
      <CloneRoleDialog
        open={!!cloneRole}
        role={cloneRole}
        onClose={() => setCloneRole(null)}
        onSaved={(name) => setFlash({ type: 'success', text: `已克隆角色「${name}」` })}
      />
      <BatchPermissionDialog
        open={batchRoles !== null && batchRoles.length > 0}
        roles={batchRoles}
        onClose={() => setBatchRoles(null)}
        onSaved={(names) => {
          setSelectedKeys(new Set())
          setFlash({ type: 'success', text: `已为 ${names.length} 个角色批量配置权限` })
        }}
      />
      {confirmElement}
    </PageContainer>
  )
}
