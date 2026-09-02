import { useMemo, useState } from 'react'
import { Copy, Edit, Lock, Plus, Search, ShieldCheck, Trash2, UserCog } from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pill } from '@/components/ui/pill'
import { Checkbox } from '@/components/ui/checkbox'
import { FlashMessage } from '@/components/ui/flash-message'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import {
  useRoles,
  usePermissions,
  useDeleteRole,
  type RoleItem,
} from '@/hooks/api-queries'
import { usePermission } from '@/hooks/usePermission'
import { isHighRiskPermission } from '@/lib/permissions'
import { PERMISSION_MODULE_LABELS } from '@/lib/constants'
import { RoleDialog, CloneRoleDialog, PermissionDialog, BatchPermissionDialog } from './dialogs'

/**
 * 角色管理：角色列表（卡片/表格双视图）、新建/编辑/删除/克隆、
 * 角色 × 模块权限矩阵与多角色批量权限（数据全部来自真实接口）
 */

const VIEW_KEY = 'roles-view-mode'

type CellState = 'on' | 'half' | 'off'

interface PermItem {
  id: string
  resource: string
  action: string
}

/** 角色头像色板（按索引循环，保留设计稿卡片视觉） */
const ROLE_COLORS: Array<{ color: string; bg: string }> = [
  { color: '#1677ff', bg: '#e6f4ff' },
  { color: '#52c41a', bg: '#f6ffed' },
  { color: '#fa8c16', bg: '#fff7e6' },
  { color: '#722ed1', bg: '#f9f0ff' },
  { color: '#13c2c2', bg: '#e6fffb' },
  { color: '#eb2f96', bg: '#fff0f6' },
]

function RoleAvatar({ role, index, size = 'md' }: { role: RoleItem; index: number; size?: 'md' | 'sm' }) {
  const palette = ROLE_COLORS[index % ROLE_COLORS.length]
  const short = role.name.slice(0, 2)
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-semibold',
        size === 'md' ? 'h-9 w-9 text-sm' : 'h-6 w-6 text-[11px]',
      )}
      style={{ background: palette.bg, color: palette.color }}
    >
      {short}
    </span>
  )
}

