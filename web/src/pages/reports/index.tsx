import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { PageContainer } from '@/components/layout/page-container'
import { ReportEditor } from './report-editor'
import { useReports, useCreateReport, useDeleteReport, useCompanies } from '@/hooks/api-queries'
import { usePermission } from '@/hooks/usePermission'
import { Plus, FileText, Trash2, ExternalLink } from 'lucide-react'

/** 状态徽标 */
const STATUS_LABEL: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' }
const STATUS_VARIANT: Record<string, 'secondary' | 'default' | 'outline'> = { draft: 'secondary', published: 'default', archived: 'outline' }

const periods = ['2025-06', '2025-05', '2025-04', '2025-03', '2025-02', '2025-01']

export default function ReportsPage() {
  const { can } = usePermission()
  const canCreate = can('reports', 'create')
  const canDelete = can('reports', 'delete')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

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
      actions={canCreate ? (
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" /> 新建报告</Button>
      ) : null}
    >
      <ReportList onOpen={setSelectedId} canDelete={canDelete} />
      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => setSelectedId(id)} />
    </PageContainer>
  )
}

function ReportList({ onOpen, canDelete }: { onOpen: (id: string) => void; canDelete: boolean }) {
  const { data, isLoading } = useReports({ page: 1, pageSize: 50 })
  const deleteReport = useDeleteReport()
  const items = data?.items ?? []

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`确认归档报告「${title}」？`)) return
    await deleteReport.mutateAsync(id)
  }

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">暂无分析报告，点击右上角「新建报告」开始编制。</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/50 text-black">
                <th className="h-11 px-4 text-left font-medium">报告标题</th>
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
      </CardContent>
    </Card>
  )
}

function CreateReportDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const { data: companies } = useCompanies()
  const createReport = useCreateReport()
  const [title, setTitle] = useState('')
  const [fiscalYear, setFiscalYear] = useState('2025')
  const [period, setPeriod] = useState('2025-06')
  const [scopeCode, setScopeCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  const summaryEntities = useMemo(() => (companies ?? []).filter((c) => c.type === 'summary'), [companies])

  const handleCreate = async () => {
    setError(null)
    if (!title.trim() || !scopeCode) {
      setError('请填写标题并选择主体')
      return
    }
    try {
      const scopeType = summaryEntities.some((c) => c.code === scopeCode) ? 'summary' : 'company'
      const report = await createReport.mutateAsync({ title: title.trim(), fiscalYear, period, companyScope: { type: scopeType, code: scopeCode } })
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
          <DialogDescription>选择公司或汇总主体（ET），随后可拉取其名下单项分析编制总体报告。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>报告标题</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：2025年6月经营分析报告" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>财年</Label>
              <Input value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} placeholder="2025" />
            </div>
            <div className="space-y-1.5">
              <Label>期间</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
