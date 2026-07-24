import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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

  const handleRollback = async (version: number) => {
    if (!metric) return
    if (!(await confirm({ title: '回滚版本', description: `确认回滚到 v${version}？将生成新版本。`, confirmText: '回滚' }))) return
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
    if (!(await confirm({ title: '驳回公式', description: '确认驳回最新公式？将回退到上一版本（无上一版本则清空）。', danger: true, confirmText: '驳回' }))) return
    setActionError(null)
    try {
      await reject.mutateAsync(metric.id)
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
                    <td className="p-2 font-mono">v{h.version}</td>
                    <td className="p-2 font-mono">{h.formula ? formatFormula(h.formula) : '（空）'}</td>
                    <td className="p-2 text-muted-foreground">{h.description ?? '—'}</td>
                    <td className="p-2">{h.changedByName}</td>
                    <td className="p-2 text-muted-foreground whitespace-nowrap">{new Date(h.changedAt).toLocaleString('zh-CN')}</td>
                    <td className="p-2">
                      {h.approvedBy ? <Badge variant="success">已审</Badge> : <Badge variant="secondary">待审</Badge>}
                    </td>
                    <td className="p-2">
                      <Button variant="ghost" size="sm" onClick={() => handleRollback(h.version)} disabled={rollback.isPending}>
                        回滚
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
        {actionError && <p className="text-xs text-destructive">{actionError}</p>}
        {confirmElement}
      </DialogContent>
    </Dialog>
  )
}
