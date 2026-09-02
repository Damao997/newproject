import { useCallback, useEffect, useMemo, useState } from 'react'
import { Select as AntdSelect } from 'antd'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { TRANSACTION_TABS } from '@/components/layout/module-tabs'
import { FilterBar } from '@/components/layout/filter-bar'
import { FILTER_WIDTH } from '@/components/layout/filter-width'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { FlashMessage } from '@/components/ui/flash-message'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Pagination } from '@/components/data-table/pagination'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { useSalesmenManage, useCreateSalesman, useUpdateSalesman, useSetSalesmanStatus, useCompanies } from '@/hooks/api-queries'
import { usePageStore, type TransactionSalesmenState } from '@/stores/pageStateStore'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { useGlobalCompanyScope } from '@/hooks/use-global-company-scope'
import { antdSizeFromClassName } from '@/components/ui/antd-size'
import { Loader2, Plus, RefreshCw, Search, Users, ChevronDown } from 'lucide-react'
import type { SalesmanManageItem } from '@/types'

/**
 * 业务员管理（/transactions/collections/salesmen）：
 * 分页列表（状态/关键词筛选，pageStateStore 持久化；公司口径读全局 periodStore——Header CompanyPill 唯一入口，
 * getSalesmenManage 仅支持 companyCode 单公司参数，全局选中多家时取第一个 + antd message 提示）
 * + 新建/编辑弹窗 + 启用/停用。
 * 数据：GET /transactions/salesmen/manage、POST/PATCH /transactions/salesmen[/:id][/status]；
 * 权限：transactions:salesmen:view / create / update。
 */

interface SalesmanFormValues {
  name: string
  companyCodes: string[]
  phone: string
  remark: string
}

const EMPTY_FORM: SalesmanFormValues = { name: '', companyCodes: [], phone: '', remark: '' }

