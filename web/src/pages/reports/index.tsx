import { useRetainedState } from '@/hooks/use-retained-state'
import { useFormModel, useFormValue, ModelFormFields } from '@/components/forms/form-model'
import { useFormClose } from '@/components/forms/form-navigation'
import { useEffect, useState, type Ref } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  FileText, CheckCircle2, Archive, Search, Plus, Pencil, MoreHorizontal, Trash2, Download, Loader2, RefreshCw, FileDown, BookOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { FlashMessage } from '@/components/ui/flash-message'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogBody, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Pagination } from '@/components/data-table/pagination'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { REPORTS_TABS } from '@/components/layout/module-tabs'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { usePermission } from '@/hooks/usePermission'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import {
  useReports, useUpdateReport, useDeleteReport,
} from '@/hooks/api-queries'
import { REPORT_STATUS_LABEL, REPORT_STATUS_BADGE_VARIANT } from '@/lib/constants'
import { CreateReportDialog } from './create-report-form'
import { api } from '@/lib/api'
import { exportReportToDocx, exportReportToPdf } from '@/lib/report-export'
import type { ReportListItem } from '@/hooks/api-queries'
import { cn } from '@/lib/utils'

/**
 * 分析报告中心：汇总报告列表（状态筛选 / 关键词 / 分页）+ 新建 / 重命名 / 状态流转 / 删除 / 导出。
 * 数据层 useReports/useCreateReport/useUpdateReport/useDeleteReport；编辑器跳转 /reports/:reportId/edit。
 */

type StatusFilter = '' | 'draft' | 'published' | 'archived'
type SortOption = 'updatedAt-desc' | 'updatedAt-asc' | 'title-asc' | 'title-desc' | 'currentVersion-desc' | 'currentVersion-asc'

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: '', label: '全部报告' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'archived', label: '已归档' },
]

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'updatedAt-desc', label: '最近更新' },
  { value: 'updatedAt-asc', label: '最早更新' },
  { value: 'title-asc', label: '标题 A→Z' },
  { value: 'title-desc', label: '标题 Z→A' },
  { value: 'currentVersion-desc', label: '版本号 高→低' },
  { value: 'currentVersion-asc', label: '版本号 低→高' },
]

/** 主操作（卡片按钮）：draft→发布、published→归档、archived→恢复草稿 */
const NEXT_STATUS: Record<string, { status: string; label: string }> = {
  draft: { status: 'published', label: '发布' },
  published: { status: 'archived', label: '归档' },
  archived: { status: 'draft', label: '恢复为草稿' },
}

/** 次要状态操作（更多菜单）：published 支持撤回为草稿直达（后端状态机 draft↔published 本就允许） */
const EXTRA_STATUS: Record<string, { status: string; label: string }[]> = {
  published: [{ status: 'draft', label: '撤回为草稿' }],
}

export default function ReportsPage() {
  const navigate = useNavigate()
  const { headerRef, filterRef, headerHeight } = useStickyHeader()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    if (searchParams.get('tab') === 'analyses') {
      navigate('/reports/analyses', { replace: true })
    }
  }, [searchParams, navigate])

  return (
    <PageContainer
      navigation={<SubPageTabs items={REPORTS_TABS} />}
      title="分析报告中心"
      stickyHeader
      headerRef={headerRef}
    >
      <ReportsList filterRef={filterRef} stickyTop={headerHeight} />
    </PageContainer>
  )
}

interface ReportsListProps {
  filterRef: Ref<HTMLDivElement>
  stickyTop: number
}

