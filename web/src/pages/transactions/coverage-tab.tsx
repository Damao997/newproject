import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { useTransactionImportCoverage, useActivateImport } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { useBatchActivate, buildActivateConflictDescription } from '@/hooks/use-batch-activate'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { AlertTriangle, CheckCircle2, Grid3X3, Loader2, RefreshCw } from 'lucide-react'
import type { TransactionCoverageCell } from '@/types'

/**
 * 导入覆盖 Tab：公司 × 期间 × 六大往来类型 的导入完整性矩阵。
 * 绿=已生效(笔数)、青=已导入·该期确无往来款、黄=草稿未激活、灰=缺失；
 * 顶部为覆盖率统计与待激活批次提醒。
 */

const MONTH_OPTIONS = [
  { value: 3, label: '最近 3 个月' },
  { value: 6, label: '最近 6 个月' },
  { value: 12, label: '最近 12 个月' },
]

function cellKey(companyCode: string, period: string, type: string): string {
  return `${companyCode}|${period}|${type}`
}

export function CoverageTab() {
  // 覆盖窗口月份持久化到 pageStateStore（切 tab/切路由/刷新后恢复）
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const months = usePageStore((s) => s.transactions.coverage.months)
  const setMonths = useCallback((v: number) => setTransactionsTab('coverage', { months: v }), [setTransactionsTab])
  const { can } = usePermission()
  const canImport = can('transactions', 'import')

  const { data, isLoading, isError, error, refetch, isFetching } = useTransactionImportCoverage(months)
  const activateMutation = useActivateImport()
  const { getDisplayName } = useCompanyDisplayName()
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [activateError, setActivateError] = useState('')
  const { confirm, element: confirmElement } = useConfirm()
  const batchActivate = useBatchActivate()
  // 待激活批次多选（用于批量激活）
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set())

  const toggleDraftSelect = (id: string) => {
    setSelectedDraftIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 批量激活：预检冲突 → 确认覆盖风险 → 串行逐个激活（单批失败不中断，失败项保留勾选便于重试） */
  const handleBatchActivate = async () => {
    const targets = draftBatches.filter((b) => selectedDraftIds.has(b.id))
    if (targets.length === 0) return
    const batches = targets.map((b) => ({ id: b.id, filename: b.filename }))
    setActivateError('')
    try {
      const check = await batchActivate.checkConflicts(batches.map((b) => b.id))
      const desc = buildActivateConflictDescription(check)
      if (desc && !(await confirm({ title: '批量激活确认', description: desc, danger: true, confirmText: '继续激活' }))) return
      const summary = await batchActivate.run(batches)
      const failIds = new Set(summary.failItems.map((f) => f.id))
      // 成功项移出勾选（失败项保留便于重试）；激活后覆盖矩阵自动刷新（激活 mutation 已失效 transactions 查询）
      setSelectedDraftIds((prev) => new Set([...prev].filter((id) => failIds.has(id))))
      if (summary.failCount > 0) {
        setActivateError(`激活完成：成功 ${summary.successCount} 个，失败 ${summary.failCount} 个。失败批次已保留勾选，可处理后重试。`)
      }
    } catch (e) {
      setActivateError(e instanceof Error ? e.message : '批量激活失败')
    }
  }

  const cellMap = useMemo(() => {
    const m = new Map<string, TransactionCoverageCell>()
    for (const c of data?.cells ?? []) m.set(cellKey(c.companyCode, c.period, c.transactionType), c)
    return m
  }, [data])

  // 期间倒序展示（最近期间在前）
  const periodsDesc = useMemo(() => [...(data?.periods ?? [])].reverse(), [data])

  const handleActivate = async (batchId: string) => {
    setActivateError('')
    setActivatingId(batchId)
    try {
      await activateMutation.mutateAsync(batchId)
    } catch (e) {
      setActivateError(e instanceof Error ? e.message : '激活失败')
    } finally {
      setActivatingId(null)
    }
  }

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-destructive">{error instanceof Error ? error.message : '数据加载失败'}</p>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          重试
        </Button>
      </div>
    )
  }
  if (!data) return <div className="py-12 text-center text-sm text-muted-foreground">暂无数据</div>

  const { summary, draftBatches } = data

  return (
    <div className="space-y-4">
      {/* 待激活批次提醒 */}
      {draftBatches.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/[0.08] p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-warning-strong">
            <AlertTriangle className="h-4 w-4" />
            有 {draftBatches.length} 个往来批次已上传未激活，未激活数据不参与分析
            {canImport && (
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs font-normal">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={draftBatches.length > 0 && draftBatches.every((b) => selectedDraftIds.has(b.id))}
                    disabled={batchActivate.isBusy}
                    onChange={(e) => setSelectedDraftIds(e.target.checked ? new Set(draftBatches.map((b) => b.id)) : new Set())}
                  />
                  全选
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 border-warning/50 px-2 text-xs"
                  disabled={selectedDraftIds.size === 0 || batchActivate.isBusy || activatingId !== null}
                  onClick={handleBatchActivate}
                >
                  {batchActivate.isBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                  批量激活（{selectedDraftIds.size}）
                </Button>
              </span>
            )}
          </div>
          {batchActivate.progress && (
            <p className="mt-1 text-xs text-warning-strong/70">
              正在激活 {batchActivate.progress.done}/{batchActivate.progress.total}：{batchActivate.progress.currentFilename || '-'}
            </p>
          )}
          <ul className="mt-2 space-y-1.5">
            {draftBatches.map((b) => {
              const batchResult = batchActivate.results.get(b.id)
              const batchActivating = batchActivate.isBusy && batchActivate.progress?.currentId === b.id
              return (
                <li key={b.id} className="flex items-center gap-3 text-sm text-warning-strong">
                  {canImport && (
                    <input
                      type="checkbox"
                      className="shrink-0 accent-primary"
                      checked={selectedDraftIds.has(b.id)}
                      disabled={batchActivate.isBusy}
                      onChange={() => toggleDraftSelect(b.id)}
                    />
                  )}
                  <span className="truncate">{b.filename}</span>
                  <span className="shrink-0 text-xs text-warning-strong/70">
                    {b.detailCount} 条 · {new Date(b.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  {canImport && (batchResult?.status === 'success' ? (
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-success-strong">
                      <CheckCircle2 className="h-3 w-3" />已激活
                    </span>
                  ) : batchResult?.status === 'failed' ? (
                    <span className="ml-auto shrink-0 max-w-[220px] truncate text-xs text-destructive" title={batchResult.error}>激活失败：{batchResult.error}</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-6 shrink-0 border-warning/50 px-2 text-xs"
                      disabled={activatingId !== null || batchActivate.isBusy}
                      onClick={() => handleActivate(b.id)}
                    >
                      {batchActivating || activatingId === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : '激活'}
                    </Button>
                  ))}
                </li>
              )
            })}
          </ul>
          {activateError && <p className="mt-1 text-xs text-destructive">{activateError}</p>}
        </div>
      )}

      {/* 统计条 + 期间范围 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span>覆盖率 <span className="font-num font-semibold">{summary.coverageRate}%</span></span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-success" />已生效 {summary.active}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-info" />无数据 {summary.empty}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-warning" />草稿 {summary.draft}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-border" />缺失 {summary.missing}</span>
        </div>
        <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
          <SelectTrigger className="ml-auto h-8 w-[140px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTH_OPTIONS.map((m) => (
              <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 覆盖矩阵 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Grid3X3 className="h-4 w-4" />
            导入覆盖矩阵
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-black">
                  <th className="px-2 py-2 text-center font-medium">公司</th>
                  <th className="px-2 py-2 text-center font-medium">期间</th>
                  {data.types.map((t) => (
                    <th key={t} className="px-2 py-2 text-center font-medium whitespace-nowrap">{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.companies.map((company) =>
                  periodsDesc.map((period, pi) => (
                    <tr key={`${company.code}-${period}`} className={cn('border-b last:border-0', pi === periodsDesc.length - 1 && 'border-b-2')}>
                      {pi === 0 && (
                        <td rowSpan={periodsDesc.length} className="border-r px-2 py-2 align-top text-xs font-medium" title={company.name}>
                          {getDisplayName(company.code, company.name)}
                        </td>
                      )}
                      <td className="px-2 py-1.5 text-center font-num text-xs text-muted-foreground">{period}</td>
                      {data.types.map((type) => {
                        const cell = cellMap.get(cellKey(company.code, period, type))
                        const status = cell?.status ?? 'missing'
                        return (
                          <td key={type} className="px-1.5 py-1.5 text-center">
                            {status === 'active' ? (
                              <span
                                title={`已生效 ${cell!.recordCount} 条`}
                                className="inline-block min-w-[52px] rounded bg-success/10 px-1.5 py-0.5 font-num text-xs text-success-strong"
                              >
                                {cell!.recordCount}
                              </span>
                            ) : status === 'empty' ? (
                              <span
                                title="已导入：该公司该期确无此类往来款（文件已申报，明细为 0 条）"
                                className="inline-block min-w-[52px] rounded bg-info/10 px-1.5 py-0.5 font-num text-xs text-info"
                              >
                                0
                              </span>
                            ) : status === 'draft' ? (
                              <span
                                title="已上传未激活，请在上方提醒条中激活批次"
                                className="inline-block min-w-[52px] rounded bg-warning/15 px-1.5 py-0.5 text-xs text-warning-strong"
                              >
                                草稿
                              </span>
                            ) : (
                              <span
                                title={`未导入：请上传 ${company.name} ${period} 的${type}账龄报表（早期导入的批次未记录申报范围，真空数据重新上传后可识别为“无数据”）`}
                                className="inline-block min-w-[52px] rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground/70"
                              >
                                —
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {confirmElement}
    </div>
  )
}
