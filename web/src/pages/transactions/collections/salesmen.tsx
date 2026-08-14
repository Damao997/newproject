import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { PageContainer } from '@/components/layout/page-container'
import { Pagination } from '@/components/data-table/pagination'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { usePermission } from '@/hooks/usePermission'
import { useSalesmenManage, useCreateSalesman, useUpdateSalesman, useSetSalesmanStatus } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { CompanySelect } from '@/components/filters/company-select'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { SheetShell } from '@/components/ui/sheet-shell'
import { FlashMessage } from '@/components/ui/flash-message'
import { Loader2, UserPlus } from 'lucide-react'
import type { SalesmanManageItem } from '@/types'

/**
 * 往来分析 · 业务员管理：业务员主数据（列表/新增/编辑/停用）。
 * 软删除：停用保留历史关联（催收计划/客商扩展），选项接口不再返回停用业务员。
 */

const STATUS_LABELS: Record<string, string> = { active: '启用', inactive: '停用' }

/** 表单抽屉：新增（公司可选）与编辑（公司只读）共用 */
function SalesmanFormDrawer({ target, onClose }: { target: SalesmanManageItem | null; onClose: () => void }) {
  const { getDisplayName } = useCompanyDisplayName()
  const [companyCode, setCompanyCode] = useState(target?.companyCode ?? '')
  const [name, setName] = useState(target?.name ?? '')
  const [phone, setPhone] = useState(target?.phone ?? '')
  const [remark, setRemark] = useState(target?.remark ?? '')
  const [errorMsg, setErrorMsg] = useState('')
  const createMutation = useCreateSalesman()
  const updateMutation = useUpdateSalesman()

  const handleSave = async () => {
    setErrorMsg('')
    if (!target && !companyCode) { setErrorMsg('请选择所属公司'); return }
    if (!name.trim()) { setErrorMsg('请输入业务员姓名'); return }
    try {
      if (target) {
        await updateMutation.mutateAsync({ id: target.id, data: { name: name.trim(), phone: phone.trim() || undefined, remark: remark.trim() || undefined } })
      } else {
        await createMutation.mutateAsync({ companyCode, name: name.trim(), phone: phone.trim() || undefined, remark: remark.trim() || undefined })
      }
      onClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <SheetShell
      onClose={onClose}
      className="max-w-md"
      title={target ? '编辑业务员' : '新增业务员'}
      description={target ? `${target.name} · ${getDisplayName(target.companyCode, undefined)}` : '录入业务员主数据（所属公司不可修改）'}
      footer={(
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={createMutation.isPending || updateMutation.isPending}>取消</Button>
          <Button size="sm" disabled={createMutation.isPending || updateMutation.isPending} onClick={handleSave}>
            {(createMutation.isPending || updateMutation.isPending) ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            保存
          </Button>
        </div>
      )}
    >
      <div className="space-y-3 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="salesman-form-company">所属公司</Label>
          {target ? (
            <Input id="salesman-form-company" value={target.companyCode} disabled />
          ) : (
            <CompanySelect value={companyCode} onChange={setCompanyCode} allowAll={false} placeholder="选择公司" id="salesman-form-company" />
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="salesman-form-name">姓名（必填）</Label>
          <Input id="salesman-form-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="业务员姓名" maxLength={50} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="salesman-form-phone">联系方式</Label>
          <Input id="salesman-form-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="手机号/电话" maxLength={30} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="salesman-form-remark">备注</Label>
          <Textarea id="salesman-form-remark" rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" />
        </div>
        {errorMsg && <FlashMessage type="error">{errorMsg}</FlashMessage>}
      </div>
    </SheetShell>
  )
}

export default function SalesmenPage() {
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const page = usePageStore((s) => s.transactions.salesmen.page)
  const pageSize = usePageStore((s) => s.transactions.salesmen.pageSize)
  const companyFilter = usePageStore((s) => s.transactions.salesmen.company)
  const statusFilter = usePageStore((s) => s.transactions.salesmen.status)
  const keyword = usePageStore((s) => s.transactions.salesmen.keyword)
  const setPage = useCallback((v: number) => setTransactionsTab('salesmen', { page: v }), [setTransactionsTab])
  const setPageSize = useCallback((v: number) => setTransactionsTab('salesmen', { pageSize: v }), [setTransactionsTab])
  const setCompanyFilter = useCallback((v: string) => setTransactionsTab('salesmen', { company: v }), [setTransactionsTab])
  const setStatusFilter = useCallback((v: string) => setTransactionsTab('salesmen', { status: v }), [setTransactionsTab])
  const setKeyword = useCallback((v: string) => setTransactionsTab('salesmen', { keyword: v }), [setTransactionsTab])
  const [formTarget, setFormTarget] = useState<SalesmanManageItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const { can } = usePermission()
  const { getDisplayName } = useCompanyDisplayName()
  const { confirm, element: confirmElement } = useConfirm()
  const statusMutation = useSetSalesmanStatus()

  const companyCode = companyFilter === 'all' ? undefined : companyFilter
  const canCreate = can('transactions:salesmen', 'create')
  const canUpdate = can('transactions:salesmen', 'update')

  const { data, isLoading } = useSalesmenManage({
    page,
    pageSize,
    companyCode,
    status: statusFilter || undefined,
    keyword: keyword || undefined,
  })

  const items = data?.items || []
  const total = data?.total || 0

  const handleToggleStatus = useCallback(async (row: SalesmanManageItem) => {
    const next = row.status === 'active' ? 'inactive' : 'active'
    const ok = await confirm({
      title: next === 'inactive' ? '停用业务员' : '启用业务员',
      description: `确定${next === 'inactive' ? '停用' : '启用'}「${row.name}」吗？${next === 'inactive' ? '停用后不再出现在选择列表中，历史关联数据保留。' : ''}`,
      confirmText: next === 'inactive' ? '停用' : '启用',
      danger: next === 'inactive',
    })
    if (!ok) return
    try {
      await statusMutation.mutateAsync({ id: row.id, status: next })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '操作失败')
    }
  }, [confirm, statusMutation])

  const columns: DataTableColumn<SalesmanManageItem>[] = useMemo(() => [
    { key: 'name', header: '姓名' },
    { key: 'phone', header: '联系方式', render: (row) => <span className="text-xs">{row.phone || '-'}</span> },
    {
      key: 'companyCode', header: '所属公司',
      render: (row) => <span title={row.companyCode}>{getDisplayName(row.companyCode, undefined)}</span>,
    },
    { key: 'remark', header: '备注', render: (row) => <span className="text-xs text-muted-foreground">{row.remark || '-'}</span> },
    {
      key: 'status', header: '状态',
      render: (row) => (
        <span className={cn('rounded px-1.5 py-0.5 text-xs', row.status === 'active' ? 'bg-success/10 text-success-strong' : 'bg-muted text-muted-foreground')}>
          {STATUS_LABELS[row.status] ?? row.status}
        </span>
      ),
    },
    {
      key: 'createdAt', header: '创建时间',
      render: (row) => <span className="text-xs">{new Date(row.createdAt).toLocaleDateString('zh-CN')}</span>,
    },
    {
      key: 'actions', header: '操作',
      render: (row) => (
        <div className="flex gap-1">
          {canUpdate && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setFormTarget(row); setFormOpen(true) }}>
              编辑
            </Button>
          )}
          {canUpdate && (
            <Button variant="ghost" size="sm" className={cn('h-7 px-2 text-xs', row.status === 'active' && 'text-destructive')} onClick={() => handleToggleStatus(row)}>
              {row.status === 'active' ? '停用' : '启用'}
            </Button>
          )}
        </div>
      ),
    },
  ], [canUpdate, getDisplayName, handleToggleStatus])

  return (
    <PageContainer title="业务员管理">
      <div className="space-y-4">
        {/* 筛选卡 */}
        <Card className="rounded-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <CompanySelect value={companyFilter} onChange={(v) => { setCompanyFilter(v); setPage(1) }} />
            <Select value={statusFilter || 'all'} onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="active">启用</SelectItem>
                <SelectItem value="inactive">停用</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="搜索姓名/电话..."
              className="w-[200px]"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
            />
            {canCreate && (
              <Button className="ml-auto" size="sm" onClick={() => { setFormTarget(null); setFormOpen(true) }}>
                <UserPlus className="mr-1 h-4 w-4" />
                新增业务员
              </Button>
            )}
          </div>
        </Card>

        {actionError && (
          <FlashMessage type="error" autoHideMs={4000} onAutoHide={() => setActionError('')}>{actionError}</FlashMessage>
        )}

        {/* 列表卡 */}
        <Card className="rounded-card overflow-hidden">
          <div className="pt-4">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无业务员数据</div>
            ) : (
              <div className="px-2 pb-2">
                <DataTable
                  columns={columns}
                  data={items}
                  rowKey={(row) => row.id}
                  density="compact"
                  caption="业务员列表"
                />
              </div>
            )}
          </div>
          {total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
              <span className="text-xs text-muted-foreground">共 {total} 条</span>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                summary=""
              />
            </div>
          )}
        </Card>

        {formOpen && <SalesmanFormDrawer target={formTarget} onClose={() => setFormOpen(false)} />}
        {confirmElement}
      </div>
    </PageContainer>
  )
}
