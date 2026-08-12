import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { Pagination } from '@/components/data-table/pagination'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { usePermission } from '@/hooks/usePermission'
import { useCollections, useGenerateCollections, useUpdateCollection, useCollectionLogs, useAddCollectionLog } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { CompanySelect } from '@/components/filters/company-select'
import { Loader2, PhoneCall, History } from 'lucide-react'
import type { CollectionPlanItem, CollectionStatus } from '@/types'

/**
 * 催收管理 Tab：催收计划列表（筛选/分页）、账龄逾期批量生成建议、
 * 状态机流转（pending→collecting→partial|full|bad_debt）、催收记录。
 */

const STATUS_LABELS: Record<CollectionStatus, string> = {
  pending: '待催收',
  collecting: '催收中',
  partial: '部分回收',
  full: '全额回收',
  bad_debt: '坏账',
}

const STATUS_STYLES: Record<CollectionStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  collecting: 'bg-info/10 text-info',
  partial: 'bg-warning/15 text-warning-strong',
  full: 'bg-success/10 text-success-strong',
  bad_debt: 'bg-destructive/10 text-destructive',
}

/** 合法状态流转表（与后端 CollectionService 状态机一致） */
const STATUS_TRANSITIONS: Record<CollectionStatus, CollectionStatus[]> = {
  pending: ['collecting'],
  collecting: ['partial', 'full', 'bad_debt'],
  partial: ['full', 'bad_debt'],
  full: [],
  bad_debt: [],
}

const METHOD_LABELS: Record<string, string> = { phone: '电话', letter: '函证', legal: '法务' }

const BUCKET_OPTIONS = [
  { value: '1m', label: '1个月以上' },
  { value: '3m', label: '3个月以上' },
  { value: '6m', label: '半年以上' },
  { value: '1y', label: '1年以上' },
  { value: '2y', label: '2年以上' },
]

function fmtAmount(v: number | null): string {
  if (v === null || v === undefined) return '-'
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2 })
}