function ReportsList({ filterRef, stickyTop }: ReportsListProps) {
  const navigate = useNavigate()
  const { can } = usePermission()
  const canCreate = can('reports', 'create')
  const canUpdate = can('reports', 'update')
  const canDelete = can('reports', 'delete')
  const canExport = can('reports', 'export')

  const [keyword, setKeyword] = useRetainedState('reports.keyword', '')
  const [status, setStatus] = useRetainedState<StatusFilter>('reports.status', '')
  const [sortBy, setSortBy] = useRetainedState<SortOption>('reports.sort', 'updatedAt-desc')
  const [page, setPage] = useRetainedState('reports.page', 1)
  const [pageSize, setPageSize] = useRetainedState('reports.pageSize', 12)

  const [sortField, sortDirection] = sortBy.split('-') as ['updatedAt' | 'title' | 'currentVersion', 'asc' | 'desc']
  const { data, isLoading, isError, error, refetch } = useReports({
    page,
    pageSize,
    status: status || undefined,
    keyword: keyword.trim() || undefined,
    sortBy: sortField,
    sortOrder: sortDirection,
  })
  const items = data?.items ?? []
  const total = data?.total ?? 0

  const updateReport = useUpdateReport()
  const deleteReport = useDeleteReport()
  const { confirm, element: confirmElement } = useConfirm()

  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const flash = (text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ type, text })
    window.setTimeout(() => setMsg(null), 2500)
  }

  const [renaming, setRenaming] = useState<ReportListItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)

  const resetPage = () => setPage(1)

  const handleStatusChange = async (report: ReportListItem, target: { status: string; label: string }) => {
    try {
      await updateReport.mutateAsync({ id: report.id, data: { status: target.status } })
      flash(`已${target.label}`)
    } catch (e) {
      flash((e as Error).message || '状态更新失败', 'error')
    }
  }

  const handleDelete = async (report: ReportListItem) => {
    const ok = await confirm({
      title: '删除报告',
      description: `确认删除「${report.title}」？删除后不可恢复。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteReport.mutateAsync(report.id)
      flash('已删除')
    } catch (e) {
      flash((e as Error).message || '删除失败', 'error')
    }
  }

  const handleExport = async (report: ReportListItem, format: 'docx' | 'pdf') => {
    setExportingId(report.id)
    try {
      const data = await api.exportReport(report.id, format)
      if (format === 'docx') await exportReportToDocx(data)
      else await exportReportToPdf(data)
    } catch (e) {
      flash((e as Error).message || '导出失败', 'error')
    } finally {
      setExportingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* 工具栏：关键词搜索 + 状态段控 + 重置 */}
      <Card variant="filter" ref={filterRef} className="sticky z-10 rounded-card p-3.5" style={{ top: stickyTop }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-[280px] max-w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); resetPage() }}
              placeholder="搜索报告标题…"
              className="h-8 pl-8 text-sm"
            />
          </div>
          <Select value={sortBy} onValueChange={(v) => { setSortBy(v as SortOption); resetPage() }}>
            <SelectTrigger className="h-8 w-[150px] text-sm" aria-label="排序方式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="fused" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> 刷新
            </Button>
            {canCreate && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> 新建报告
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* 状态 Tabs + 报告网格 */}
      <div className="reports-content">
        <div className="px-6">
          <div className="flex items-center gap-7 overflow-x-auto border-b border-border">
            {STATUS_TABS.map((t) => {
              const active = status === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => { setStatus(t.value); resetPage() }}
                  className={cn(
                    'relative flex h-12 shrink-0 items-center gap-1 pb-3 pt-3 text-sm transition-colors',
                    active ? 'text-primary font-medium' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span>{t.label}</span>
                  {t.value === '' && total > 0 && <span className="text-xs text-muted-foreground">{total}</span>}
                  {active && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
                </button>
              )
            })}
          </div>
        </div>
        <div className="p-5 pt-5">
          {msg && <FlashMessage type={msg.type} className="mb-3">{msg.text}</FlashMessage>}

          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
          ) : isError ? (
            <EmptyState
              icon={FileText}
              title="报告列表加载失败"
              description={(error as Error)?.message}
              action={<Button variant="outline" size="sm" onClick={() => refetch()}>重试</Button>}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="暂无报告"
              description={keyword || status ? '没有匹配的报告，试试调整筛选条件。' : '点击「新建报告」创建第一份汇总报告。'}
              action={canCreate && !keyword && !status ? (
                <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" /> 新建报告</Button>
              ) : undefined}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((r) => (
                <ReportCard
                  key={r.id}
                  item={r}
                  exporting={exportingId === r.id}
                  statusUpdating={updateReport.isPending && updateReport.variables?.id === r.id}
                  canUpdate={canUpdate}
                  canDelete={canDelete}
                  canExport={canExport}
                  onEdit={() => navigate(r.status === 'draft' ? `/reports/${r.id}/edit` : `/reports/${r.id}/read`)}
                  onRename={() => setRenaming(r)}
                  onStatusChange={(target) => handleStatusChange(r, target)}
                  onDelete={() => handleDelete(r)}
                  onExport={(fmt) => handleExport(r, fmt)}
                />
              ))}
            </div>
          )}

          {/* 分页 */}
          {total > 0 && (
            <div className="mt-4 border-t pt-3">
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
                summary={`共 ${total} 份报告`}
              />
            </div>
          )}
        </div>
      </div>

      <CreateReportDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(title) => { setCreating(false); flash(`已创建「${title}」`) }}
      />

      <RenameReportDialog
        report={renaming}
        onClose={() => setRenaming(null)}
        onSaved={() => { setRenaming(null); flash('已重命名') }}
      />

      {confirmElement}
    </div>
  )
}

/** 报告卡：状态图标 + 标题 + 范围/期间元信息 + 编辑/更多操作 */
function ReportCard({
  item, exporting, statusUpdating, canUpdate, canDelete, canExport,
  onEdit, onRename, onStatusChange, onDelete, onExport,
}: {
  item: ReportListItem
  exporting: boolean
  statusUpdating: boolean
  canUpdate: boolean
  canDelete: boolean
  canExport: boolean
  onEdit: () => void
  onRename: () => void
  onStatusChange: (target: { status: string; label: string }) => void
  onDelete: () => void
  onExport: (format: 'docx' | 'pdf') => void
}) {
  const { getDisplayName } = useCompanyDisplayName()
  const nextStatus = NEXT_STATUS[item.status]
  const extraStatuses = EXTRA_STATUS[item.status] ?? []
  const scopeName = getDisplayName(item.companyScope.code, item.companyScope.name ?? item.companyScope.code)
  const scopeTypeLabel = item.companyScope.type === 'summary' ? '汇总主体' : '单体公司'

  return (
    <Card variant="report" className="report-card flex flex-col">
      <div className="mb-3 flex items-start justify-between gap-3">
        <StatusIcon status={item.status} />
        <StatusTag status={item.status} />
      </div>
      <h3 className="mb-1.5 line-clamp-2 text-lg font-semibold leading-snug text-foreground" title={item.title}>{item.title}</h3>
      <p className="line-clamp-1 text-sm leading-relaxed text-muted-foreground" title={`${scopeTypeLabel} · ${scopeName}`}>
        {scopeTypeLabel} · {scopeName}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>财年 {item.fiscalYear}</span>
        <span>期间 {item.period}</span>
        <span>v{item.currentVersion}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <span>更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div className="report-card-actions mt-auto flex items-center gap-2 pt-5">
        <Button size="sm" variant="fused" className="h-9 flex-1 px-3 text-sm" onClick={onEdit}>
          {item.status === 'draft' ? (
            <><Pencil className="mr-1 h-3.5 w-3.5" /> 编辑</>
          ) : (
            <><BookOpen className="mr-1 h-3.5 w-3.5" /> 阅读</>
          )}
        </Button>
        {canUpdate && nextStatus && (
          <Button size="sm" variant="outline" className="h-9 px-3 text-sm" disabled={statusUpdating} onClick={() => onStatusChange(nextStatus)}>
            {statusUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : nextStatus.label}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="更多操作" className="h-9 w-9 px-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canUpdate && (
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="mr-2 h-4 w-4" /> 重命名
              </DropdownMenuItem>
            )}
            {canUpdate && extraStatuses.map((t) => (
              <DropdownMenuItem key={t.status} disabled={statusUpdating} onClick={() => onStatusChange(t)}>
                <RefreshCw className="mr-2 h-4 w-4" /> {t.label}
              </DropdownMenuItem>
            ))}
            {canExport && (
              <>
                <DropdownMenuItem onClick={() => onExport('docx')} disabled={exporting}>
                  {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />} 导出 Word
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onExport('pdf')} disabled={exporting}>
                  <Download className="mr-2 h-4 w-4" /> 导出 PDF
                </DropdownMenuItem>
              </>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> 删除
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  )
}

function StatusIcon({ status }: { status: string }) {
  const styles = {
    draft: { Icon: FileText, className: 'bg-blue-1 text-blue-8' },
    published: { Icon: CheckCircle2, className: 'bg-success-50 text-success-strong' },
    archived: { Icon: Archive, className: 'bg-muted text-muted-foreground' },
  }[status] ?? { Icon: FileText, className: 'bg-blue-1 text-blue-8' }
  const { Icon, className } = styles
  return (
    <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', className)}>
      <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
    </div>
  )
}

function StatusTag({ status }: { status: string }) {
  return (
    <Badge variant={REPORT_STATUS_BADGE_VARIANT[status] ?? 'secondary'}>
      {REPORT_STATUS_LABEL[status] ?? status}
    </Badge>
  )
}

/** 重命名报告 */
function RenameReportDialog({ report, onClose, onSaved }: {
  report: ReportListItem | null
  onClose: () => void
  onSaved: () => void
}) {
  const canUpdate = usePermission().can('reports', 'update')
  const updateReport = useUpdateReport()
  const model = useFormModel({title: ('') as string}, {"title":"请输入报告标题"})
  const [title, setTitle] = useFormValue(model, "title")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { model.form.reset({ title: report?.title ?? '' }); setError(null) }, [report?.id, model.form])

  const handleSave = async () => {
    if (!report || !title.trim()) return
    setError(null)
    try {
      await updateReport.mutateAsync({ id: report.id, data: { title: title.trim() } })
      onSaved()
    } catch (e) {
      setError((e as Error).message || '重命名失败')
    }
  }

  const formClose = useFormClose({ dirty: model.form.formState.isDirty, busy: model.pending || updateReport.isPending, enabled: !!report, onClose: onClose })

  return (
    <><Dialog open={!!report} busy={model.pending || updateReport.isPending} onOpenChange={(next) => { if (!next) formClose.requestClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>重命名报告</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4"><ModelFormFields model={model}>
          <div className="space-y-3">
            <label htmlFor="report-rename" className="block text-sm font-medium">报告标题</label>
            <Input id="report-rename" name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="报告标题" />
            {error && <FlashMessage type="error">{error}</FlashMessage>}
          </div>
        </ModelFormFields></DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={formClose.requestClose} disabled={updateReport.isPending}>取消</Button>
          <Button onClick={model.submit(handleSave)} disabled={!canUpdate || updateReport.isPending || !title.trim() || title.trim() === report?.title}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>{formClose.element}</>
  )
}
