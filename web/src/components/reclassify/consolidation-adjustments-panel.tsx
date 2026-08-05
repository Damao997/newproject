import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useConsolidationAdjustments, useDeleteConsolidationAdjustment } from '@/hooks/api-queries'
import { formatMoney, cn } from '@/lib/utils'
import { Trash2 } from 'lucide-react'
import type { ConsolidationAdjustment } from '@/types'

const PAGE_SIZE = 10

/**
 * 汇总抵消调整记录面板（内嵌于数据管理页）：分页展示汇总口径的抵消调整历史，
 * 行点击展开查看调整原因；删除即撤销抵消（软删除，聚合查询立即恢复原口径）。
 */
export function ConsolidationAdjustmentsPanel() {
  const [page, setPage] = useState(1)
  const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const { confirm, element: confirmElement } = useConfirm()
  const { data, isFetching } = useConsolidationAdjustments({ page, pageSize: PAGE_SIZE })
  const deleteMutation = useDeleteConsolidationAdjustment()

  const items = (data?.items ?? []) as ConsolidationAdjustment[]
  const total = data?.total ?? 0

  const toggleExpanded = (row: ConsolidationAdjustment) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

  const handleDelete = async (row: ConsolidationAdjustment) => {
    const ok = await confirm({
      title: '撤销汇总抵消调整',
      description: `将撤销「${row.summaryCompanyName}」${row.period} 科目「${row.accountName}」的抵消金额 ${formatMoney(Math.abs(row.amount))}（${row.amount > 0 ? '调增' : '调减'}），汇总口径将恢复抵消前数值（单体报表不受影响）。确认删除？`,
      danger: true,
      confirmText: '确认删除',
    })
    if (!ok) return
    setMessage(null)
    try {
      await deleteMutation.mutateAsync(row.id)
      setMessage('已撤销该抵消调整。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '删除失败')
    }
  }

  const columns: DataTableColumn<ConsolidationAdjustment>[] = [
    { key: 'createdAt', header: '时间', cellClassName: 'whitespace-nowrap text-muted-foreground', render: (r) => new Date(r.createdAt).toLocaleString('zh-CN') },
    { key: 'summary', header: '汇总主体', render: (r) => <span className="text-xs" title={r.summaryCompanyCode}>{r.summaryCompanyName}</span> },
    { key: 'account', header: '科目', render: (r) => <span className="text-xs" title={r.accountCode}>{r.accountName}</span> },
    { key: 'period', header: '期间', cellClassName: 'font-num text-xs', render: (r) => r.period },
    {
      key: 'amount', header: '抵消金额', align: 'right',
      render: (r) => (
        <span className={cn('font-num', r.amount > 0 ? 'text-success-strong' : 'text-destructive')}>
          {r.amount > 0 ? '+' : ''}{formatMoney(r.amount)}
        </span>
      ),
    },
    { key: 'operator', header: '操作人' },
    {
      key: 'actions', header: '操作', align: 'right',
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-finance-red"
          title="撤销本次抵消（汇总口径恢复原值）"
          disabled={deleteMutation.isPending}
          onClick={(e) => { e.stopPropagation(); handleDelete(r) }}
        >
          <Trash2 className="mr-1 h-4 w-4" />
          撤销
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-3">
      {message && (
        <p className={cn('text-xs', message.includes('失败') ? 'text-destructive' : 'text-muted-foreground')}>{message}</p>
      )}
      <div className="overflow-x-auto">
        <DataTable
          columns={columns}
          data={items}
          rowKey={(r) => r.id}
          emptyText={isFetching ? '加载中...' : '暂无汇总抵消调整记录'}
          onRowClick={toggleExpanded}
          expandedKeys={expandedKeys}
          renderExpanded={(r) => (
            <div className="space-y-1 py-1 text-xs text-muted-foreground">
              <p className="text-foreground">调整原因：{r.reason}</p>
              <p>生效范围：仅汇总主体「{r.summaryCompanyName}」的查询口径，单体报表不受影响。</p>
            </div>
          )}
        />
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      {confirmElement}
    </div>
  )
}