export default function SalesmenManagePage() {
  // 筛选与分页持久化（切路由/刷新后恢复）；公司全局口径读 periodStore（Header CompanyPill 唯一入口），
  // pageStateStore 的 salesmen.company 停止读取（类型定义保留，旧键留存无害）
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const page = usePageStore((s) => s.transactions.salesmen.page)
  const pageSize = usePageStore((s) => s.transactions.salesmen.pageSize)
  const statusFilter = usePageStore((s) => s.transactions.salesmen.status)
  const keyword = usePageStore((s) => s.transactions.salesmen.keyword)
  const setSalesmen = useCallback(
    (patch: Partial<TransactionSalesmenState>) => setTransactionsTab('salesmen', patch),
    [setTransactionsTab],
  )
  // 全局公司集合 → 单公司接口降级（getSalesmenManage 仅支持 companyCode 单公司参数）：
  // 未选（null/[]）→ undefined（全部公司）；选中多家 → 取第一个 + antd message 提示
  const { companyCode, hasSelection } = useGlobalCompanyScope('业务员管理')

  const { can } = usePermission()
  const canCreate = can('transactions:salesmen', 'create')
  const canUpdate = can('transactions:salesmen', 'update')
  const { displayNameMap } = useCompanyDisplayName()

  const { data, isLoading, isError, error, refetch, isFetching } = useSalesmenManage({
    page,
    pageSize,
    companyCode,
    status: statusFilter || undefined,
    keyword: keyword.trim() || undefined,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0

  // ===== 新建 / 编辑弹窗（瞬时状态，不持久化） =====
  const [editing, setEditing] = useState<SalesmanManageItem | null>(null)
  const [creating, setCreating] = useState(false)

  // ===== 启用 / 停用 =====
  const setStatusMutation = useSetSalesmanStatus()
  const [statusError, setStatusError] = useState('')

  const handleToggleStatus = async (row: SalesmanManageItem) => {
    setStatusError('')
    try {
      await setStatusMutation.mutateAsync({ id: row.id, status: row.status === 'active' ? 'inactive' : 'active' })
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : '状态更新失败')
    }
  }

  const columns: DataTableColumn<SalesmanManageItem>[] = useMemo(() => [
    {
      key: 'name', header: '姓名',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {row.name.slice(0, 1)}
          </span>
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    { key: 'phone', header: '联系方式', render: (row) => row.phone || '-' },
    {
      key: 'companyCodes', header: '公司归属',
      render: (row) => (
        <span className="text-sm" title={row.companyCodes.join('、')}>
          {row.companyCodes.map((c) => displayNameMap.get(c) ?? c).join('、') || '-'}
        </span>
      ),
    },
    { key: 'remark', header: '备注', render: (row) => <span className="text-muted-foreground">{row.remark || '-'}</span> },
    {
      key: 'status', header: '状态',
      render: (row) => (
        <span className={cn(
          'rounded px-1.5 py-0.5 text-xs',
          row.status === 'active' ? 'bg-success/10 text-success-strong' : 'bg-muted text-muted-foreground',
        )}>
          {row.status === 'active' ? '启用' : '停用'}
        </span>
      ),
    },
    {
      key: 'createdAt', header: '创建时间',
      render: (row) => <span className="whitespace-nowrap text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleDateString('zh-CN')}</span>,
    },
    {
      key: 'actions', header: '操作', cellClassName: 'whitespace-nowrap',
      render: (row) => (
        <span className="inline-flex gap-1">
          {canUpdate && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing(row)}>
              编辑
            </Button>
          )}
          {canUpdate && (
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 text-xs', row.status === 'active' ? 'text-warning-strong' : 'text-success-strong')}
              disabled={setStatusMutation.isPending}
              onClick={() => handleToggleStatus(row)}
            >
              {setStatusMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : row.status === 'active' ? '停用' : '启用'}
            </Button>
          )}
        </span>
      ),
    },
  ], [canUpdate, displayNameMap, setStatusMutation.isPending, handleToggleStatus])

  return (
    <PageContainer
      title="业务员管理"
      description="维护催收业务员档案（姓名 / 公司归属 / 联系方式），停用后不再可指派"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', isFetching && 'animate-spin')} />
            刷新
          </Button>
          {canCreate && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              新建业务员
            </Button>
          )}
        </div>
      }
    >
      <SubPageTabs items={TRANSACTION_TABS} />

      {/* 筛选卡（公司口径在 Header CompanyPill 全局筛选） */}
      <Card className="rounded-card border border-border p-4">
        <FilterBar>
          <Select value={statusFilter || 'all'} onValueChange={(v) => setSalesmen({ status: v === 'all' ? '' : v, page: 1 })}>
            <SelectTrigger className="h-9 w-[120px]">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="active">启用</SelectItem>
              <SelectItem value="inactive">停用</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索姓名 / 联系方式..."
              className={cn('h-9 pl-8', FILTER_WIDTH.medium)}
              value={keyword}
              onChange={(e) => setSalesmen({ keyword: e.target.value, page: 1 })}
            />
          </div>
        </FilterBar>
        {statusError && <FlashMessage type="error" className="mt-2">{statusError}</FlashMessage>}
      </Card>

      {/* 列表卡 */}
      <Card className="rounded-card border border-border overflow-hidden">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Users className="h-4 w-4" />
            业务员列表
          </h3>
          <span className="ml-auto text-xs text-muted-foreground">共 {total} 人</span>
        </div>
        {isError ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : '数据加载失败'}</p>
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            暂无业务员数据{keyword.trim() || statusFilter || hasSelection ? '，请调整筛选条件' : ''}
          </p>
        ) : (
          <div className="px-2 pb-2">
            <DataTable
              columns={columns}
              data={items}
              rowKey={(row) => row.id}
              density="compact"
              caption="业务员列表"
              maxHeight="calc(100dvh - 340px)"
            />
          </div>
        )}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
            <span className="text-xs text-muted-foreground">共 {total} 人</span>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={(p) => setSalesmen({ page: p })}
              onPageSizeChange={(s) => setSalesmen({ pageSize: s, page: 1 })}
              summary=""
            />
          </div>
        )}
      </Card>

      {/* 新建弹窗 */}
      <SalesmanFormDialog
        open={creating}
        onClose={() => setCreating(false)}
      />
      {/* 编辑弹窗 */}
      <SalesmanFormDialog
        open={editing !== null}
        initial={editing}
        onClose={() => setEditing(null)}
      />
    </PageContainer>
  )
}

