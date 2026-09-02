import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  FileText, CheckCircle2, Archive, Search, Plus, Pencil, MoreHorizontal, Trash2, Download, Loader2, RefreshCw, FileDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { FlashMessage } from '@/components/ui/flash-message'
import { MonthPicker } from '@/components/ui/month-picker'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Pagination } from '@/components/data-table/pagination'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { usePermission } from '@/hooks/usePermission'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import {
  useReports, useCreateReport, useUpdateReport, useDeleteReport,
  useCompanies, useAvailablePeriods,
} from '@/hooks/api-queries'
import { REPORT_STATUS_LABEL, REPORT_STATUS_BADGE_VARIANT } from '@/lib/constants'
import { api } from '@/lib/api'
import { exportReportToDocx, exportReportToPdf } from '@/lib/report-export'
import type { ReportListItem } from '@/hooks/api-queries'
import { cn } from '@/lib/utils'

/**
 * 分析报告中心：汇总报告列表（状态筛选 / 关键词 / 分页）+ 新建 / 重命名 / 状态流转 / 删除 / 导出。
 * 数据层 useReports/useCreateReport/useUpdateReport/useDeleteReport；编辑器跳转 /reports/:reportId/edit。
 */

type StatusFilter = '' | 'draft' | 'published' | 'archived'

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: '', label: '全部报告' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'archived', label: '已归档' },
]

