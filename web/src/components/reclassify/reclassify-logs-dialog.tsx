import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
import type { ReclassifyLog } from '@/types'

interface ReclassifyLogsDialogProps {
  open: boolean
  onClose: () => void
}

const TYPE_LABEL: Record<string, string> = {
  company: '跨公司',
  subject: '科目归类',
}

const TEMPLATE_LABEL: Record<string, string> = {
  operating: '经营',
  static: '静态',
  budget: '预算',
}

const PAGE_SIZE = 10

/** 重分类记录对话框：分页展示跨公司/科目归类调整历史（审计追溯）。 */
export function ReclassifyLogsDialog({ open, onClose }: ReclassifyLogsDialogProps) {
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const { data, isFetching } = useReclassifyLogs(open ? { page, pageSize: PAGE_SIZE, type: type === 'all' ? undefined : type } : { page: 1, pageSize: PAGE_SIZE })

  const items = (data?.items ?? []) as ReclassifyLog[]
  const total = data?.total ?? 0

  const columns: DataTableColumn<ReclassifyLog>[] = [
    { key: 'createdAt', header: '时间', cellClassName: 'whitespace-nowrap text-muted-foreground', render: (r) => new Date(r.createdAt).toLocaleString('zh-CN') },
    { key: 'type', header: '类型', render: (r) => TYPE_LABEL[r.type] ?? r.type },
    {
      key: 'target', header: '源 → 目标',
      render: (r) =>
        r.type === 'company'
          ? `${r.sourceCompany ?? '-'} → ${r.targetCompany ?? '-'}${r.templateType ? `（${TEMPLATE_LABEL[r.templateType] ?? r.templateType}）` : ''}`
          : `${r.sourceSubject ?? '-'} → ${r.targetSubject ?? '-'}`,
    },
    { key: 'affectedRows', header: '影响行数', align: 'right', cellClassName: 'font-mono', render: (r) => (r.type === 'company' ? r.affectedRows : '-') },
    { key: 'operator', header: '操作人' },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>重分类记录</DialogTitle>
          <DialogDescription>跨公司重分类与科目归类调整的操作历史。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">类型:</span>
            <Select value={type} onValueChange={(v) => { setType(v); setPage(1) }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="company">跨公司</SelectItem>
                <SelectItem value="subject">科目归类</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DataTable columns={columns} data={items} rowKey={(r) => r.id} emptyText={isFetching ? '加载中...' : '暂无重分类记录'} />
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
