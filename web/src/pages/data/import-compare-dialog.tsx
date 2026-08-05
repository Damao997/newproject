import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useCompareImports, useRollbackImport } from '@/hooks/api-queries'
import { usePermission } from '@/hooks/usePermission'
import { cn, formatMoneyWan, getChangeColor, getChangePrefix } from '@/lib/utils'
import { type ImportBatch, type ImportDiffRow } from '@/types'
import { GitCompareArrows, Loader2, RotateCcw, AlertTriangle, Inbox } from 'lucide-react'

/** 批次状态中文标签（与 import-panel 一致） */
const statusLabel: Record<string, string> = { draft: '草稿', active: '已生效', archived: '已归档', purged: '已清除' }

/** 差异行表格列（changed/added/removed 共用，按需隐藏列） */
function DiffTable({ rows, showOld, showNew }: { rows: ImportDiffRow[]; showOld: boolean; showNew: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">该分组无记录</p>
      </div>
    )
  }
  return (
    <div className="max-h-[340px] overflow-auto rounded-lg border">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0">
          <tr className="border-b bg-muted/50 text-black">
            <th className="h-9 px-3 text-center font-medium">科目</th>
            <th className="h-9 px-3 text-center font-medium">公司</th>
            <th className="h-9 px-3 text-center font-medium">期间</th>
            {showOld && <th className="h-9 px-3 text-center font-medium">旧值(万)</th>}
            {showNew && <th className="h-9 px-3 text-center font-medium">新值(万)</th>}
            <th className="h-9 px-3 text-center font-medium">差值(万)</th>
            <th className="h-9 px-3 text-center font-medium">变化</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const deltaColor = r.delta === 0 ? 'text-muted-foreground' : getChangeColor(r.delta)
            return (
              <tr key={`${r.companyCode}-${r.accountCode}-${r.period}-${i}`} className="border-b last:border-0 hover:bg-muted/40">
                <td className="whitespace-nowrap px-3 py-1.5 font-medium text-foreground">{r.subjectName}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-center font-mono text-muted-foreground">{r.companyCode}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-center font-mono text-muted-foreground">{r.period}</td>
                {showOld && (
                  <td className={cn('whitespace-nowrap px-3 py-1.5 text-right font-num', r.delta !== 0 && 'text-muted-foreground')}>
                    {r.delta !== 0 ? formatMoneyWan(r.oldValue) : '-'}
                  </td>
                )}
                {showNew && (
                  <td className={cn('whitespace-nowrap px-3 py-1.5 text-right font-num', r.delta !== 0 ? 'text-foreground' : 'text-muted-foreground')}>
                    {r.delta !== 0 ? formatMoneyWan(r.newValue) : '-'}
                  </td>
                )}
                <td className={cn('whitespace-nowrap px-3 py-1.5 text-right font-num', deltaColor)}>
                  {getChangePrefix(r.delta)}{formatMoneyWan(r.delta)}
                </td>
                <td className={cn('whitespace-nowrap px-3 py-1.5 text-right font-num', deltaColor)}>
                  {r.deltaPercent !== null ? `${getChangePrefix(r.deltaPercent)}${r.deltaPercent.toFixed(1)}%` : '-'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface ImportCompareDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 发起对比的批次（行内「对比」按钮所在行） */
  source: ImportBatch | null
  /** 同模板类型、非 purged、排除 source 自身的候选批次 */
  candidates: ImportBatch[]
  /** 回滚成功回调（父级刷新批次列表与提示） */
  onRollbackSuccess?: (message: string) => void
}

/**
 * 批次差异对比对话框（US-03）：
 * 第一步选择对比目标批次 → 自动发起对比查询 → 分组展示 变化/新增/删除；
 * 底部提供「回滚到目标批次」按钮（恢复快照数据并重新激活历史批次）。
 */
export function ImportCompareDialog({ open, onOpenChange, source, candidates, onRollbackSuccess }: ImportCompareDialogProps) {
  const { can } = usePermission()
  // 回滚为高危操作，独立权限点 data:import:rollback（仅 superadmin，与后端路由一致）
  const canImport = can('data:import', 'rollback')
  const [targetId, setTargetId] = useState<string>('')
  const { confirm, element: confirmElement } = useConfirm()
  const rollbackMutation = useRollbackImport()
  const [rollbackError, setRollbackError] = useState<string | null>(null)

  const target = useMemo(() => candidates.find((c) => c.id === targetId) ?? null, [candidates, targetId])
  const { data, isFetching, isError, error } = useCompareImports(open && source ? source.id : null, targetId || null)

  // 关闭时重置选择与错误（下次打开重新选择）
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setTargetId('')
      setRollbackError(null)
    }
    onOpenChange(v)
  }

  const handleRollback = async () => {
    if (!source || !target) return
    const ok = await confirm({
      title: '回滚批次确认',
      description: `将恢复批次《${target.filename}》的快照数据并重新激活，删除当前生效批次中与之重叠期间的数据。此操作不可撤销，确认回滚？`,
      danger: true,
      confirmText: '回滚',
    })
    if (!ok) return
    setRollbackError(null)
    try {
      await rollbackMutation.mutateAsync(target.id)
      handleOpenChange(false)
      onRollbackSuccess?.(`批次《${target.filename}》已回滚生效，重叠期间数据已恢复为该批次口径。`)
    } catch (err) {
      setRollbackError(err instanceof Error ? err.message : '回滚失败')
    }
  }

  const summary = data?.summary
  const totalDelta = summary?.totalDelta ?? 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4" />
            批次差异对比
          </DialogTitle>
          <DialogDescription>
            对比两个批次的指标值差异（按 公司 × 科目 × 期间 对齐），帮助核对导入变更。{source ? `当前批次：《${source.filename}》` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 对比目标选择 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">对比目标批次:</span>
            <Select value={targetId} onValueChange={setTargetId} disabled={candidates.length === 0}>
              <SelectTrigger className="h-8 w-[320px] max-w-full">
                <SelectValue placeholder={candidates.length === 0 ? '暂无同类型可对比批次' : '选择要对比的批次'} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.filename}（{statusLabel[c.status] ?? c.status}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {isError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{error instanceof Error ? error.message : '对比失败，请重试'}</p>
            </div>
          )}

          {data && (
            <>
              {/* 汇总条 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-[13px]">
                <span className="font-medium text-foreground">
                  {data.a.filename} → {data.b.filename}
                </span>
                <span className="font-num text-muted-foreground">变化 {summary?.changedCount ?? 0} 项</span>
                <span className="font-num text-muted-foreground">新增 {summary?.addedCount ?? 0} 项</span>
                <span className="font-num text-muted-foreground">删除 {summary?.removedCount ?? 0} 项</span>
                <span className={cn('font-num', getChangeColor(totalDelta))}>
                  合计变动 {getChangePrefix(totalDelta)}{formatMoneyWan(totalDelta)} 万
                </span>
                {summary?.truncated && (
                  <span className="text-xs text-warning-strong">结果超过 500 行已截断，仅展示变更幅度最大的部分</span>
                )}
              </div>

              {/* 分组 Tab */}
              <Tabs defaultValue="changed">
                <TabsList>
                  <TabsTrigger value="changed">变化（{summary?.changedCount ?? 0}）</TabsTrigger>
                  <TabsTrigger value="added">新增（{summary?.addedCount ?? 0}）</TabsTrigger>
                  <TabsTrigger value="removed">删除（{summary?.removedCount ?? 0}）</TabsTrigger>
                </TabsList>
                <TabsContent value="changed">
                  <DiffTable rows={data.changed} showOld showNew />
                </TabsContent>
                <TabsContent value="added">
                  <DiffTable rows={data.added} showOld={false} showNew />
                </TabsContent>
                <TabsContent value="removed">
                  <DiffTable rows={data.removed} showOld showNew={false} />
                </TabsContent>
              </Tabs>

              {target?.status === 'active' && (
                <p className="text-xs text-muted-foreground">目标批次生效中，回滚将恢复其被覆盖期间的数据并重新激活。</p>
              )}
              {rollbackError && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <p className="text-sm text-destructive">{rollbackError}</p>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>关闭</Button>
          {canImport && data && target && (
            <Button
              className="text-destructive-foreground"
              disabled={rollbackMutation.isPending}
              onClick={handleRollback}
              title="恢复目标批次快照数据并重新激活">
              {rollbackMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
              回滚到《{target.filename}》
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      {confirmElement}
    </Dialog>
  )
}
