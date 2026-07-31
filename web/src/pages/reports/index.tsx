import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { PageContainer } from '@/components/layout/page-container'
import { Pagination } from '@/components/data-table/pagination'
import { PAGINATION } from '@/lib/constants'
import { ReportEditor } from './report-editor'
import { AnalysisManager } from './analysis-list'
import { useReports, useCreateReport, useDeleteReport, useCompanies, useAvailablePeriods } from '@/hooks/api-queries'
import { usePermission } from '@/hooks/usePermission'
import { Plus, FileText, Trash2, ExternalLink, Search } from 'lucide-react'

/** 状态徽标 */
const STATUS_LABEL: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' }
const STATUS_VARIANT: Record<string, 'secondary' | 'default' | 'outline'> = { draft: 'secondary', published: 'default', archived: 'outline' }

/** 列表状态 Tab：空串=进行中（后端默认排除归档） */
const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: '进行中' },
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'archived', label: '已归档' },
  { value: 'all', label: '全部' },
]

export default function ReportsPage() {
  const { can } = usePermission()
  const canCreate = can('reports', 'create')
  const canDelete = can('reports', 'delete')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  // tab 支持 URL 参数直达（?tab=analyses 定位到「单项分析」），便于其他页跳转查看
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<'reports' | 'analyses'>(searchParams.get('tab') === 'analyses' ? 'analyses' : 'reports')

  if (selectedId) {
    return (
      <PageContainer title="分析报告" description="按公司或汇总主体编制的总体分析报告">
        <ReportEditor reportId={selectedId} onBack={() => setSelectedId(null)} />
      </PageContainer>
    )
  }

  return (
    <PageContainer
      title="分析报告"
      description="汇总各公司/汇总主体的单项分析，编制总体分析报告"
      actions={tab === 'reports' && canCreate ? (
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" /> 新建报告</Button>
      ) : null}
    >
      <Tabs value={tab} onValueChange={(v) => { const t = v as 'reports' | 'analyses'; setTab(t); setSearchParams(t === 'analyses' ? { tab: 'analyses' } : {}, { replace: true }) }} className="mb-3">
        <TabsList>
          <TabsTrigger value="reports">汇总报告</TabsTrigger>
          <TabsTrigger value="analyses">单项分析</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'reports' ? (
        <ReportList onOpen={setSelectedId} canDelete={canDelete} />
      ) : (
        <AnalysisManager />
      )}
      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => setSelectedId(id)} />
    </PageContainer>
  )
}

function ReportList({ onOpen, canDelete }: { onOpen: (id: string) => void; canDelete: boolean }) {
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

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-0">
        {/* 筛选工具条 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
            <TabsList>
              {STATUS_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
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

        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {keyword.trim() ? '未找到匹配的报告。' : '暂无分析报告，点击右上角「新建报告」开始编制。'}
            </p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/50 text-black">
                <th className="h-11 px-4 text-center font-medium">报告标题</th>
                <th className="h-11 px-4 text-center font-medium">主体</th>
                <th className="h-11 px-4 text-center font-medium">期间</th>
                <th className="h-11 px-4 text-center font-medium">状态</th>
                <th className="h-11 px-4 text-center font-medium">版本</th>
                <th className="h-11 px-4 text-center font-medium">更新时间</th>
                <th className="h-11 px-4 text-center font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b transition-colors hover:bg-muted/50">
                  <td className="px-4 py-2.5 text-left font-medium text-foreground">{r.title}</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground">
                    {r.companyScope.name ?? r.companyScope.code}
                    <span className="ml-1 text-[11px]">({r.companyScope.type === 'summary' ? '汇总' : '公司'})</span>
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono text-muted-foreground">{r.period}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono text-muted-foreground">v{r.currentVersion}</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground">{new Date(r.updatedAt).toLocaleDateString('zh-CN')}</td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => onOpen(r.id)}><ExternalLink className="mr-1 h-3.5 w-3.5" /> 打开</Button>
                      {canDelete && r.status !== 'archived' && (
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(r.id, r.title)} className="text-finance-red"><Trash2 className="h-3.5 w-3.5" /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
      </CardContent>
    </Card>
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

  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
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
            <Label>报告标题</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：2025年6月经营分析报告" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>财年</Label>
              <Select value={effectiveFiscalYear} onValueChange={setFiscalYear}>
                <SelectTrigger><SelectValue placeholder="选择财年" /></SelectTrigger>
                <SelectContent>
                  {fiscalYears.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>期间</Label>
              <Select value={effectivePeriod} onValueChange={setPeriod}>
                <SelectTrigger><SelectValue placeholder="选择期间" /></SelectTrigger>
                <SelectContent>
                  {periods.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>主体范围</Label>
            <Select value={scopeCode} onValueChange={setScopeCode}>
              <SelectTrigger><SelectValue placeholder="选择公司或汇总主体" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>公司</SelectLabel>
                  {entityCompanies.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>汇总主体</SelectLabel>
                  {summaryEntities.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-[13px] text-finance-red">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleCreate} disabled={createReport.isPending}>创建并编辑</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
