import { useMemo } from 'react'
import { CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible } from '@/components/ui/collapsible'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { cn } from '@/lib/utils'
import { batchStatusLabel, errorColumns, templateTypeLabel, type ImportErrorRow } from './use-import-flow'
import type { useBatchActivate } from '@/hooks/use-batch-activate'
import type { ImportBatch } from '@/types'
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  GitCompareArrows,
  Loader2,
  ShieldAlert,
  XCircle,
  Archive,
} from 'lucide-react'

interface BatchPanelProps {
  canImport: boolean
  canArchive: boolean
  canPurgeBatch: boolean
  // 折叠偏好（来自 useImportFlow）
  qualityOpen: boolean
  onQualityOpenChange: (open: boolean) => void
  // 质量统计与批次列表
  qualityStats: { batchCount: number; totalRows: number; successRows: number; errorRows: number }
  recentBatches: ImportBatch[]
  selectedBatch: ImportBatch | null
  selectedBatchId: string | null
  setSelectedBatchId: React.Dispatch<React.SetStateAction<string | null>>
  // 批次多选（批量激活）
  selectedCount: number
  selectableIds: string[]
  selectedBatchIds: Set<string>
  setSelectedBatchIds: React.Dispatch<React.SetStateAction<Set<string>>>
  batchActivate: ReturnType<typeof useBatchActivate>
  // 激活/归档/清除反馈
  activateMsg: string | null
  setActivateMsg: (msg: string | null) => void
  detailFetching: boolean
  batchErrors: ImportErrorRow[]
  activating: boolean
  archiving: boolean
  purging: boolean
  // 批次差异对比（ImportCompareDialog 发起入口）
  setCompareSource: React.Dispatch<React.SetStateAction<ImportBatch | null>>
  // handlers（来自 useImportFlow）
  onToggleSelect: (id: string) => void
  onActivate: () => Promise<void>
  onActivateRow: (b: ImportBatch) => Promise<void>
  onBatchActivate: () => Promise<void>
  onArchive: (b: ImportBatch) => Promise<void>
  onPurge: (b: ImportBatch) => Promise<void>
}