/** 新建 / 编辑业务员弹窗：姓名（必填）+ 公司归属（多选，必选）+ 联系方式 + 备注 */
function SalesmanFormDialog({ open, initial, onClose }: { open: boolean; initial?: SalesmanManageItem | null; onClose: () => void }) {
  const isEdit = !!initial
  const { data: companies } = useCompanies()
  const createMutation = useCreateSalesman()
  const updateMutation = useUpdateSalesman()
  const { displayNameMap } = useCompanyDisplayName()

  const [values, setValues] = useState<SalesmanFormValues>(EMPTY_FORM)
  const [errorMsg, setErrorMsg] = useState('')

  // 打开时以 initial 回填（新建则清空）；key 由父组件控制重挂载，此处 effect 兜底同步
  useEffect(() => {
    if (!open) return
    setErrorMsg('')
    setValues(
      initial
        ? { name: initial.name, companyCodes: [...initial.companyCodes], phone: initial.phone ?? '', remark: initial.remark ?? '' }
        : EMPTY_FORM,
    )
  }, [open, initial])

  const pending = createMutation.isPending || updateMutation.isPending

  const handleSubmit = async () => {
    setErrorMsg('')
    const name = values.name.trim()
    if (!name) { setErrorMsg('请输入姓名'); return }
    if (values.companyCodes.length === 0) { setErrorMsg('请至少选择一家公司归属'); return }
    const payload = {
      name,
      companyCodes: values.companyCodes,
      phone: values.phone.trim() || undefined,
      remark: values.remark.trim() || undefined,
    }
    try {
      if (isEdit && initial) await updateMutation.mutateAsync({ id: initial.id, data: payload })
      else await createMutation.mutateAsync(payload)
      onClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : isEdit ? '保存失败' : '创建失败')
    }
  }

  const entityOptions = (companies ?? []).filter((c) => c.type === 'entity')
  const summaryOptions = (companies ?? []).filter((c) => c.type === 'summary')
  const options = [
    ...entityOptions.map((c) => ({ value: c.code, label: `单体公司-${displayNameMap.get(c.code) ?? c.name}` })),
    ...summaryOptions.map((c) => ({ value: c.code, label: `汇总主体-${displayNameMap.get(c.code) ?? c.name}` })),
  ]

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑业务员' : '新建业务员'}</DialogTitle>
          <DialogDescription>
            {isEdit ? `编辑 ${initial?.name} 的档案信息` : '创建后可在客商台账中指派为负责业务员'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="salesman-form-name">姓名（必填）</Label>
            <Input
              id="salesman-form-name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="业务员姓名"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-form-companies">公司归属（可多选）</Label>
            <AntdSelect
              mode="multiple"
              value={values.companyCodes}
              onChange={(next) => setValues((v) => ({ ...v, companyCodes: next }))}
              options={options}
              placeholder="选择公司（可多选）"
              aria-label="公司归属多选"
              size={antdSizeFromClassName('h-9', 'middle')}
              className="w-full"
              maxTagCount={3}
              maxTagPlaceholder={(omitted) => `等 ${omitted.length + 3} 家`}
              popupMatchSelectWidth={false}
              suffixIcon={<ChevronDown className="h-4 w-4 opacity-50" />}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-form-phone">联系方式（选填）</Label>
            <Input
              id="salesman-form-phone"
              value={values.phone}
              onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
              placeholder="手机号 / 电话"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-form-remark">备注（选填）</Label>
            <Textarea
              id="salesman-form-remark"
              rows={2}
              value={values.remark}
              onChange={(e) => setValues((v) => ({ ...v, remark: e.target.value }))}
              placeholder="如：负责区域 / 客户类型等"
            />
          </div>
          {errorMsg && <FlashMessage type="error">{errorMsg}</FlashMessage>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>取消</Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {isEdit ? '保存' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