function KpiCard({ label, value, dotClass }: { label: string; value: number; dotClass: string }) {
  return (
    <div className="rounded-card border border-border bg-card px-5 py-4">
      <div className="text-[13px] text-muted-foreground">
        <span className={cn('mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle', dotClass)} />
        {label}
      </div>
      <div className="mt-1 text-[24px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}

/** 角色行操作菜单（表格/卡片共用） */
function RoleActions({
  role,
  canUpdate,
  canCreate,
  canDelete,
  canUpdatePerms,
  onEdit,
  onClone,
  onPerms,
  onDelete,
}: {
  role: RoleItem
  canUpdate: boolean
  canCreate: boolean
  canDelete: boolean
  canUpdatePerms: boolean
  onEdit: () => void
  onClone: () => void
  onPerms: () => void
  onDelete: () => void
}) {
  if (!canUpdate && !canCreate && !canDelete && !canUpdatePerms) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 px-0" aria-label={`操作 ${role.name}`}>
          <UserCog className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canUpdate && <DropdownMenuItem onClick={onEdit}>编辑</DropdownMenuItem>}
        {canCreate && <DropdownMenuItem onClick={onClone}>克隆</DropdownMenuItem>}
        {canUpdatePerms && <DropdownMenuItem onClick={onPerms}>权限配置</DropdownMenuItem>}
        {canDelete && !role.isSystem && (
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>
            删除
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function RolesPage() {
  const { can } = usePermission()
  const canCreate = can('admin:roles', 'create')
  const canUpdate = can('admin:roles', 'update')
  const canDelete = can('admin:roles', 'delete')
  const canUpdatePerms = can('admin:permissions', 'update')

  const { data: rolesData, isLoading: rolesLoading, isError: rolesError, refetch } = useRoles()
  const { data: permsData } = usePermissions()
  const deleteRole = useDeleteRole()
  const { confirm, element: confirmElement } = useConfirm()

  const roles = (rolesData ?? []) as RoleItem[]
  const perms = (permsData ?? []) as PermItem[]

  // ---- 搜索 / 视图切换 ----
  const [keyword, setKeyword] = useState('')
  const [viewMode, setViewMode] = useState<'card' | 'table'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'card'
    } catch {
      return 'card'
    }
  })
  // 中大屏才提供卡片/表格视图切换（小屏固定卡片；jsdom 无 matchMedia 时安全降级）
  const canSwitchView = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    try {
      return window.matchMedia('(min-width: 768px)').matches
    } catch {
      return false
    }
  }, [])

  const handleViewChange = (v: string) => {
    if (v !== 'card' && v !== 'table') return
    setViewMode(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // localStorage 不可用时忽略持久化
    }
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return roles
    return roles.filter(
      (r) => r.name.toLowerCase().includes(kw) || r.code.toLowerCase().includes(kw) || (r.description ?? '').toLowerCase().includes(kw),
    )
  }, [roles, keyword])

  // ---- KPI（当前角色清单派生） ----
  const kpis = useMemo(() => {
    const system = roles.filter((r) => r.isSystem).length
    const highRisk = roles.filter((r) => (r.permissions ?? []).some((p) => isHighRiskPermission(p.resource))).length
    return [
      { label: '角色总数', value: roles.length, dotClass: 'bg-[#1677ff]' },
      { label: '系统角色', value: system, dotClass: 'bg-[#52c41a]' },
      { label: '自定义角色', value: roles.length - system, dotClass: 'bg-[#fa8c16]' },
      { label: '含高危权限', value: highRisk, dotClass: 'bg-[#ff4d4f]' },
    ]
  }, [roles])

  // ---- 表格视图行选择（供批量权限） ----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const allSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))
  const someSelected = !allSelected && filtered.some((r) => selectedIds.has(r.id))
  const selectedRoles = filtered.filter((r) => selectedIds.has(r.id))

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAllRows = (checked: boolean | 'indeterminate') => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked === true) filtered.forEach((r) => next.add(r.id))
      else filtered.forEach((r) => next.delete(r.id))
      return next
    })
  }

  // ---- 权限矩阵派生（角色 × 模块三态） ----
  const modules = useMemo(() => {
    const seen: string[] = []
    for (const p of perms) {
      const mod = p.resource.split(':')[0]
      if (!seen.includes(mod)) seen.push(mod)
    }
    const knownOrder = Object.keys(PERMISSION_MODULE_LABELS)
    return seen.sort((a, b) => {
      const ia = knownOrder.indexOf(a)
      const ib = knownOrder.indexOf(b)
      return (ia === -1 ? knownOrder.length : ia) - (ib === -1 ? knownOrder.length : ib)
    })
  }, [perms])

  const permKey = (p: { resource: string; action: string }) => `${p.resource}#${p.action}`
  const cellState = (role: RoleItem, mod: string): CellState => {
    const modulePerms = perms.filter((p) => p.resource.split(':')[0] === mod)
    if (modulePerms.length === 0) return 'off'
    const owned = new Set((role.permissions ?? []).map(permKey))
    const checked = modulePerms.filter((p) => owned.has(permKey(p))).length
    if (checked === 0) return 'off'
    return checked === modulePerms.length ? 'on' : 'half'
  }

  // ---- 对话框状态 ----
  const [roleDialog, setRoleDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; role: RoleItem | null }>({ open: false, mode: 'create', role: null })
  const [cloneTarget, setCloneTarget] = useState<RoleItem | null>(null)
  const [permTarget, setPermTarget] = useState<RoleItem | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)

  /** 删除角色：二次确认后调用接口（系统预置角色不提供删除） */
  const handleDelete = async (role: RoleItem) => {
    const ok = await confirm({
      title: '删除角色',
      description: `确认删除角色「${role.name}」？删除后不可恢复，其下 ${role.userCount ?? 0} 名用户将失去该角色的权限。`,
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    setActionError(null)
    deleteRole.mutate(role.id, {
      onSuccess: () => setActionNotice(`已删除角色「${role.name}」`),
      onError: (e) => setActionError(e instanceof Error ? e.message : '删除失败'),
    })
  }

  const renderActions = (role: RoleItem, index: number) => (
    <RoleActions
      role={role}
      canUpdate={canUpdate}
      canCreate={canCreate}
      canDelete={canDelete}
      canUpdatePerms={canUpdatePerms}
      onEdit={() => setRoleDialog({ open: true, mode: 'edit', role })}
      onClone={() => setCloneTarget(role)}
      onPerms={() => setPermTarget(role)}
      onDelete={() => void handleDelete(role)}
      key={`actions-${role.id}-${index}`}
    />
  )

  return (
    <PageContainer
      title="角色管理"
      description="配置角色 × 模块权限矩阵，按角色分配细粒度权限"
      actions={
        canCreate ? (
          <Button size="sm" onClick={() => setRoleDialog({ open: true, mode: 'create', role: null })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            新建角色
          </Button>
        ) : undefined
      }
    >
      {/* KPI：角色清单派生 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((c) => (
          <KpiCard key={c.label} label={c.label} value={c.value} dotClass={c.dotClass} />
        ))}
      </div>

      {/* 搜索 + 视图切换 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索角色名称、编码或描述..."
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        {canSwitchView && (
          <Tabs value={viewMode} onValueChange={handleViewChange}>
            <TabsList variant="segmented" className="ml-auto">
              <TabsTrigger value="card" className="text-[13px]">卡片</TabsTrigger>
              <TabsTrigger value="table" className="text-[13px]">表格</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {actionNotice && <FlashMessage type="success" onAutoHide={() => setActionNotice(null)}>{actionNotice}</FlashMessage>}
      {actionError && <FlashMessage type="error">{actionError}</FlashMessage>}
      {rolesError && (
        <FlashMessage type="error">
          角色列表加载失败，请稍后重试
          <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={() => refetch?.()}>重试</Button>
        </FlashMessage>
      )}

      {viewMode === 'table' ? (
        /* ---- 表格视图：行选择 + 批量权限 ---- */
        <Card className="rounded-card p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
            <h3 className="text-base font-semibold tracking-tight">角色列表</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">已选择 {selectedRoles.length} 项</span>
              {canUpdatePerms && (
                <Button
                  size="sm"
                  disabled={selectedRoles.length === 0}
                  onClick={() => setBatchOpen(true)}
                >
                  批量权限
                </Button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className="w-9 border-b border-border-light bg-[#f5f5f5] px-3 py-2.5">
                    <Checkbox
                      size="sm"
                      aria-label="全选当前角色"
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={toggleAllRows}
                    />
                  </th>
                  <th scope="col" className="border-b border-border-light bg-[#f5f5f5] px-3 py-2.5 text-left text-xs font-semibold text-foreground">角色名称</th>
                  <th scope="col" className="border-b border-border-light bg-[#f5f5f5] px-3 py-2.5 text-left text-xs font-semibold text-foreground">角色编码</th>
                  <th scope="col" className="border-b border-border-light bg-[#f5f5f5] px-3 py-2.5 text-left text-xs font-semibold text-foreground">类型</th>
                  <th scope="col" className="border-b border-border-light bg-[#f5f5f5] px-3 py-2.5 text-right text-xs font-semibold text-foreground">权限数</th>
                  <th scope="col" className="border-b border-border-light bg-[#f5f5f5] px-3 py-2.5 text-right text-xs font-semibold text-foreground">成员数</th>
                  <th scope="col" className="border-b border-border-light bg-[#f5f5f5] px-3 py-2.5 text-center text-xs font-semibold text-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {rolesLoading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">正在加载角色...</td>
                  </tr>
                )}
                {!rolesLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState compact title="暂无角色" description={roles.length > 0 ? '当前搜索条件下无匹配角色' : undefined} />
                    </td>
                  </tr>
                )}
                {filtered.map((role, index) => (
                  <tr key={role.id} className={cn(index % 2 === 1 && 'bg-[#fafafa]')}>
                    <td className="border-b border-border-light px-3 py-3 align-middle">
                      <Checkbox size="sm" aria-label="选择该行" checked={selectedIds.has(role.id)} onCheckedChange={() => toggleRow(role.id)} />
                    </td>
                    <td className="border-b border-border-light px-3 py-3 align-middle">
                      <div className="flex items-center gap-2">
                        <RoleAvatar role={role} index={index} size="sm" />
                        <span className="font-medium text-foreground">{role.name}</span>
                        {role.isSystem && <Lock className="h-3 w-3 text-muted-foreground" aria-label="系统预置" />}
                      </div>
                    </td>
                    <td className="border-b border-border-light px-3 py-3 font-mono text-xs text-muted-foreground">{role.code}</td>
                    <td className="border-b border-border-light px-3 py-3 align-middle">
                      {role.isSystem ? <Pill tone="blue">系统预置</Pill> : <Pill tone="gray">自定义</Pill>}
                    </td>
                    <td className="border-b border-border-light px-3 py-3 text-right font-num tabular-nums">{(role.permissions ?? []).length}</td>
                    <td className="border-b border-border-light px-3 py-3 text-right font-num tabular-nums">{role.userCount ?? 0}</td>
                    <td className="border-b border-border-light px-3 py-3 text-center align-middle">
                      <div className="flex justify-center">{renderActions(role, index)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <>
          {/* ---- 角色 × 模块权限矩阵（点击单元格配置该角色权限） ---- */}
          <Card className="rounded-card p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light px-5 py-3.5">
              <div>
                <h3 className="text-base font-semibold tracking-tight">角色 × 模块权限矩阵</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  行=角色（{roles.length}） · 列=模块（{modules.length}）
                  {canUpdatePerms ? ' · 点击单元格配置权限' : ''}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-pill bg-[#e6f4ff] px-2 py-0.5 text-xs text-[#1677ff]">
                <ShieldCheck className="h-3 w-3" />
                共 {perms.length} 项权限
              </span>
            </div>

            {modules.length > 0 && roles.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-[1] min-w-[160px] max-w-[200px] border-b border-r border-border-light bg-[#f5f5f5] px-3.5 py-3 text-left text-xs font-semibold text-foreground">
                        角色
                      </th>
                      {modules.map((mod) => (
                        <th
                          key={mod}
                          className="border-b border-r border-border-light bg-[#f5f5f5] px-2 py-3 text-center text-xs font-semibold text-foreground last:border-r-0"
                        >
                          {PERMISSION_MODULE_LABELS[mod] ?? mod}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((role, index) => {
                      const isEven = index % 2 === 1
                      return (
                        <tr key={role.id} className={cn(isEven ? 'bg-[#fafafa]' : 'bg-white')}>
                          <th
                            className={cn(
                              'sticky left-0 z-[1] min-w-[160px] max-w-[200px] border-b border-r border-border-light px-3.5 py-3 text-left',
                              isEven ? 'bg-[#fafafa]' : 'bg-[#f5f5f5]',
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <RoleAvatar role={role} index={index} size="sm" />
                              <span className="text-sm font-medium text-foreground">{role.name}</span>
                            </div>
                            <div className="mt-0.5 pl-8 font-mono text-[11px] text-muted-foreground">{role.code}</div>
                          </th>
                          {modules.map((mod) => {
                            const state = cellState(role, mod)
                            const clickable = canUpdatePerms
                            return (
                              <td
                                key={mod}
                                className={cn('border-b border-r border-border-light px-2 py-3 text-center last:border-r-0', clickable && 'cursor-pointer')}
                                onClick={clickable ? () => setPermTarget(role) : undefined}
                                title={clickable ? `配置「${role.name}」权限` : undefined}
                              >
                                <span className="inline-flex items-center justify-center">
                                  <Checkbox
                                    checked={state === 'on' ? true : state === 'half' ? 'indeterminate' : false}
                                    size="sm"
                                    className="pointer-events-none"
                                  />
                                </span>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                compact
                className="py-10"
                title={perms.length === 0 ? '暂无权限清单' : '暂无角色'}
                description={perms.length === 0 ? '权限清单加载后此处展示角色 × 模块矩阵' : '新建角色后此处展示权限矩阵'}
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-light px-5 py-3 text-xs text-muted-foreground">
              <span>共 {roles.length} 个角色 · {modules.length} 个模块 · 矩阵合计 {roles.length * modules.length} 单元格</span>
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3" />
                超级管理员角色权限固定，不可修改
              </span>
            </div>
          </Card>

          {/* ---- 角色卡片视图 ---- */}
          {filtered.length === 0 ? (
            <EmptyState
              title={rolesLoading ? '正在加载角色...' : '暂无角色'}
              description={roles.length > 0 ? '当前搜索条件下无匹配角色，请调整关键字' : undefined}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {filtered.map((role, index) => {
                const highRiskCount = (role.permissions ?? []).filter((p) => isHighRiskPermission(p.resource)).length
                const palette = ROLE_COLORS[index % ROLE_COLORS.length]
                return (
                  <div key={role.id} className="rounded-card border border-border-light bg-card p-4 shadow-antd-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-semibold"
                        style={{ background: palette.bg, color: palette.color }}
                      >
                        {role.name.slice(0, 2)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{role.name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{role.code}</p>
                      </div>
                      {highRiskCount > 0 ? (
                        <Pill tone="red">含 {highRiskCount} 高危</Pill>
                      ) : (
                        <Pill tone="green">常规</Pill>
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 min-h-[2.5em] text-[12px] text-muted-foreground">
                      {role.description ?? '暂无描述'}
                    </p>
                    <div className="mt-3 flex items-center justify-between border-t border-border-light pt-2 text-[11px] text-muted-foreground">
                      <span>权限数 {(role.permissions ?? []).length}</span>
                      <span>成员 {role.userCount ?? 0}</span>
                      {role.isSystem ? (
                        <span className="inline-flex items-center gap-0.5">
                          <Lock className="h-3 w-3" />
                          预置
                        </span>
                      ) : (
                        <span>自定义</span>
                      )}
                    </div>
                    {(canUpdate || canCreate || canUpdatePerms || canDelete) && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {canUpdatePerms && (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setPermTarget(role)}>
                            <ShieldCheck className="mr-1 h-3 w-3" />
                            权限
                          </Button>
                        )}
                        {canUpdate && (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setRoleDialog({ open: true, mode: 'edit', role })}>
                            <Edit className="mr-1 h-3 w-3" />
                            编辑
                          </Button>
                        )}
                        {canCreate && (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setCloneTarget(role)}>
                            <Copy className="mr-1 h-3 w-3" />
                            克隆
                          </Button>
                        )}
                        {canDelete && !role.isSystem && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/5"
                            onClick={() => void handleDelete(role)}
                          >
                            <Trash2 className="mr-1 h-3 w-3" />
                            删除
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* 新增/编辑角色 */}
      <RoleDialog
        open={roleDialog.open}
        mode={roleDialog.mode}
        role={roleDialog.role}
        onClose={() => setRoleDialog((s) => ({ ...s, open: false }))}
        onSaved={(name) => {
          setActionError(null)
          setActionNotice(roleDialog.mode === 'create' ? `已创建角色「${name}」` : `已保存角色「${name}」的修改`)
        }}
      />

      {/* 克隆角色 */}
      <CloneRoleDialog
        open={cloneTarget !== null}
        role={cloneTarget}
        onClose={() => setCloneTarget(null)}
        onSaved={(name) => {
          setActionError(null)
          setActionNotice(`已克隆生成新角色「${name}」，权限随原角色复制`)
        }}
      />

      {/* 单角色权限配置 */}
      <PermissionDialog
        open={permTarget !== null}
        role={permTarget}
        onClose={() => setPermTarget(null)}
        onSaved={(name) => {
          setActionError(null)
          setActionNotice(`已保存角色「${name}」的权限配置`)
        }}
      />

      {/* 多角色批量权限 */}
      <BatchPermissionDialog
        open={batchOpen}
        roles={selectedRoles}
        onClose={() => setBatchOpen(false)}
        onSaved={(names) => {
          setActionError(null)
          setBatchOpen(false)
          setSelectedIds(new Set())
          setActionNotice(`已为 ${names.length} 个角色批量应用权限`)
        }}
      />

      {confirmElement}
    </PageContainer>
  )
}
