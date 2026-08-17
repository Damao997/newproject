import { useEffect, useMemo, useState, type Ref } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { CompanySelect } from '@/components/filters/company-select'
import { MonthPicker } from '@/components/ui/month-picker'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { Pagination } from '@/components/data-table/pagination'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { PAGINATION, REPORT_STATUS_LABEL, REPORT_STATUS_BADGE_VARIANT } from '@/lib/constants'
import { useReports, useCreateReport, useDeleteReport, useCompanies, useAvailablePeriods } from '@/hooks/api-queries'
import { usePermission } from '@/hooks/usePermission'
import { Plus, FileText, Trash2, ExternalLink, Search } from 'lucide-react'

/** 列表状态 Tab：空串=进行中（后端默认排除归档） */
const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: '进行中' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'archived', label: '已归档' },
  { value: 'all', label: '全部' },
]

/**
 * 分析报告 · 汇总报告：报告列表（状态 Tab/搜索/分页）+ 新建入口。
 * 报告编辑器为独立三级路由 /reports/:reportId/edit。
 */
export default function ReportsPage() {
  const { can } = usePermission()
  const canCreate = can('reports', 'create')
  const canDelete = can('reports', 'delete')
  const navigate = useNavigate()
  // 吸顶测量：标题区 + 筛选卡高度实时测量，驱动筛选卡/表格容器吸顶偏移
  const { headerRef, filterRef, headerHeight, filterHeight } = useStickyHeader()
  const stickyTop = headerHeight + filterHeight
  const [searchParams] = useSearchParams()

  // 旧 ?tab=analyses URL 兼容：重定向到独立三级路径 /reports/analyses
  useEffect(() => {
    if (searchParams.get('tab') === 'analyses') {
      navigate('/reports/analyses', { replace: true })
    }
  }, [searchParams, navigate])

  const [createOpen, setCreateOpen] = useState(false)

  return (
    <PageContainer
      title="分析报告"
      description="汇总各公司/汇总主体的单项分析，编制总体分析报告"
      stickyHeader
      headerRef={headerRef}
    >
      <ReportList
        onOpen={(id) => navigate(`/reports/${id}/edit`)}
        canCreate={canCreate}
        onCreate={() => setCreateOpen(true)}
        canDelete={canDelete}
        filterRef={filterRef}
        headerHeight={headerHeight}
        stickyTop={stickyTop}
      />
      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => navigate(`/reports/${id}/edit`)} />
    </PageContainer>
  )
}

function ReportList({ onOpen, canCreate, onCreate, canDelete, filterRef, headerHeight, stickyTop }: {
  onOpen: (id: string) => void
  canCreate: boolean
  onCreate: () => void
  canDelete: boolean
  filterRef: Ref<HTMLDivElement>
  headerHeight: number
  stickyTop: number
}) {
  const [status, setStatus] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGINATION.DEFAULT_PAGE_SIZE)
  const { data, isLoading } = useReports({ page, pageSize, status: status || undefined, keyword: keyword.trim() || undefined })
  const deleteReport = useDeleteReport()
  const { confirm, element: confirmElement } = useConfirm()
  const items = data?.items ?? []
  const total = data?.total ?? 0

  const handleDelete = async (id: string, title: string) => {
    const ok = await confirm({
      title: '归档报告',
      description: `确认归档报告「${title}」？归档后不再出现在进行中列表，可从「已归档」中恢复为草稿。`,
      confirmText: '归档',
      danger: true,
    })
    if (!ok) return
    await deleteReport.mutateAsync(id)
  }

  // 报告列表列（操作列带权限门禁）
  const reportColumns: DataTableColumn<(typeof items)[number]>[] = useMemo(() => [
    { key: 'title', header: '报告标题', cellClassName: 'font-medium text-foreground' },
    {
      key: 'companyScope', header: '主体', align: 'center', cellClassName: 'text-muted-foreground',
      render: (r) => (
        <>
          {r.companyScope.name ?? r.companyScope.code}
          <span className="ml-1 text-[11px]">({r.companyScope.type === 'summary' ? '汇总' : '公司'})</span>
        </>
      ),
    },
    { key: 'period', header: '期间', align: 'center', cellClassName: 'font-mono text-muted-foreground' },
    {
      key: 'status', header: '状态', align: 'center',
      render: (r) => <Badge variant={REPORT_STATUS_BADGE_VARIANT[r.status] ?? 'secondary'}>{REPORT_STATUS_LABEL[r.status] ?? r.status}</Badge>,
    },
    { key: 'currentVersion', header: '版本', align: 'center', cellClassName: 'font-mono text-muted-foreground', render: (r) => `v${r.currentVersion}` },
    { key: 'updatedAt', header: '更新时间', align: 'center', cellClassName: 'text-muted-foreground', render: (r) => new Date(r.updatedAt).toLocaleDateString('zh-CN') },
    {
      key: 'actions', header: '操作', align: 'center',
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onOpen(r.id)}><ExternalLink className="mr-1 h-3.5 w-3.5" /> 打开</Button>
          {canDelete && r.status !== 'archived' && (
            <Button variant="ghost" size="sm" aria-label="删除报告" onClick={() => handleDelete(r.id, r.title)} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
          )}
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleDelete 为组件内闭包，重算代价可忽略
  ], [onOpen, canDelete, handleDelete])

  return (
    <>
      {/* 控制层：筛选工具条（状态 Tab + 搜索，筛选卡，吸顶） */}
      <Card ref={filterRef} className="sticky z-10 rounded-card p-4" style={{ top: headerHeight }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
          <TabsList variant="line">
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button size="sm" onClick={onCreate}><Plus className="mr-2 h-4 w-4" /> 新建报告</Button>
          )}
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
              placeholder="按标题搜索…"
              className="h-8 pl-8"
            />
          </div>
        </div>
      </div>
      </Card>

      {/* 展示层：报告列表（表格卡，表格容器吸顶） */}
      <Card className="animate-fade-in rounded-card border border-border">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {keyword.trim() ? '未找到匹配的报告。' : '暂无分析报告，点击「新建报告」开始编制。'}
            </p>
          </div>
        ) : (
          <div className="sticky rounded-card bg-background" style={{ top: stickyTop }}>
            <DataTable
              columns={reportColumns}
              data={items}
              rowKey={(r) => r.id}
              density="dense"
              caption="分析报告列表"
              maxHeight={`calc(100dvh - ${stickyTop}px - 24px)`}
            />
          </div>
        )}

        {/* 分页 */}
        {total > 0 && (
          <div className="border-t px-4 py-2.5">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              summary={`共 ${total} 份报告`}
            />
          </div>
        )}
        {confirmElement}
      </Card>
    </>
  )
}

function CreateReportDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const { data: companies } = useCompanies()
  const { data: periodsData } = useAvailablePeriods()
  const createReport = useCreateReport()
  const [title, setTitle] = useState('')
  const [fiscalYear, setFiscalYear] = useState('')
  const [period, setPeriod] = useState('')
  const [scopeCode, setScopeCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 期间/财年候选由已导入数据动态派生（最新在前），默认选最新
  const periods = useMemo(() => [...(periodsData?.periods ?? [])].sort((a, b) => b.localeCompare(a)), [periodsData])
  const fiscalYears = periodsData?.fiscalYears ?? []
  const effectivePeriod = period || periods[0] || ''
  const effectiveFiscalYear = fiscalYear || fiscalYears[0] || ''

  const summaryEntities = useMemo(() => (companies ?? []).filter((c) => c.type === 'summary'), [companies])

  const handleCreate = async () => {
    setError(null)
    if (!title.trim() || !scopeCode) {
      setError('请填写标题并选择主体')
      return
    }
    if (!effectiveFiscalYear || !effectivePeriod) {
      setError('暂无可用期间，请先导入经营数据')
      return
    }
    try {
      const scopeType = summaryEntities.some((c) => c.code === scopeCode) ? 'summary' : 'company'
      const report = await createReport.mutateAsync({ title: title.trim(), fiscalYear: effectiveFiscalYear, period: effectivePeriod, companyScope: { type: scopeType, code: scopeCode } })
      onOpenChange(false)
      setTitle('')
      setScopeCode('')
      onCreated(report.id)
    } catch (e) {
      setError((e as Error).message || '创建失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建分析报告</DialogTitle>
          <DialogDescription>选择公司或汇总主体，随后可拉取其名下单项分析编制总体报告。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-title">报告标题</Label>
            <Input id="report-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：2025年6月经营分析报告" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="report-fiscal-year">财年</Label>
              <Select value={effectiveFiscalYear} onValueChange={setFiscalYear}>
                <SelectTrigger id="report-fiscal-year"><SelectValue placeholder="选择财年" /></SelectTrigger>
                <SelectContent>
                  {fiscalYears.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-period">期间</Label>
              <MonthPicker
                id="report-period"
                className="w-full"
                value={effectivePeriod}
                onChange={setPeriod}
                availablePeriods={periods}
                allowedPeriods={periods}
                placeholder="选择期间"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-scope">主体范围</Label>
            <CompanySelect id="report-scope" value={scopeCode} onChange={setScopeCode} allowAll={false} placeholder="选择公司或汇总主体" className="w-full" />
          </div>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleCreate} disabled={createReport.isPending}>创建并编辑</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
