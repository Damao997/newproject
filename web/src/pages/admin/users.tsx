import { useMemo, useState } from 'react'
import { Download, Loader2, MoreHorizontal, Plus, RefreshCw, Search } from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Pill } from '@/components/ui/pill'
import { FlashMessage } from '@/components/ui/flash-message'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/data-table/pagination'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import {
  useUsers,
  useRoles,
  useDisableUser,
  usePurgeUser,
  useUpdateUser,
  type RoleItem,
} from '@/hooks/api-queries'
import { usePermission } from '@/hooks/usePermission'
import { api } from '@/lib/api'
import { downloadBlob } from '@/lib/export'
import { UserDialog, ResetPasswordDialog } from './dialogs'
import type { User } from '@/types'

/** 用户管理：账号列表、角色分配、启停/删除/密码/导出（数据全部来自真实接口） */

const PAGE_SIZE = 10

/** 头像渐变色板（按 id 哈希取色，避免依赖 mock 字段） */
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #1677ff, #4096ff)',
  'linear-gradient(135deg, #52c41a, #95de64)',
  'linear-gradient(135deg, #722ed1, #b37feb)',
  'linear-gradient(135deg, #fa8c16, #ffc069)',
  'linear-gradient(135deg, #13c2c2, #5cdbd3)',
  'linear-gradient(135deg, #eb2f96, #ff85c0)',
  'linear-gradient(135deg, #2f54eb, #85a5ff)',
]

/** 角色编码 → 标签色调（与设计稿语义一致：超管红 / 管理员橙 / 财务蓝 / 其余灰） */
const ROLE_TONES: Record<string, 'red' | 'orange' | 'blue' | 'gray'> = {
  superadmin: 'red',
  admin: 'orange',
  finance_manager: 'blue',
  department_manager: 'gray',
  viewer: 'gray',
  finance_analyst_it: 'gray',
}

function formatTime(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN')
}

function UserAvatar({ user }: { user: User }) {
  const idx = [...user.id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % AVATAR_GRADIENTS.length
  const letter = (user.name || user.username).slice(0, 1)
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white"
      style={{ background: AVATAR_GRADIENTS[idx] }}
    >
      {letter}
    </div>
  )
}

function KpiCard({ label, value, sub, dotClass, subClass }: { label: string; value: number; sub: string; dotClass: string; subClass?: string }) {
  return (
    <div className="rounded-card border border-border bg-card px-5 py-4">
      <div className="text-[13px] text-muted-foreground">
        <span className={cn('mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle', dotClass)} />
        {label}
      </div>
      <div className="mt-1 text-[24px] font-semibold tabular-nums">{value}</div>
      <div className={cn('mt-1 text-xs', subClass ?? 'text-muted-foreground')}>{sub}</div>
    </div>
  )
}