// ===== 状态更新对话框 =====
function UpdateStatusDialog({ plan, onClose }: { plan: CollectionPlanItem | null; onClose: () => void }) {
  const [status, setStatus] = useState('')
  const [actualAmount, setActualAmount] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const updateMutation = useUpdateCollection()

  const allowed = plan ? STATUS_TRANSITIONS[plan.status] : []

  const handleSubmit = async () => {
    if (!plan) return
    setErrorMsg('')
    const data: Record<string, unknown> = {}
    if (status) data.status = status
    if (actualAmount !== '') {
      const v = Number(actualAmount)
      if (!Number.isFinite(v) || v < 0) {
        setErrorMsg('实际回收金额不合法')
        return
      }
      data.actualAmount = v
    }
    if (Object.keys(data).length === 0) {
      setErrorMsg('请选择新状态或填写实际回收金额')
      return
    }
    try {
      await updateMutation.mutateAsync({ id: plan.id, data })
      handleClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '更新失败')
    }
  }

  const handleClose = () => {
    setStatus('')
    setActualAmount('')
    setErrorMsg('')
    onClose()
  }

  return (
    <Dialog open={!!plan} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>更新催收状态</DialogTitle>
          <DialogDescription>
            {plan?.counterpartyName || plan?.counterpartyCode} · 逾期 {fmtAmount(plan?.overdueAmount ?? null)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">新状态（当前：{plan ? STATUS_LABELS[plan.status] : '-'}）</label>
            {allowed.length === 0 ? (
              <p className="text-sm text-muted-foreground">当前为终态，不可再流转（仍可补录实际回收金额）</p>
            ) : (
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="保持不变" />
                </SelectTrigger>
                <SelectContent>
                  {allowed.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">实际回收金额</label>
            <Input type="number" placeholder="选填" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)} />
          </div>
          {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>取消</Button>
          <Button disabled={updateMutation.isPending} onClick={handleSubmit}>
            {updateMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===== 催收记录对话框 =====
function LogsDialog({ plan, canUpdate, onClose }: { plan: CollectionPlanItem | null; canUpdate: boolean; onClose: () => void }) {
  const [content, setContent] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const { data: logs, isLoading } = useCollectionLogs(plan?.id ?? null)
  const addMutation = useAddCollectionLog()

  const handleAdd = async () => {
    if (!plan) return
    setErrorMsg('')
    if (!content.trim()) {
      setErrorMsg('请输入催收内容')
      return
    }
    try {
      await addMutation.mutateAsync({ id: plan.id, content: content.trim() })
      setContent('')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '提交失败')
    }
  }

  return (
    <Dialog open={!!plan} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>催收记录</DialogTitle>
          <DialogDescription>{plan?.counterpartyName || plan?.counterpartyCode} · {plan?.accountCode}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">加载中...</p>
          ) : !logs?.length ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无催收记录</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {logs.map((log) => (
                <li key={log.id} className="rounded-lg border p-2.5 text-sm">
                  <p>{log.content}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(log.actionTime).toLocaleString('zh-CN')}</p>
                </li>
              ))}
            </ul>
          )}
          {canUpdate && (
            <div className="space-y-2">
              <Textarea placeholder="记录本次催收情况..." value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
              {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
              <div className="flex justify-end">
                <Button size="sm" disabled={addMutation.isPending} onClick={handleAdd}>
                  {addMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  添加记录
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ===== 生成催收建议对话框 =====
function GenerateDialog({ open, companyCode, onClose }: { open: boolean; companyCode?: string; onClose: () => void }) {
  const [bucket, setBucket] = useState('6m')
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const generateMutation = useGenerateCollections()

  const handleGenerate = async () => {
    setErrorMsg('')
    try {
      const data = await generateMutation.mutateAsync({ companyCode, minAgingBucket: bucket })
      setResult(data)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '生成失败')
    }
  }

  const handleClose = () => {
    setResult(null)
    setErrorMsg('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>生成催收建议</DialogTitle>
          <DialogDescription>
            从应收账龄数据生成催收计划（AR 方向、外部客商、期末余额为正），按 公司×客商×科目 聚合逾期金额；已有进行中计划的自动跳过
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">逾期起算账龄</label>
            <Select value={bucket} onValueChange={setBucket}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUCKET_OPTIONS.map((b) => (
                  <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {result && (
            <p className="rounded bg-success/10 p-2 text-sm text-success-strong">
              已生成 {result.created} 条催收计划，跳过 {result.skipped} 条（已有进行中计划）
            </p>
          )}
          {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>{result ? '完成' : '取消'}</Button>
          {!result && (
            <Button disabled={generateMutation.isPending} onClick={handleGenerate}>
              {generateMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              生成
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===== 催收管理 Tab =====
export function CollectionsTab() {
  // 筛选与分页持久化到 pageStateStore（切 tab/切路由/刷新后恢复）；对话框开关为瞬时状态
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const page = usePageStore((s) => s.transactions.collections.page)
  const pageSize = usePageStore((s) => s.transactions.collections.pageSize)
  const companyFilter = usePageStore((s) => s.transactions.collections.company)
  const statusFilter = usePageStore((s) => s.transactions.collections.status)
  const keyword = usePageStore((s) => s.transactions.collections.keyword)
  const setPage = useCallback((v: number) => setTransactionsTab('collections', { page: v }), [setTransactionsTab])
  const setPageSize = useCallback((v: number) => setTransactionsTab('collections', { pageSize: v }), [setTransactionsTab])
  const setCompanyFilter = useCallback((v: string) => setTransactionsTab('collections', { company: v }), [setTransactionsTab])
  const setStatusFilter = useCallback((v: string) => setTransactionsTab('collections', { status: v }), [setTransactionsTab])
  const setKeyword = useCallback((v: string) => setTransactionsTab('collections', { keyword: v }), [setTransactionsTab])
  const [generateOpen, setGenerateOpen] = useState(false)
  const [updatingPlan, setUpdatingPlan] = useState<CollectionPlanItem | null>(null)
  const [logsPlan, setLogsPlan] = useState<CollectionPlanItem | null>(null)
  const { can } = usePermission()
  const { getDisplayName } = useCompanyDisplayName()

  const companyCode = companyFilter === 'all' ? undefined : companyFilter
  const canCreate = can('transactions', 'create')
  const canUpdate = can('transactions', 'update')

  const { data, isLoading } = useCollections({
    page,
    pageSize,
    companyCode,
    status: statusFilter || undefined,
    counterpartyKeyword: keyword || undefined,
  })

  const items = data?.items || []
  const total = data?.total || 0

  // 催收计划列表列（操作列带权限门禁）
  const planColumns: DataTableColumn<CollectionPlanItem>[] = useMemo(() => [
    {
      key: 'companyCode', header: '公司',
      render: (row) => <span title={row.companyName || row.companyCode}>{getDisplayName(row.companyCode, row.companyName)}</span>,
    },
    {
      key: 'counterpartyName', header: '客商',
      render: (row) => (
        <>
          <div>{row.counterpartyName || '-'}</div>
          <div className="text-xs text-muted-foreground">{row.counterpartyCode}</div>
        </>
      ),
    },
    { key: 'accountCode', header: '科目', render: (row) => <span className="text-xs">{row.accountCode}</span> },
    { key: 'overdueAmount', header: '逾期金额', align: 'right', cellClassName: 'font-num', render: (row) => fmtAmount(row.overdueAmount) },
    { key: 'plannedDate', header: '计划日期', render: (row) => <span className="text-xs">{row.plannedDate}</span> },
    { key: 'method', header: '方式', render: (row) => <span className="text-xs">{METHOD_LABELS[row.method] || row.method}</span> },
    { key: 'actualAmount', header: '实际回收', align: 'right', cellClassName: 'font-num', render: (row) => fmtAmount(row.actualAmount) },
    {
      key: 'status', header: '状态',
      render: (row) => (
        <span className={cn('rounded px-1.5 py-0.5 text-xs', STATUS_STYLES[row.status])}>
          {STATUS_LABELS[row.status]}
        </span>
      ),
    },
    {
      key: 'actions', header: '操作',
      render: (row) => (
        <div className="flex gap-1">
          {canUpdate && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setUpdatingPlan(row)}>
              更新
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLogsPlan(row)}>
            <History className="mr-0.5 h-3 w-3" />
            记录
          </Button>
        </div>
      ),
    },
  ], [getDisplayName, canUpdate, setUpdatingPlan, setLogsPlan])

  return (
    <div className="space-y-4">
      {/* 筛选卡：公司 / 状态 / 客商关键词 / 生成操作 */}
      <Card className="rounded-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <CompanySelect value={companyFilter} onChange={(v) => { setCompanyFilter(v); setPage(1) }} />
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="催收状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {(Object.keys(STATUS_LABELS) as CollectionStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="搜索客商..."
          className="w-[200px]"
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
        />
        {canCreate && (
          <Button className="ml-auto" size="sm" onClick={() => setGenerateOpen(true)}>
            <PhoneCall className="mr-1 h-4 w-4" />
            生成催收建议
          </Button>
        )}
      </div>
      </Card>

      {/* 计划列表（表格卡） */}
      <Card className="rounded-card overflow-hidden">
        <div className="pt-4">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无催收计划，可从账龄数据生成催收建议</div>
          ) : (
            <div className="px-2 pb-2">
              <DataTable
                columns={planColumns}
                data={items}
                rowKey={(row) => row.id}
                density="compact"
                caption="催收计划列表"
              />
            </div>
          )}
        </div>
      </Card>

      {/* 分页 */}
      {total > 0 && (
        <div className="rounded-card border bg-card px-4 py-2.5">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            summary={`共 ${total} 条`}
          />
        </div>
      )}

      <GenerateDialog open={generateOpen} companyCode={companyCode} onClose={() => setGenerateOpen(false)} />
      <UpdateStatusDialog plan={updatingPlan} onClose={() => setUpdatingPlan(null)} />
      <LogsDialog plan={logsPlan} canUpdate={canUpdate} onClose={() => setLogsPlan(null)} />
    </div>
  )
}