/** 状态流转下一态（状态机：draft↔published、draft/published→archived、archived→draft） */
const NEXT_STATUS: Record<string, { status: string; label: string }> = {
  draft: { status: 'published', label: '发布' },
  published: { status: 'archived', label: '归档' },
  archived: { status: 'draft', label: '恢复为草稿' },
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
      title="分析报告中心"
      description="汇总报告按周期编制单项分析生成，支持多版本管理与 Word / PDF 导出"
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

  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)

  const { data, isLoading, isError, error, refetch } = useReports({
    page,
    pageSize,
    status: status || undefined,
    keyword: keyword.trim() || undefined,
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

  const handleStatusChange = async (report: ReportListItem) => {
    const next = NEXT_STATUS[report.status]
    if (!next) return
    try {
      await updateReport.mutateAsync({ id: report.id, data: { status: next.status } })
      flash(`已${next.label}`)
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
      <Card ref={filterRef} className="sticky z-10 rounded-card p-3.5" style={{ top: stickyTop }}>
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
      <Card className="rounded-card">
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
                  onEdit={() => navigate(`/reports/${r.id}/edit`)}
                  onRename={() => setRenaming(r)}
                  onStatusChange={() => handleStatusChange(r)}
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
      </Card>

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
  onStatusChange: () => void
  onDelete: () => void
  onExport: (format: 'docx' | 'pdf') => void
}) {
  const { getDisplayName } = useCompanyDisplayName()
  const nextStatus = NEXT_STATUS[item.status]
  const scopeName = getDisplayName(item.companyScope.code, item.companyScope.name ?? item.companyScope.code)
  const scopeTypeLabel = item.companyScope.type === 'summary' ? '汇总主体' : '单体公司'

  return (
    <div className="group flex flex-col rounded-lg border border-border bg-card p-5 transition-all hover:border-primary hover:shadow-[0_4px_12px_rgba(22,119,255,0.08)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <StatusIcon status={item.status} />
        <StatusTag status={item.status} />
      </div>
      <h3 className="mb-1.5 line-clamp-2 text-[15px] font-semibold leading-snug text-foreground" title={item.title}>{item.title}</h3>
      <p className="line-clamp-1 text-xs leading-relaxed text-muted-foreground" title={`${scopeTypeLabel} · ${scopeName}`}>
        {scopeTypeLabel} · {scopeName}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>财年 {item.fiscalYear}</span>
        <span>期间 {item.period}</span>
        <span>v{item.currentVersion}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <span>更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="fused" className="h-7 flex-1 px-2 text-xs" onClick={onEdit}>
          <Pencil className="mr-1 h-3.5 w-3.5" /> 编辑
        </Button>
        {canUpdate && nextStatus && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={statusUpdating} onClick={onStatusChange}>
            {statusUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : nextStatus.label}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="更多操作" className="h-7 w-7 px-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canUpdate && (
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="mr-2 h-4 w-4" /> 重命名
              </DropdownMenuItem>
            )}
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
    </div>
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
    <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px]', className)}>
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

/** 新建报告：标题 + 期间（财年自动取期间年份）+ 报告主体（单体/汇总） */
function CreateReportDialog({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (title: string) => void
}) {
  const { can } = usePermission()
  const canCreate = can('reports', 'create')
  const createReport = useCreateReport()
  const { data: companies } = useCompanies()
  const { data: periodsData } = useAvailablePeriods()
  const periods = useMemo(() => [...(periodsData?.periods ?? [])].sort((a, b) => b.localeCompare(a)), [periodsData])

  const [title, setTitle] = useState('')
  const [period, setPeriod] = useState('')
  const [scopeType, setScopeType] = useState<'company' | 'summary'>('company')
  const [scopeCode, setScopeCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const resetRef = useRef(0)

  const scopeCompanies = useMemo(
    () => (companies ?? []).filter((c) => c.type === scopeType),
    [companies, scopeType],
  )
  const fiscalYear = period ? period.slice(0, 4) : ''
  const canSubmit = canCreate && title.trim() && period && scopeCode

  // 打开时重置表单（open 翻转沿触发）
  useEffect(() => {
    if (open) {
      resetRef.current += 1
      setTitle('')
      setPeriod('')
      setScopeType('company')
      setScopeCode('')
      setError(null)
    }
  }, [open])

  const handleSubmit = async () => {
    if (!canSubmit) return
    setError(null)
    try {
      await createReport.mutateAsync({
        title: title.trim(),
        fiscalYear,
        period,
        companyScope: { type: scopeType, code: scopeCode },
      })
      onCreated(title.trim())
    } catch (e) {
      setError((e as Error).message || '创建失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建报告</DialogTitle>
          <DialogDescription>选择报告主体与期间；章节依据该主体范围下的单项分析生成（实时引用）。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-title">报告标题</Label>
            <Input id="report-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：2026 年 8 月经营分析报告" />
          </div>
          <div className="space-y-1.5">
            <Label>报告期间</Label>
            <MonthPicker
              key={resetRef.current}
              value={period}
              onChange={setPeriod}
              availablePeriods={periods}
              allowedPeriods={periods}
              placeholder="选择期间"
              className="w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label>报告主体</Label>
            <div className="flex items-center gap-2">
              <Select value={scopeType} onValueChange={(v) => { setScopeType(v as 'company' | 'summary'); setScopeCode('') }}>
                <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">单体公司</SelectItem>
                  <SelectItem value="summary">汇总主体</SelectItem>
                </SelectContent>
              </Select>
              <Select value={scopeCode} onValueChange={setScopeCode}>
                <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="选择主体" /></SelectTrigger>
                <SelectContent>
                  {scopeCompanies.length === 0 ? (
                    <SelectItem value="__none" disabled>暂无可选主体</SelectItem>
                  ) : (
                    scopeCompanies.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          {period && (
            <p className="text-caption text-muted-foreground">财年：{fiscalYear}（自动取期间年份）</p>
          )}
          {error && <FlashMessage type="error">{error}</FlashMessage>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={createReport.isPending}>取消</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || createReport.isPending}>
            {createReport.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} 创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [title, setTitle] = useState('')
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (report && report.id !== loadedId) {
    setLoadedId(report.id)
    setTitle(report.title)
    setError(null)
  }

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

  return (
    <Dialog open={!!report} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>重命名报告</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="报告标题" />
          {error && <FlashMessage type="error">{error}</FlashMessage>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateReport.isPending}>取消</Button>
          <Button onClick={handleSave} disabled={!canUpdate || updateReport.isPending || !title.trim() || title.trim() === report?.title}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