export default function UsersPage() {
  const { can } = usePermission()
  const canCreate = can('admin:users', 'create')
  const canUpdate = can('admin:users', 'update')
  const canDelete = can('admin:users', 'delete')
  const canResetPwd = can('admin:users', 'reset-password')
  const canExport = can('admin:users', 'export')
  // 彻底删除：admin:users:purge 为高危码，静态矩阵下仅 superadmin 持有
  const canPurge = can('admin:users', 'purge')

  const { data: rolesData } = useRoles()
  const roles = (rolesData ?? []) as RoleItem[]
  const roleNameOf = useMemo(() => new Map(roles.map((r) => [r.code, r.name])), [roles])

  const usersQuery = useUsers({ page: 1, pageSize: 500 })
  const users = (usersQuery.data?.items ?? []) as User[]
  const totalFromServer = usersQuery.data?.total ?? 0

  // ---- 筛选 / 分页（拉取全量后客户端过滤，保证筛选与计数一致） ----
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchValue, setSearchValue] = useState('')
  const [page, setPage] = useState(1)

  const roleChips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const u of users) counts.set(u.role, (counts.get(u.role) ?? 0) + 1)
    const known = roles.map((r) => ({ code: r.code, name: r.name, count: counts.get(r.code) ?? 0 }))
    const knownCodes = new Set(known.map((r) => r.code))
    const extra = [...counts.keys()].filter((c) => !knownCodes.has(c)).map((c) => ({ code: c, name: c, count: counts.get(c) ?? 0 }))
    return [...known, ...extra]
  }, [users, roles])

  const filtered = useMemo(() => {
    const kw = searchValue.trim().toLowerCase()
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (statusFilter !== 'all' && u.status !== statusFilter) return false
      if (kw && !`${u.name} ${u.username} ${u.dataScope}`.toLowerCase().includes(kw)) return false
      return true
    })
  }, [users, roleFilter, statusFilter, searchValue])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const changeFilter = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1) }
  const handleRoleChip = changeFilter<string>(setRoleFilter)
  const handleStatusFilter = changeFilter<string>(setStatusFilter)
  const handleSearch = changeFilter<string>(setSearchValue)
  const resetFilters = () => { setRoleFilter('all'); setStatusFilter('all'); setSearchValue(''); setPage(1) }

  // ---- KPI（由当前查询结果派生，无 mock） ----
  const kpis = useMemo(() => {
    const active = users.filter((u) => u.status === 'active').length
    const inactive = users.length - active
    const mustChange = users.filter((u) => u.mustChangePassword).length
    return [
      { label: '用户总数', value: totalFromServer, sub: '系统账号合计', dotClass: 'bg-[#1677ff]' },
      { label: '活跃用户', value: active, sub: '当前拉取范围', dotClass: 'bg-[#52c41a]', subClass: 'text-[#52c41a]' },
      { label: '已停用', value: inactive, sub: '当前拉取范围', dotClass: 'bg-[#ff4d4f]' },
      { label: '待改密', value: mustChange, sub: '首次登录/重置后须修改', dotClass: 'bg-[#fa8c16]' },
    ]
  }, [users, totalFromServer])

  // ---- 操作与对话框状态 ----
  const [userDialog, setUserDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; user: User | null }>({ open: false, mode: 'create', user: null })
  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const { confirm, element: confirmElement } = useConfirm()

  const disableUser = useDisableUser()
  const purgeUser = usePurgeUser()
  const updateUser = useUpdateUser()

  const toErrorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

  /** 停用：二次确认 → DELETE（软删除，会话失效） */
  const handleDisable = async (user: User) => {
    const ok = await confirm({
      title: '停用用户',
      description: `确认停用用户「${user.name}」？停用后其登录会话将失效。`,
      danger: true,
      confirmText: '停用',
    })
    if (!ok) return
    setActionError(null)
    disableUser.mutate(user.id, {
      onSuccess: () => setActionNotice(`已停用「${user.name}」`),
      onError: (e) => setActionError(toErrorMessage(e, '停用失败')),
    })
  }

  /** 启用：走用户更新接口（PUT users/:id { status: 'active' }） */
  const handleEnable = (user: User) => {
    setActionError(null)
    updateUser.mutate(
      { id: user.id, data: { status: 'active' } },
      {
        onSuccess: () => setActionNotice(`已启用「${user.name}」`),
        onError: (e) => setActionError(toErrorMessage(e, '启用失败')),
      },
    )
  }

  /** 彻底删除：仅 superadmin、需先停用；输入用户名防呆确认后物理删除 */
  const handlePurge = async (user: User) => {
    const ok = await confirm({
      title: '彻底删除用户',
      description: `将物理删除用户「${user.name}」（${user.username}），该操作不可恢复。`,
      danger: true,
      confirmText: '彻底删除',
      requireInput: user.username,
    })
    if (!ok) return
    setActionError(null)
    purgeUser.mutate(user.id, {
      onSuccess: () => setActionNotice(`已彻底删除「${user.name}」`),
      onError: (e) => setActionError(toErrorMessage(e, '删除失败')),
    })
  }

  /** 状态开关：停用走确认，启用直接执行（与行内菜单一致） */
  const handleToggleStatus = (user: User) => {
    if (user.status === 'active') {
      if (canDelete) void handleDisable(user)
    } else if (canUpdate) {
      handleEnable(user)
    }
  }

  /** 导出名单：api.exportUsers + downloadBlob（后端返回 xlsx 流） */
  const handleExport = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const blob = await api.exportUsers()
      await downloadBlob(blob, '用户列表.xlsx')
    } catch (e) {
      setExportError(toErrorMessage(e, '导出失败，请稍后重试'))
    } finally {
      setExporting(false)
    }
  }

  const roleOptions = useMemo(() => roles.map((r) => ({ code: r.code, name: r.name })), [roles])

  return (
    <PageContainer
      title="用户管理"
      description="管理平台所有用户账号、角色分配与权限控制"
      actions={
        <>
          {canExport && (
            <Button variant="outline" size="sm" disabled={exporting} onClick={() => void handleExport()}>
              {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              导出名单
            </Button>
          )}
          {canCreate && (
            <Button size="sm" onClick={() => setUserDialog({ open: true, mode: 'create', user: null })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              新增用户
            </Button>
          )}
        </>
      }
    >
      {/* KPI 紧凑条：4 卡片（当前查询结果派生） */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((c) => (
          <KpiCard key={c.label} label={c.label} value={c.value} sub={c.sub} dotClass={c.dotClass} subClass={c.subClass} />
        ))}
      </div>

      {/* 用户列表 */}
      <Card className="rounded-card p-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-base font-semibold tracking-tight">用户列表</h3>
          <span className="text-xs text-muted-foreground">共 {totalFromServer} 条记录</span>
        </div>

        <div className="space-y-3 p-5">
          {/* 角色 chips（角色清单 + 当前计数） */}
          <div className="flex flex-wrap gap-2">
            {[{ code: 'all', name: '全部角色', count: totalFromServer }, ...roleChips].map((c) => (
              <button
                type="button"
                key={c.code}
                onClick={() => handleRoleChip(c.code)}
                className={cn(
                  'h-7 rounded-pill border px-3 text-xs transition-colors',
                  c.code === roleFilter
                    ? 'border-primary bg-[#e6f4ff] text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                {c.name} ({c.count})
              </button>
            ))}
          </div>

          {/* 筛选行 */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[220px] flex-1 sm:max-w-[280px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="姓名 / 账号 / 数据范围"
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <div className="relative inline-flex h-8 min-w-[110px] items-center rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground">
              <select
                value={statusFilter}
                onChange={(e) => handleStatusFilter(e.target.value)}
                className="absolute inset-0 cursor-pointer appearance-none bg-transparent pl-1 pr-6 text-[13px] text-foreground outline-none"
              >
                <option value="all">状态</option>
                <option value="active">启用</option>
                <option value="inactive">已停用</option>
              </select>
              <span className="pointer-events-none ml-auto text-muted-foreground">▾</span>
            </div>
            <div className="ml-auto">
              <Button variant="outline" size="sm" onClick={resetFilters}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                重置
              </Button>
            </div>
          </div>

          {actionNotice && <FlashMessage type="success" onAutoHide={() => setActionNotice(null)}>{actionNotice}</FlashMessage>}
          {actionError && <FlashMessage type="error">{actionError}</FlashMessage>}
          {exportError && <FlashMessage type="error">{exportError}</FlashMessage>}
          {usersQuery.isError && (
            <FlashMessage type="error">
              用户列表加载失败：{usersQuery.error instanceof Error ? usersQuery.error.message : '请稍后重试'}
              <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={() => usersQuery.refetch?.()}>重试</Button>
            </FlashMessage>
          )}

          {/* 用户表 */}
          <div className="overflow-x-auto rounded-card border border-border bg-background">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/70">
                  <th scope="col" className="px-3 py-2.5 text-left text-xs font-medium text-foreground">用户</th>
                  <th scope="col" className="px-3 py-2.5 text-left text-xs font-medium text-foreground">角色</th>
                  <th scope="col" className="px-3 py-2.5 text-left text-xs font-medium text-foreground">数据范围</th>
                  <th scope="col" className="px-3 py-2.5 text-left text-xs font-medium text-foreground">最近登录</th>
                  <th scope="col" className="px-3 py-2.5 text-left text-xs font-medium text-foreground">状态</th>
                  <th scope="col" className="w-[70px] px-3 py-2.5 text-left text-xs font-medium text-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.isLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                      正在加载用户...
                    </td>
                  </tr>
                )}
                {!usersQuery.isLoading && paged.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState compact title="暂无用户" description={total > 0 ? '当前筛选条件下无匹配用户，请调整筛选' : undefined} />
                    </td>
                  </tr>
                )}
                {paged.map((user) => {
                  const isActive = user.status === 'active'
                  return (
                    <tr key={user.id} className="border-b border-border transition-colors hover:bg-[#e6f4ff]/40">
                      <td className="px-3 py-3.5 align-middle">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar user={user} />
                          <div>
                            <div className="text-sm font-medium leading-tight text-foreground">{user.name || user.username}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">{user.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 align-middle">
                        <Pill tone={ROLE_TONES[user.role] ?? 'gray'}>{roleNameOf.get(user.role) ?? user.role}</Pill>
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-3.5 align-middle text-[13px] text-foreground" title={user.dataScope}>
                        {user.dataScope || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 align-middle text-[13px] text-foreground tabular-nums">
                        {formatTime(user.lastLoginAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 align-middle">
                        <div className="flex items-center gap-1.5">
                          <Switch
                            checked={isActive}
                            size="small"
                            disabled={!(isActive ? canDelete : canUpdate)}
                            onCheckedChange={() => handleToggleStatus(user)}
                          />
                          <span className={cn('text-xs', isActive ? 'text-[#52c41a]' : 'text-muted-foreground')}>
                            {isActive ? '启用' : '已停用'}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 align-middle">
                        {(canUpdate || canResetPwd || canDelete || canPurge) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 px-0" aria-label={`操作 ${user.name || user.username}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canUpdate && (
                                <DropdownMenuItem onClick={() => setUserDialog({ open: true, mode: 'edit', user })}>
                                  编辑
                                </DropdownMenuItem>
                              )}
                              {canResetPwd && (
                                <DropdownMenuItem onClick={() => setResetTarget(user)}>
                                  重置密码
                                </DropdownMenuItem>
                              )}
                              {isActive && canDelete && (
                                <DropdownMenuItem className="text-destructive" onClick={() => void handleDisable(user)}>
                                  停用
                                </DropdownMenuItem>
                              )}
                              {!isActive && canUpdate && (
                                <DropdownMenuItem onClick={() => handleEnable(user)}>
                                  启用
                                </DropdownMenuItem>
                              )}
                              {canPurge && (
                                <DropdownMenuItem
                                  className="text-destructive"
                                  disabled={isActive}
                                  title={isActive ? '需先停用该用户' : undefined}
                                  onClick={() => void handlePurge(user)}
                                >
                                  彻底删除
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          <Pagination page={safePage} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
      </Card>

      {/* 新增/编辑用户（角色分配与数据范围在对话框内配置） */}
      <UserDialog
        open={userDialog.open}
        mode={userDialog.mode}
        user={userDialog.user}
        roles={roleOptions}
        onClose={() => setUserDialog((s) => ({ ...s, open: false }))}
        onSaved={(name) => {
          setActionError(null)
          setActionNotice(userDialog.mode === 'create' ? `已创建用户「${name}」` : `已保存「${name}」的修改`)
        }}
      />

      {/* 重置密码 */}
      <ResetPasswordDialog
        open={resetTarget !== null}
        user={resetTarget}
        onClose={() => setResetTarget(null)}
        onSuccess={() => {
          setActionError(null)
          setActionNotice(`已重置「${resetTarget?.name ?? resetTarget?.username ?? ''}」的密码，其下次登录须修改密码`)
        }}
      />

      {confirmElement}
    </PageContainer>
  )
}
