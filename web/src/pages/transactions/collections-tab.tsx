import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { cn, formatWan } from '@/lib/utils'
import { FilterBar } from '@/components/layout/filter-bar'
import { FILTER_WIDTH } from '@/components/layout/filter-width'
import { Pagination } from '@/components/data-table/pagination'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { usePermission } from '@/hooks/usePermission'
import { useCustomerLedger, useUpdateCustomerExt, useUpdateCollection, useCollectionLogs, useAddCollectionLog, useGenerateCollectionSuggestions } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { usePeriodStore } from '@/stores/periodStore'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { useGlobalCompanyScope } from '@/hooks/use-global-company-scope'
import { Loader2, Sparkles, Users } from 'lucide-react'
import { SheetShell } from '@/components/ui/sheet-shell'
import { Label } from '@/components/ui/label'
import { FlashMessage } from '@/components/ui/flash-message'
import { useSalesmen, useCreateSalesman } from '@/hooks/api-queries'
import type { CollectionStatus, CustomerLedgerItem } from '@/types'

/**
 * 催收计划 Tab：应收账款客商台账（公司×客商粒度，余额>0），
 * 关联最新催收计划（状态机流转与催收记录仅计划行可用）、
 * 客商扩展字段（业务员/已开票未收款，未计划客商亦可维护）。
 */

const STATUS_LABELS: Record<CollectionStatus | 'unplanned', string> = {
  pending: '待催收',
  collecting: '催收中',
  partial: '部分回收',
  full: '全额回收',
  bad_debt: '坏账',
  unplanned: '未计划',
}

const STATUS_STYLES: Record<CollectionStatus | 'unplanned', string> = {
  pending: 'bg-muted text-muted-foreground',
  collecting: 'bg-info/10 text-info',
  partial: 'bg-warning/15 text-warning-strong',
  full: 'bg-success/10 text-success-strong',
  bad_debt: 'bg-destructive/10 text-destructive',
  unplanned: 'bg-muted text-muted-foreground',
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

/** 状态统计条圆点色（对齐 STATUS_STYLES 语义） */
const STATUS_DOT: Record<CollectionStatus | 'unplanned', string> = {
  pending: 'bg-muted-foreground',
  collecting: 'bg-info',
  partial: 'bg-warning',
  full: 'bg-success',
  bad_debt: 'bg-destructive',
  unplanned: 'bg-muted-foreground',
}

/** 编辑抽屉目标：客商台账行（业务员/已开票未收款属客商维度，与计划解耦） */
type LedgerTarget = Pick<CustomerLedgerItem, 'companyCode' | 'counterpartyCode' | 'counterpartyName' | 'billedUncollectedAmount' | 'salesmanId'>

function fmtAmount(v: number | null): string {
  if (v === null || v === undefined) return '-'
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2 })
}

/** 金额分级着色：≥100万 红、≥10万 橙、其余默认 */
function amountTone(v: number | null): string {
  if (v === null || v === undefined) return ''
  if (v >= 1000000) return 'text-destructive font-semibold'
  if (v >= 100000) return 'text-warning-strong font-medium'
  return ''
}

