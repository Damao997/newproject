import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'
import { useReclassifyLogs } from '@/hooks/api-queries'
import { formatMoney, cn } from '@/lib/utils'
import { ArrowRight } from 'lucide-react'
import { TYPE_LABEL, TEMPLATE_LABEL_SHORT } from './shared'
import type { ReclassifyLog } from '@/types'

interface ReclassifyLogsDialogProps {
  open: boolean
  onClose: () => void
}

const PAGE_SIZE = 10

const TYPE_BADGE_CLASS: Record<string, string> = {
  company: 'border-transparent bg-blue-100 text-blue-800',
  subject: 'border-transparent bg-secondary text-secondary-foreground',
  subject_adjust: 'border-transparent bg-amber-100 text-amber-800',
}

const TRANSFER_MODE_LABEL: Record<string, string> = {
  all: '整体迁移',
  ratio: '按比例',
  amount: '按金额',
}

/** 「源 → 目标」结构化展示 */
function SourceTarget({ log }: { log: ReclassifyLog }) {
  const [source, target] =
    log.type === 'company'
      ? [log.sourceCompany, log.targetCompany]
      : [log.sourceSubject, log.targetSubject]
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs">{source ?? '-'}</span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      {target ? (
        <span className="font-mono text-xs">{target}</span>
      ) : (
        <span className="text-xs text-muted-foreground">{log.type === 'subject_adjust' ? '仅调减' : '-'}</span>
      )}
      {log.templateType && (
        <span className="text-xs text-muted-foreground">（{TEMPLATE_LABEL_SHORT[log.templateType] ?? log.templateType}）</span>
      )}
    </span>
  )
}

/** 「金额明细」列：按类型展示转移方式/金额或调减调增净变动 */
function AmountDetail({ log }: { log: ReclassifyLog }) {
  const d = log.detail
  if (log.type === 'company') {
    if (!d?.transferMode) return <span className="text-muted-foreground">-</span>
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{TRANSFER_MODE_LABEL[d.transferMode] ?? d.transferMode}{d.transferMode === 'ratio' && d.ratio ? ` ${Math.round(d.ratio * 10000) / 100}%` : ''}</span>
        {d.transferValue !== undefined && <span className="font-num font-medium">{formatMoney(d.transferValue)}</span>}
      </span>
    )
  }
  if (log.type === 'subject_adjust' && d) {
    const net = d.netChange ?? 0
    return (
      <span className="inline-flex items-center gap-1.5 font-num text-xs">
        <span className="text-red-600">-{formatMoney(d.decreaseAmount ?? 0)}</span>
        {(d.increaseAmount ?? 0) > 0 && <span className="text-green-700">+{formatMoney(d.increaseAmount ?? 0)}</span>}
        <span className={cn(net !== 0 ? 'text-amber-700' : 'text-muted-foreground')}>（净 {formatMoney(net)}）</span>
      </span>
    )
  }
  return <span className="text-muted-foreground">-</span>
}

/** 行展开明细：期间范围、原因、合并/新建行数等 */
function ExpandedDetail({ log }: { log: ReclassifyLog }) {
  const d = log.detail
  const period = log.periodFrom || log.periodTo ? `${log.periodFrom ?? '不限'} ~ ${log.periodTo ?? '不限'}` : '全部期间'
  return (
    <div className="space-y-1 py-1 text-xs text-muted-foreground">
      <p>期间范围：{period}</p>
      {log.type === 'company' && d && (
        <p>
          合并 {d.mergedRows ?? 0} 行，新建 {d.createdRows ?? 0} 行
          {d.accountCodes && d.accountCodes.length > 0 && <>；筛选科目：{d.accountCodes.join('、')}</>}
        </p>
      )}
      {log.type === 'subject_adjust' && d && (
        <>
          <p>累加 {d.mergedRows ?? 0} 行，新建 {d.createdRows ?? 0} 行</p>
          {d.reason && <p className="text-foreground">调整原因：{d.reason}</p>}
        </>
      )}
      {!d && <p>无更多明细（历史记录）。</p>}
    </div>
  )
}

/** 重分类记录对话框：分页展示跨公司/科目归类/科目调整历史，行点击展开查看原因与行数明细。 */
export function ReclassifyLogsDialog({ open, onClose }: ReclassifyLogsDialogProps) {
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(new Set())
  const { data, isFetching } = useReclassifyLogs(open ? { page, pageSize: PAGE_SIZE, type: type === 'all' ? undefined : type } : { page: 1, pageSize: PAGE_SIZE })

  const items = (data?.items ?? []) as ReclassifyLog[]
  const total = data?.total ?? 0

  const toggleExpanded = (row: ReclassifyLog) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

  const columns: DataTableColumn<ReclassifyLog>[] = [
    { key: 'createdAt', header: '时间', cellClassName: 'whitespace-nowrap text-muted-foreground', render: (r) => new Date(r.createdAt).toLocaleString('zh-CN') },
    {
      key: 'type', header: '类型',
      render: (r) => <Badge variant="outline" className={TYPE_BADGE_CLASS[r.type]}>{TYPE_LABEL[r.type] ?? r.type}</Badge>,
    },
    { key: 'target', header: '源 → 目标', render: (r) => <SourceTarget log={r} /> },
    { key: 'amount', header: '金额明细', render: (r) => <AmountDetail log={r} /> },
    {
      key: 'affectedRows', header: '影响行数', align: 'right', cellClassName: 'font-num',
      render: (r) => (r.type === 'subject' ? '-' : r.affectedRows),
    },
    { key: 'operator', header: '操作人' },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>重分类记录</DialogTitle>
          <DialogDescription>跨公司重分类、科目归类与科目间调整的操作历史，点击行查看明细。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">类型:</span>
            <Select value={type} onValueChange={(v) => { setType(v); setPage(1); setExpandedKeys(new Set()) }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="company">跨公司</SelectItem>
                <SelectItem value="subject">科目归类</SelectItem>
                <SelectItem value="subject_adjust">科目调整</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <DataTable
              columns={columns}
              data={items}
              rowKey={(r) => r.id}
              emptyText={isFetching ? '加载中...' : '暂无重分类记录'}
              onRowClick={toggleExpanded}
              expandedKeys={expandedKeys}
              renderExpanded={(r) => <ExpandedDetail log={r} />}
            />
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
