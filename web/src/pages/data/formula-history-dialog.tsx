import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useMetricHistory, useRollbackMetric, useApproveMetric, useRejectMetric } from '@/hooks/api-queries'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { FormulaText } from './formula-text'

interface MetricRef {
  id: string
  code: string
  name: string
}

interface HistoryDialogProps {
  metric: MetricRef | null
  formatFormula: (f: string | null | undefined) => string
  onClose: () => void
  canApprove?: boolean
}

/**
 * 指标公式版本历史对话框：查看历史版本、回滚、轻量审批（通过/驳回）。
 */
export function HistoryDialog({ metric, formatFormula, onClose, canApprove = false }: HistoryDialogProps) {
  const { data, isLoading } = useMetricHistory(metric?.id ?? null)
  const rollback = useRollbackMetric()
  const approve = useApproveMetric()
  const reject = useRejectMetric()
  const { confirm, element: confirmElement } = useConfirm()
  const [actionError, setActionError] = useState<string | null>(null)
  const [compareVersions, setCompareVersions] = useState<number[]>([])
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)

  const toggleCompare = (version: number) => {
    setCompareVersions(prev => {
      if (prev.includes(version)) return prev.filter(v => v !== version)
      if (prev.length >= 2) return [prev[1], version]
      return [...prev, version]
    })
  }

  const handleRollback = async (version: number, formula: string) => {
    if (!metric) return
    if (!(await confirm({ title: '回滚版本', description: `确认回滚到 v${version}？公式将变为：${formatFormula(formula)}`, confirmText: '回滚' }))) return
    setActionError(null)
    try {
      await rollback.mutateAsync({ id: metric.id, version })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '回滚失败')
    }
  }

  const handleApprove = async () => {
    if (!metric) return
    setActionError(null)
    try {
      await approve.mutateAsync(metric.id)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '审批失败')
    }
  }

  const handleReject = async () => {
    if (!metric) return
    if (!showRejectInput) { setShowRejectInput(true); return }
    if (!rejectReason.trim()) { setActionError('请填写驳回原因'); return }
    if (!(await confirm({ title: '驳回公式', description: `驳回原因：${rejectReason}`, danger: true, confirmText: '确认驳回' }))) return
    setActionError(null)
    try {
      await reject.mutateAsync(metric.id)
      setShowRejectInput(false)
      setRejectReason('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '驳回失败')
    }
  }

  return (
    <Dialog open={!!metric} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>公式版本历史</DialogTitle>
          <DialogDescription>{metric ? `${metric.name}（${metric.code}）` : ''}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">加载中...</p>
        ) : !data || data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">暂无历史版本</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 w-8"></th>
                  <th className="p-2 text-left font-medium">版本</th>
                  <th className="p-2 text-left font-medium">公式</th>
                  <th className="p-2 text-left font-medium">说明</th>
                  <th className="p-2 text-left font-medium">变更人</th>
                  <th className="p-2 text-left font-medium">时间</th>
                  <th className="p-2 text-left font-medium">审批</th>
                  <th className="p-2 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.map((h) => (
                  <tr key={h.version} className="border-b">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={compareVersions.includes(h.version)}
                        onChange={() => toggleCompare(h.version)}
                      />
                    </td>
                    <td className="p-2 font-mono">v{h.version}</td>
                    <td className="p-2 font-mono">{h.formula ? <FormulaText text={formatFormula(h.formula)} className="max-w-[260px]" /> : '（空）'}</td>
                    <td className="p-2 text-muted-foreground">{h.description ?? '—'}</td>
                    <td className="p-2">{h.changedByName}</td>
                    <td className="p-2 text-muted-foreground whitespace-nowrap">{new Date(h.changedAt).toLocaleString('zh-CN')}</td>
                    <td className="p-2">
                      {h.approvedBy ? <Badge variant="success">已审</Badge> : <Badge variant="secondary">待审</Badge>}
                    </td>
                    <td className="p-2">
                      <Button variant="ghost" size="sm" onClick={() => handleRollback(h.version, h.formula)} disabled={rollback.isPending}>
                        回滚
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {compareVersions.length === 2 && (() => {
          const vA = (data ?? []).find(h => h.version === compareVersions[0])
          const vB = (data ?? []).find(h => h.version === compareVersions[1])
          if (!vA || !vB) return null
          const codesA = new Set((vA.formula?.match(/\{([^}]+)\}/g) ?? []).map(m => m.slice(1, -1)))
          const codesB = new Set((vB.formula?.match(/\{([^}]+)\}/g) ?? []).map(m => m.slice(1, -1)))
          const added = [...codesB].filter(c => !codesA.has(c))
          const removed = [...codesA].filter(c => !codesB.has(c))
          return (
            <div className="mt-3 space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">版本对比：v{vA.version} vs v{vB.version}</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-md bg-muted/30 p-2">
                  <p className="font-medium">v{vA.version}</p>
                  <p className="mt-1 break-all font-mono">{vA.formula ? formatFormula(vA.formula) : '（空）'}</p>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <p className="font-medium">v{vB.version}</p>
                  <p className="mt-1 break-all font-mono">{vB.formula ? formatFormula(vB.formula) : '（空）'}</p>
                </div>
              </div>
              {(added.length > 0 || removed.length > 0) && (
                <div className="flex flex-wrap gap-1 text-xs">
                  {added.map(c => <Badge key={c} variant="success" className="text-[10px]">+{formatFormula(`{${c}}`)}</Badge>)}
                  {removed.map(c => <Badge key={c} variant="destructive" className="text-[10px]">-{formatFormula(`{${c}}`)}</Badge>)}
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={() => setCompareVersions([])}>清除对比</Button>
            </div>
          )
        })()}
        {canApprove && data && data.length > 0 && (
          <div className="flex justify-end space-x-2">
            <Button variant="outline" size="sm" onClick={handleReject} disabled={reject.isPending}>
              驳回最新
            </Button>
            <Button size="sm" onClick={handleApprove} disabled={approve.isPending}>
              审批通过
            </Button>
          </div>
        )}
        {showRejectInput && (
          <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="请输入驳回原因..." className="mt-2" />
        )}
        {actionError && <p className="text-xs text-destructive">{actionError}</p>}
        {confirmElement}
      </DialogContent>
    </Dialog>
  )
}