// ===== 状态更新对话框（仅计划行可用） =====
function UpdateStatusDialog({ row, onClose }: { row: CustomerLedgerItem | null; onClose: () => void }) {
  const [status, setStatus] = useState('')
  const [actualAmount, setActualAmount] = useState('')
  const [statusNote, setStatusNote] = useState(row?.statusNote ?? '')
  const [errorMsg, setErrorMsg] = useState('')
  const updateMutation = useUpdateCollection()

  // 打开时预填既有催收状态说明（可修改/覆盖）；关闭时由 handleClose 清空
  useEffect(() => {
    if (row) setStatusNote(row.statusNote ?? '')
  }, [row])

  const currentStatus = (row?.planStatus ?? 'pending') as CollectionStatus
  const allowed = row?.planId ? (STATUS_TRANSITIONS[currentStatus] ?? []) : []

  const handleSubmit = async () => {
    if (!row?.planId) return
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
    if (statusNote.trim()) data.statusNote = statusNote.trim()
    if (Object.keys(data).length === 0) {
      setErrorMsg('请选择新状态、填写实际回收金额或催收状态说明')
      return
    }
    try {
      await updateMutation.mutateAsync({ id: row.planId, data })
      handleClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '更新失败')
    }
  }

  const handleClose = () => {
    setStatus('')
    setActualAmount('')
    setStatusNote('')
    setErrorMsg('')
    onClose()
  }

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>更新催收状态</DialogTitle>
          <DialogDescription>
            {row?.counterpartyName || row?.counterpartyCode} · 应收金额 {fmtAmount(row?.closingBalance ?? null)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="update-status-select">新状态（当前：{row ? STATUS_LABELS[currentStatus] : '-'}）</Label>
            {allowed.length === 0 ? (
              <p className="text-sm text-muted-foreground">当前为终态，不可再流转（仍可补录实际回收金额）</p>
            ) : (
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="update-status-select">
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
            <Label htmlFor="update-actual-amount">实际回收金额</Label>
            <Input id="update-actual-amount" type="number" placeholder="选填" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="update-status-note">催收状态说明（≤500 字）</Label>
            <Textarea id="update-status-note" rows={3} maxLength={500} placeholder="如：客户承诺月底回款，逾期部分已开票待付款…" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
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

// ===== 催收记录对话框（按最新计划） =====
function LogsDialog({ row, canUpdate, onClose }: { row: CustomerLedgerItem | null; canUpdate: boolean; onClose: () => void }) {
  const [content, setContent] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const planId = row?.planId ?? null
  const { data: logs, isLoading } = useCollectionLogs(planId)
  const addMutation = useAddCollectionLog()

  const handleAdd = async () => {
    if (!planId) return
    setErrorMsg('')
    if (!content.trim()) {
      setErrorMsg('请输入催收内容')
      return
    }
    try {
      await addMutation.mutateAsync({ id: planId, content: content.trim() })
      setContent('')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '提交失败')
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>催收记录</DialogTitle>
          <DialogDescription>{row?.counterpartyName || row?.counterpartyCode}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">加载中…</p>
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
              <Label htmlFor="collection-log-content">催收记录内容</Label>
              <Textarea id="collection-log-content" placeholder="记录本次催收情况..." value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
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

// ===== 已开票未收款金额编辑抽屉（客商扩展表） =====
function BilledAmountDrawer({ target, onClose }: { target: LedgerTarget; onClose: () => void }) {
  const [value, setValue] = useState(target.billedUncollectedAmount === null ? '' : String(target.billedUncollectedAmount))
  const [errorMsg, setErrorMsg] = useState('')
  const updateMutation = useUpdateCustomerExt()

  const handleSave = async () => {
    setErrorMsg('')
    const v = value.trim() === '' ? null : Number(value)
    if (v !== null && (!Number.isFinite(v) || v < 0)) { setErrorMsg('金额不合法'); return }
    try {
      await updateMutation.mutateAsync({ companyCode: target.companyCode, counterpartyCode: target.counterpartyCode, data: { billedUncollectedAmount: v } })
      onClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <SheetShell
      onClose={onClose}
      className="max-w-md"
      title="编辑已开票未收款金额"
      description={`${target.companyCode} · ${target.counterpartyName || target.counterpartyCode}`}
      footer={(
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={updateMutation.isPending}>取消</Button>
          <Button size="sm" disabled={updateMutation.isPending} onClick={handleSave}>
            保存
          </Button>
        </div>
      )}
    >
      <div className="space-y-3 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="billed-amount-input">已开票未收款金额（元）</Label>
          <Input id="billed-amount-input" type="number" min={0} step="0.01" placeholder="选填，留空保存为未填写" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        {errorMsg && <FlashMessage type="error">{errorMsg}</FlashMessage>}
      </div>
    </SheetShell>
  )
}

// ===== 业务员编辑抽屉（客商扩展表；选择现有 / 新建） =====
function SalesmanDrawer({ target, onClose }: { target: LedgerTarget; onClose: () => void }) {
  const companyCode = target.companyCode
  const { data: salesmen } = useSalesmen(companyCode)
  const createMutation = useCreateSalesman()
  const updateMutation = useUpdateCustomerExt()
  const [selectedId, setSelectedId] = useState(target.salesmanId ?? '')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const handleAdd = async () => {
    setErrorMsg('')
    if (!newName.trim()) { setErrorMsg('请输入业务员姓名'); return }
    try {
      const created = await createMutation.mutateAsync({ companyCodes: [companyCode], name: newName.trim(), phone: newPhone.trim() || undefined })
      setSelectedId(created.id)
      setNewName('')
      setNewPhone('')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '添加失败')
    }
  }

  const handleSave = async () => {
    setErrorMsg('')
    try {
      await updateMutation.mutateAsync({ companyCode, counterpartyCode: target.counterpartyCode, data: { salesmanId: selectedId || null } })
      onClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <SheetShell
      onClose={onClose}
      className="max-w-md"
      title="业务员"
      description={`${companyCode} · ${target.counterpartyName || target.counterpartyCode}`}
      footer={(
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={updateMutation.isPending || createMutation.isPending}>取消</Button>
          <Button size="sm" disabled={updateMutation.isPending || createMutation.isPending} onClick={handleSave}>保存</Button>
        </div>
      )}
    >
      <div className="space-y-4 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="salesman-select">选择现有业务员</Label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger id="salesman-select" className="w-full">
              <SelectValue placeholder="未指定业务员（选填）" />
            </SelectTrigger>
            <SelectContent>
              {(salesmen || []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}{s.phone ? ` · ${s.phone}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-foreground">新建业务员</p>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-name">姓名（必填）</Label>
            <Input id="salesman-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="业务员姓名" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-phone">联系方式（选填）</Label>
            <Input id="salesman-phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="手机号/电话" />
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={createMutation.isPending} onClick={handleAdd}>
              {createMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              添加
            </Button>
          </div>
        </div>
        {errorMsg && <FlashMessage type="error">{errorMsg}</FlashMessage>}
      </div>
    </SheetShell>
  )
}

// ===== 生成催收建议对话框（从账龄数据批量生成，按 公司×客商×科目 幂等跳过已有未完结计划） =====
function GenerateSuggestionsDialog({ companyCode, open, onSuccess, onClose }: { companyCode?: string; open: boolean; onSuccess: (message: string) => void; onClose: () => void }) {
  const [errorMsg, setErrorMsg] = useState('')
  const generateMutation = useGenerateCollectionSuggestions()
  const { getDisplayName } = useCompanyDisplayName()

  const handleClose = () => {
    setErrorMsg('')
    onClose()
  }

  const handleGenerate = async () => {
    setErrorMsg('')
    try {
      const result = await generateMutation.mutateAsync(companyCode ? { companyCode } : {})
      onSuccess(result.created > 0
        ? `已生成 ${result.created} 条催收建议${result.skipped > 0 ? `，跳过 ${result.skipped} 条（已有未完结计划）` : ''}`
        : '未生成新建议（匹配的应收均已有未完结催收计划）')
      onClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '生成失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>生成催收建议</DialogTitle>
          <DialogDescription>
            将根据当前筛选{companyCode ? `公司「${getDisplayName(companyCode, undefined)}」` : '的全部公司'}的应收账龄数据，
            批量生成催收建议（覆盖逾期 6 个月及以上）；同键已存在未完结计划的公司×客商×科目将自动跳过。
          </DialogDescription>
        </DialogHeader>
        {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>取消</Button>
          <Button disabled={generateMutation.isPending} onClick={handleGenerate}>
            {generateMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===== 催收计划 Tab =====
export function CollectionsTab({ stickyTop = 0 }: { stickyTop?: number }) {
  // 筛选与分页持久化到 pageStateStore（切 tab/切路由/刷新后恢复）；对话框开关为瞬时状态
  // 公司/期间全局口径读 periodStore（Header CompanyPill / PeriodPill 唯一入口），
  // pageStateStore 的 collections.company/period 停止读取（类型定义保留，旧键留存无害）
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const page = usePageStore((s) => s.transactions.collections.page)
  const pageSize = usePageStore((s) => s.transactions.collections.pageSize)
  const statusFilter = usePageStore((s) => s.transactions.collections.status)
  const keyword = usePageStore((s) => s.transactions.collections.keyword)
  const setPage = useCallback((v: number) => setTransactionsTab('collections', { page: v }), [setTransactionsTab])
  const setPageSize = useCallback((v: number) => setTransactionsTab('collections', { pageSize: v }), [setTransactionsTab])
  const setStatusFilter = useCallback((v: string) => setTransactionsTab('collections', { status: v }), [setTransactionsTab])
  const setKeyword = useCallback((v: string) => setTransactionsTab('collections', { keyword: v }), [setTransactionsTab])
  // 公司/期间全局口径：全局未选期间（null）→ '' 跟随最新期间（后端自动取最近一期有数据的期间，与账龄分析页约定一致）
  const globalPeriod = usePeriodStore((s) => s.period)
  const periodFilter = globalPeriod ?? ''
  // 全局公司集合 → 单公司接口降级（getCustomerLedger 仅支持 companyCode 单公司参数）：
  // 未选（null/[]）→ undefined（全部公司）；选中多家 → 取第一个 + antd message 提示
  const { companyCode } = useGlobalCompanyScope('催收计划')
  // 全局公司/期间变化时回到第一页（跳过首挂载，保留分页恢复能力）
  const globalCompanyKey = companyCode ?? ''
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    setPage(1)
  }, [globalCompanyKey, periodFilter, setPage])
  const [updatingRow, setUpdatingRow] = useState<CustomerLedgerItem | null>(null)
  const [logsRow, setLogsRow] = useState<CustomerLedgerItem | null>(null)
  const [billedTarget, setBilledTarget] = useState<LedgerTarget | null>(null)
  const [salesmanTarget, setSalesmanTarget] = useState<LedgerTarget | null>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [generateNotice, setGenerateNotice] = useState('')
  const { can } = usePermission()
  const { getDisplayName } = useCompanyDisplayName()
  const navigate = useNavigate()
  const canViewSalesmen = can('transactions:salesmen', 'view')

  const canUpdate = can('transactions', 'update')
  const canGenerate = can('transactions', 'create')

  const { data, isLoading } = useCustomerLedger({
    page,
    pageSize,
    companyCode,
    status: statusFilter || undefined,
    counterpartyKeyword: keyword || undefined,
    period: periodFilter || undefined,
  })

  const items = data?.items || []
  const total = data?.total || 0
  const stats = data?.stats

  // 应收款客商台账列（行粒度：公司×客商；操作列带权限门禁）
  const ledgerColumns: DataTableColumn<CustomerLedgerItem>[] = useMemo(() => [
    {
      key: 'companyCode', header: '公司',
      render: (row) => <span title={row.companyCode}>{getDisplayName(row.companyCode, undefined)}</span>,
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
    {
      key: 'closingBalance', header: '应收金额', align: 'right', cellClassName: 'font-num',
      render: (row) => <span className={amountTone(row.closingBalance)}>{fmtAmount(row.closingBalance)}</span>,
    },
    {
      key: 'billedUncollectedAmount', header: '已开票未收款', align: 'right', cellClassName: 'font-num group/billed',
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          {fmtAmount(row.billedUncollectedAmount)}
          {canUpdate && (
            <button
              type="button"
              className="invisible rounded px-1 text-xs text-primary group-hover/billed:visible focus-visible:visible hover:underline"
              onClick={() => setBilledTarget(row)}
            >
              编辑
            </button>
          )}
        </span>
      ),
    },
    {
      key: 'salesmanName', header: '业务员', cellClassName: 'group/salesman',
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          {row.salesmanName || '-'}
          {canUpdate && (
            <button
              type="button"
              className="invisible rounded px-1 text-xs text-primary group-hover/salesman:visible focus-visible:visible hover:underline"
              onClick={() => setSalesmanTarget(row)}
            >
              编辑
            </button>
          )}
        </span>
      ),
    },
    {
      key: 'plannedDate', header: '计划日期',
      render: (row) => {
        const overdue = row.plannedDate !== null && row.plannedDate < new Date().toISOString().slice(0, 10) && row.planStatus !== 'full' && row.planStatus !== 'bad_debt'
        return (
          <span className={cn('text-xs whitespace-nowrap', overdue && 'font-medium text-destructive')} title={overdue ? '已逾期' : undefined}>
            {row.plannedDate ?? '-'}
            {overdue && <span className="ml-1 text-micro font-normal text-muted-foreground">已逾期</span>}
          </span>
        )
      },
    },
    { key: 'method', header: '方式', render: (row) => <span className="text-xs">{row.method ? (METHOD_LABELS[row.method] || row.method) : '-'}</span> },
    { key: 'actualAmount', header: '实际回收', align: 'right', cellClassName: 'font-num', render: (row) => fmtAmount(row.actualAmount) },
    {
      key: 'status', header: '状态',
      render: (row) => {
        const statusKey = (row.planStatus ?? 'unplanned') as CollectionStatus | 'unplanned'
        return (
          <span className={cn('rounded px-1.5 py-0.5 text-xs', STATUS_STYLES[statusKey] ?? 'bg-muted text-muted-foreground')} title={row.statusNote ?? undefined}>
            {STATUS_LABELS[statusKey] ?? statusKey}
          </span>
        )
      },
    },
    {
      key: 'actions', header: '操作', cellClassName: 'group/ops whitespace-nowrap',
      render: (row) => (
        <span className="invisible inline-flex gap-1 group-hover/ops:visible focus-within:visible">
          {canUpdate && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setBilledTarget(row)}>
              编辑
            </Button>
          )}
          {canUpdate && row.planId && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setUpdatingRow(row)}>
              更新
            </Button>
          )}
          {row.planId && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLogsRow(row)}>
              记录
            </Button>
          )}
        </span>
      ),
    },
  ], [getDisplayName, canUpdate, setUpdatingRow, setLogsRow, setBilledTarget, setSalesmanTarget])

  return (
    <div className="space-y-4">
      {/* 筛选卡：客商状态 / 客商关键词（吸顶；公司/期间全局口径在 Header 筛选） */}
      <Card className="sticky z-10 rounded-card p-4" style={{ top: stickyTop }}>
      <FilterBar>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className={`h-9 ${FILTER_WIDTH.period}`}>
            <SelectValue placeholder="客商状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部客商</SelectItem>
            <SelectItem value="unplanned">未计划</SelectItem>
            {(Object.keys(STATUS_LABELS) as (CollectionStatus | 'unplanned')[]).filter((s) => s !== 'unplanned').map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="搜索客商..."
          className={`h-9 ${FILTER_WIDTH.medium}`}
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
        />
        {canGenerate && (
          <Button variant="outline" size="sm" className={cn(!canViewSalesmen && 'ml-auto')} onClick={() => setGenerateOpen(true)}>
            <Sparkles className="mr-1 h-4 w-4" />
            生成催收建议
          </Button>
        )}
        {canViewSalesmen && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => navigate('/transactions/collections/salesmen')}>
            <Users className="mr-1 h-4 w-4" />
            业务员管理
          </Button>
        )}
      </FilterBar>
      {stats && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-dashed border-border pt-2.5 text-xs">
          {(Object.keys(STATUS_LABELS) as (CollectionStatus | 'unplanned')[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setStatusFilter(statusFilter === s ? '' : s); setPage(1) }}
              className={cn('flex items-center gap-1.5', statusFilter === s && 'font-semibold text-foreground')}
              title={`点击${statusFilter === s ? '清除' : '筛选'}「${STATUS_LABELS[s]}」`}
            >
              <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[s])} />
              {STATUS_LABELS[s]} <span className="font-num">{stats.byStatus[s] ?? 0}</span>
            </button>
          ))}
          <span className="ml-auto text-muted-foreground">
            应收金额合计 <span className="font-num font-medium text-destructive">{formatWan(stats.totalBalance)}<span className="ml-0.5 text-micro font-normal">万</span></span>
          </span>
        </div>
      )}
      </Card>

      {generateNotice && (
        <FlashMessage type="success" autoHideMs={5000} onAutoHide={() => setGenerateNotice('')}>{generateNotice}</FlashMessage>
      )}

      {/* 应收款客商台账（表格卡） */}
      <Card className="rounded-card border border-border overflow-hidden">
        <div className="pt-4">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无应收款客商数据</div>
          ) : (
            <div className="px-2 pb-2">
              <DataTable
                columns={ledgerColumns}
                data={items}
                rowKey={(row) => `${row.companyCode}|${row.counterpartyCode}`}
                density="compact"
                caption="应收款客商台账"
                maxHeight={`calc(100dvh - ${stickyTop}px - 24px)`}
              />
            </div>
          )}
        </div>
        {/* 分页：并入表格卡底部 border-t 行 */}
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

      <UpdateStatusDialog row={updatingRow} onClose={() => setUpdatingRow(null)} />
      <LogsDialog row={logsRow} canUpdate={canUpdate} onClose={() => setLogsRow(null)} />
      {billedTarget && <BilledAmountDrawer target={billedTarget} onClose={() => setBilledTarget(null)} />}
      {salesmanTarget && <SalesmanDrawer target={salesmanTarget} onClose={() => setSalesmanTarget(null)} />}
      <GenerateSuggestionsDialog companyCode={companyCode} open={generateOpen} onSuccess={setGenerateNotice} onClose={() => setGenerateOpen(false)} />
    </div>
  )
}