/** 导入质量概览与批次管理区（可折叠）：统计卡/批次表格/批量激活/完整性校验/异常明细（从 import-panel.tsx 分区二原样搬迁） */
export function BatchPanel(props: BatchPanelProps) {
  const {
    canImport,
    canArchive,
    canPurgeBatch,
    qualityOpen,
    onQualityOpenChange,
    qualityStats,
    recentBatches,
    selectedBatch,
    selectedBatchId,
    setSelectedBatchId,
    selectedCount,
    selectableIds,
    selectedBatchIds,
    setSelectedBatchIds,
    batchActivate,
    activateMsg,
    setActivateMsg,
    detailFetching,
    batchErrors,
    activating,
    archiving,
    purging,
    setCompareSource,
    onToggleSelect,
    onActivate,
    onActivateRow,
    onBatchActivate,
    onArchive,
    onPurge,
  } = props

  // 批次管理表列（带权限门禁的行操作）
  const batchColumns: DataTableColumn<ImportBatch>[] = useMemo(() => {
    const cols: DataTableColumn<ImportBatch>[] = []
    // 多选列（仅 draft 可勾选，供批量激活；无导入权限不展示）
    if (canImport) {
      cols.push({
        key: 'select',
        header: (
          <Checkbox
            aria-label="全选批次"
            checked={selectedCount > 0 ? (selectedCount === selectableIds.length ? true : 'indeterminate') : false}
            disabled={selectableIds.length === 0 || batchActivate.isBusy}
            onCheckedChange={(checked) => setSelectedBatchIds(checked === true ? new Set(selectableIds) : new Set())}
          />
        ),
        align: 'center',
        render: (b) => (
          <Checkbox
            aria-label={`选择批次 ${b.filename}`}
            checked={selectedBatchIds.has(b.id)}
            disabled={b.status !== 'draft' || batchActivate.isBusy}
            onCheckedChange={() => onToggleSelect(b.id)}
          />
        ),
      })
    }
    cols.push(
      { key: 'filename', header: '文件名', cellClassName: 'font-medium' },
      { key: 'templateType', header: '模板类型', render: (b) => templateTypeLabel[b.templateType] ?? b.templateType },
      {
        key: 'status', header: '状态',
        render: (b) => (
          <Badge variant={b.status === 'active' ? 'success' : b.status === 'draft' ? 'default' : 'secondary'}>
            {batchStatusLabel[b.status] ?? b.status}
          </Badge>
        ),
      },
      { key: 'detailCount', header: '入库明细', align: 'right', cellClassName: 'font-num', render: (b) => b.detailCount ?? b.rowCount ?? b.successCount + b.errorCount },
      {
        key: 'quality', header: '成功/异常', align: 'right', cellClassName: 'font-num',
        render: (b) => (
          <span>
            <span className="text-success-strong">{b.successCount}</span>
            {' / '}
            <span className={b.errorCount > 0 ? 'text-destructive' : 'text-muted-foreground'}>{b.errorCount}</span>
          </span>
        ),
      },
      { key: 'createdAt', header: '导入时间', render: (b) => new Date(b.createdAt).toLocaleString('zh-CN') },
    )
    if (canImport || canArchive || canPurgeBatch) {
      cols.push({
        key: 'actions', header: '操作', align: 'right',
        render: (b) => (
          <div className="flex items-center justify-end gap-1">
            {(b.templateType === 'operating' || b.templateType === 'static' || b.templateType === 'budget') && (
              <Button variant="ghost" size="sm" title="差异对比" onClick={() => setCompareSource(b)}>
                <GitCompareArrows className="h-4 w-4" />
              </Button>
            )}
            {canImport && b.status !== 'active' && b.status !== 'purged' && (
              <Button variant="ghost" size="sm" title="激活生效" disabled={activating || batchActivate.isBusy} onClick={() => onActivateRow(b)}>
                <CheckCircle className="h-4 w-4" />
              </Button>
            )}
            {canArchive && (b.status === 'active' || b.status === 'draft') && (
              <Button variant="ghost" size="sm" title="归档" disabled={archiving} onClick={() => onArchive(b)}>
                <Archive className="h-4 w-4" />
              </Button>
            )}
            {canPurgeBatch && (b.status === 'archived' || b.status === 'draft') && (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" title="清除数据（不可恢复）" disabled={purging} onClick={() => onPurge(b)}>
                <ShieldAlert className="h-4 w-4" />
              </Button>
            )}
          </div>
        ),
      })
    }
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canImport, canArchive, canPurgeBatch, activating, archiving, purging, selectedBatchIds, selectableIds, selectedCount, batchActivate.isBusy])

  return (
    <>
      {/* 分区二：导入质量概览 + 完整性验证 + 异常明细（可折叠） */}
      <Collapsible
        open={qualityOpen}
        onOpenChange={onQualityOpenChange}
        trigger={(open) => (
          <span className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
            <span className="flex items-center text-base font-semibold leading-none tracking-tight">
              <AlertTriangle className="mr-2 h-5 w-5" />
              导入质量概览
            </span>
            <span className="flex items-center gap-3 text-muted-foreground">
              {/* 收起态摘要：关键质量数字一瞥（异常 > 0 红色强调） */}
              {!open && (
                <span className="font-num text-sm">
                  {qualityStats.batchCount} 批次 · {qualityStats.totalRows} 条 ·{' '}
                  <span className={cn(qualityStats.errorRows > 0 && 'font-medium text-destructive')}>
                    异常 {qualityStats.errorRows}
                  </span>
                </span>
              )}
              <span className="flex items-center gap-1 text-xs">
                {open ? '收起' : '展开'}
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
            </span>
          </span>
        )}
      >
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-muted/30 p-2">
              <p className="text-xs text-muted-foreground">导入批次</p>
              <p className="mt-1 text-xl font-semibold">{qualityStats.batchCount}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-2">
              <p className="text-xs text-muted-foreground">总记录数</p>
              <p className="mt-1 text-xl font-semibold">{qualityStats.totalRows}</p>
            </div>
            <div className="rounded-lg border border-success/25 bg-success/10 p-2">
              <p className="text-xs text-success-strong">入库记录</p>
              <p className="mt-1 text-xl font-semibold text-success-strong">{qualityStats.successRows}</p>
            </div>
            <div className={cn('rounded-lg border p-2', qualityStats.errorRows > 0 ? 'border-destructive/25 bg-destructive/[0.06]' : 'bg-muted/30')}>
              <p className={cn('text-xs', qualityStats.errorRows > 0 ? 'text-destructive' : 'text-muted-foreground')}>异常记录</p>
              <p className={cn('mt-1 text-xl font-semibold', qualityStats.errorRows > 0 && 'text-destructive')}>{qualityStats.errorRows}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">批次管理</p>
            <span className="text-xs text-muted-foreground">点击批次行查看质量明细{canImport && selectedBatch && selectedBatch.status !== 'active' ? '，可直接激活' : ''}</span>
            {canImport && selectedBatch && selectedBatch.status !== 'active' && (
              <Button size="sm" className="shrink-0" onClick={onActivate} disabled={activating}>
                {activating ? '激活中...' : '激活批次'}
              </Button>
            )}
            {canImport && selectedBatch && selectedBatch.status === 'active' && (
              <span className="text-xs text-success-strong">当前批次已生效</span>
            )}
            {canImport && selectedCount > 0 && (
              <Button size="sm" className="shrink-0" disabled={batchActivate.isBusy || activating} onClick={onBatchActivate}>
                {batchActivate.isBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}
                批量激活（{selectedCount}）
              </Button>
            )}
            {batchActivate.progress && (
              <span className="text-xs text-muted-foreground">
                正在激活 {batchActivate.progress.done}/{batchActivate.progress.total}：{batchActivate.progress.currentFilename || '-'}
              </span>
            )}
            {!batchActivate.isBusy && batchActivate.results.size > 0 && (
              <span className="text-xs text-muted-foreground">
                完成：成功 {[...batchActivate.results.values()].filter((r) => r.status === 'success').length} 个，失败 {[...batchActivate.results.values()].filter((r) => r.status === 'failed').length} 个
              </span>
            )}
          </div>
          {activateMsg && <p className="text-xs text-muted-foreground">{activateMsg}</p>}

          <DataTable
            columns={batchColumns}
            data={recentBatches}
            rowKey={(b) => b.id}
            dense
            maxHeight="320px"
            emptyText="暂无导入批次"
            onRowClick={(b) => { setSelectedBatchId((prev) => (prev === b.id ? null : b.id)); setActivateMsg(null) }}
            rowClassName={(b) => (b.id === selectedBatchId ? 'bg-muted/60' : undefined)}
          />
          {/* 批量激活失败明细（成功项随列表刷新消失，失败项保留展示原因） */}
          {!batchActivate.isBusy && [...batchActivate.results.entries()].some(([, r]) => r.status === 'failed') && (
            <ul className="space-y-0.5 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-2 text-xs text-destructive">
              {[...batchActivate.results.entries()].filter(([, r]) => r.status === 'failed').map(([id, r]) => (
                <li key={id}>{recentBatches.find((b) => b.id === id)?.filename ?? id}：{r.error}</li>
              ))}
            </ul>
          )}

          {selectedBatch && (
            selectedBatch.errorCount === 0 ? (
              <div className="flex items-center space-x-2 rounded-lg border border-success/25 bg-success/10 p-4">
                <CheckCircle className="h-4 w-4 text-success" />
                <span className="text-sm font-medium text-success-strong">
                  完整性校验通过：共 {selectedBatch.detailCount ?? selectedBatch.rowCount ?? selectedBatch.successCount} 条明细均解析成功。
                </span>
              </div>
            ) : selectedBatch.successCount > 0 ? (
              <div className="flex items-center space-x-2 rounded-lg border border-warning/30 bg-warning/[0.08] p-4">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <span className="text-sm font-medium text-warning-strong">
                  共 {selectedBatch.rowCount ?? selectedBatch.successCount + selectedBatch.errorCount} 行，成功 {selectedBatch.successCount} 行，异常 {selectedBatch.errorCount} 条，请核对下方异常明细。
                </span>
              </div>
            ) : (
              <div className="flex items-center space-x-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-4">
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="text-sm font-medium text-destructive">
                  全部 {selectedBatch.errorCount} 条解析失败，请检查文件内容与模板类型。
                </span>
              </div>
            )
          )}

          {selectedBatchId && (
            <div className={cn('transition-opacity duration-200', detailFetching && 'opacity-60')}>
              <DataTable
                columns={errorColumns}
                data={batchErrors}
                rowKey={(e, i) => `${e.row}-${e.column}-${i}`}
                dense
                maxHeight="280px"
                emptyText={detailFetching ? '加载中…' : '该批次无解析异常'}
              />
            </div>
          )}
        </CardContent>
      </Collapsible>
    </>
  )
}
