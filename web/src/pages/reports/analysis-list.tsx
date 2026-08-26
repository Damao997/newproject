import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { FlashMessage } from '@/components/ui/flash-message'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { MonthPicker } from '@/components/ui/month-picker'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { Pagination } from '@/components/data-table/pagination'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { PAGINATION, REPORT_STATUS_LABEL } from '@/lib/constants'
import {
  useAnalyses, useUpdateAnalysis, useDeleteAnalysis, useRestoreAnalysis,
  useCompanies, useSubjects, useAvailablePeriods,
  useReports, useReport, useSetReportSections,
} from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { usePermission } from '@/hooks/usePermission'
import type { AnalysisItem, ReportSectionInput } from '@/types'
import { FileText, Search, Pencil, Trash2, RotateCcw, Link2, FilePlus2 } from 'lucide-react'

/**
 * 单项分析集中管理：列表（筛选/搜索/分页）+ 引用情况 + 快速编辑/删除/恢复。
 * 新建入口维持在指标分析页 AnalysisDrawer（公司×科目×期间 上下文）。
 */

const ALL = '__all'

/** 往来单项分析对象（六大往来类型粒度，TXN_* 编码不在 accountSubject 体系内，前端静态提供） */
const TXN_SUBJECT_OPTIONS = [
  { code: 'TXN_AR', name: '应收账款' },
  { code: 'TXN_AROT', name: '其他应收款' },
  { code: 'TXN_PER_AR', name: '预收账款' },
  { code: 'TXN_AP', name: '应付账款' },
  { code: 'TXN_APOT', name: '其他应付款' },
  { code: 'TXN_PER_AP', name: '预付账款' },
]

export function AnalysisManager({ stickyTop = 0 }: { stickyTop?: number }) {
  const { can } = usePermission()
  const canUpdate = can('reports', 'update')
  const canDelete = can('reports', 'delete')

  // 筛选态（变化时重置分页）
  const [companyCode, setCompanyCode] = useState(ALL)
  const [subjectType, setSubjectType] = useState(ALL)
  const [subjectCode, setSubjectCode] = useState(ALL)
  /** 分析类型：'all' 全部分析 / 'overview' 仅 AI 全局预分析归档 / 'subject' 仅科目分析 */
  const [analysisKind, setAnalysisKind] = useState<'all' | 'overview' | 'subject'>('all')
  const [period, setPeriod] = useState(ALL)
  const [keyword, setKeyword] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGINATION.DEFAULT_PAGE_SIZE)
  const { data: companies } = useCompanies()
  const { data: periodsData } = useAvailablePeriods()
  const { data: subjectsData } = useSubjects(
    { type: subjectType === ALL ? undefined : subjectType, pageSize: 1000 },
    { enabled: subjectType !== ALL && subjectType !== 'transaction' },
  )

  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  const { displayNameMap, getDisplayName } = useCompanyDisplayName()
  const periods = useMemo(() => [...(periodsData?.periods ?? [])].sort((a, b) => b.localeCompare(a)), [periodsData])
  // 往来科目为前端静态 6 项（TXN_*），其余类型查科目表
  const subjects = subjectType === 'transaction' ? TXN_SUBJECT_OPTIONS : (subjectsData?.items ?? [])

  const { data, isLoading } = useAnalyses({
    companyCode: companyCode === ALL ? undefined : companyCode,
    subjectCode: subjectCode === ALL ? undefined : subjectCode,
    period: period === ALL ? undefined : period,
    // 分析类型过滤：AI 预分析归档（OVERVIEW）与普通科目分析互斥
    subjectType: analysisKind === 'overview' ? 'overview' : analysisKind === 'subject' ? 'normal' : undefined,
    keyword: keyword.trim() || undefined,
    includeInactive,
    page,
    pageSize,
  })
  const items = data?.items ?? []
  const total = data?.total ?? 0

  const updateAnalysis = useUpdateAnalysis()
  const deleteAnalysis = useDeleteAnalysis()
  const restoreAnalysis = useRestoreAnalysis()
  const { confirm, element: confirmElement } = useConfirm()

  const [editing, setEditing] = useState<AnalysisItem | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const flash = (text: string, type: 'success' | 'error' = 'success') => {
    setMsg({ type, text })
    window.setTimeout(() => setMsg(null), 2500)
  }

  const resetPage = () => setPage(1)

  const handleDelete = async (item: AnalysisItem) => {
    const refCount = item.refs?.length ?? 0
    const ok = await confirm({
      title: '删除单项分析',
      description: refCount > 0
        ? `该分析被 ${refCount} 份报告引用，删除后相应章节将显示「原文已删除」。确认删除「${item.title}」？`
        : `确认删除「${item.title}」？删除后可在「包含已删除」中恢复。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteAnalysis.mutateAsync(item.id)
      flash('已删除')
    } catch (e) {
      flash((e as Error).message || '删除失败', 'error')
    }
  }

  const handleRestore = async (item: AnalysisItem) => {
    const ok = await confirm({
      title: '恢复单项分析',
      description: `确认恢复「${item.title}」？恢复后引用它的报告章节将重新显示最新正文。`,
      confirmText: '恢复',
    })
    if (!ok) return
    try {
      await restoreAnalysis.mutateAsync(item.id)
      flash('已恢复')
    } catch (e) {
      flash((e as Error).message || '恢复失败', 'error')
    }
  }

  // 插入报告：将 AI 预分析归档追加为报告章节（实时引用，随重新生成更新）
  const [insertTarget, setInsertTarget] = useState<AnalysisItem | null>(null)
  const [insertReportId, setInsertReportId] = useState('')

  // 分析列表列（操作列带权限门禁与状态分支）
  const listColumns: DataTableColumn<AnalysisItem>[] = useMemo(() => [
    {
      key: 'companyCode', header: '公司', align: 'center', cellClassName: 'text-muted-foreground',
      render: (a) => (
        <>
          <span title={a.companyName ?? a.companyCode}>{getDisplayName(a.companyCode, a.companyName)}</span>
          <div className="font-mono text-caption">{a.companyCode}</div>
        </>
      ),
    },
    {
      key: 'subjectCode', header: '科目', align: 'center', cellClassName: 'text-muted-foreground',
      render: (a) => (
        <>
          <span className="inline-flex items-center gap-1">
            {a.subjectName ?? a.subjectCode}
            {a.subjectCode === 'OVERVIEW' && (
              <Badge variant="outline" className="border-primary/40 px-1.5 py-0 text-micro text-primary">AI 预分析</Badge>
            )}
          </span>
          <div className="font-mono text-caption">{a.subjectCode}</div>
        </>
      ),
    },
    { key: 'period', header: '期间', align: 'center', cellClassName: 'font-mono text-muted-foreground' },
    { key: 'title', header: '标题', cellClassName: 'font-medium text-foreground' },
    { key: 'refs', header: '引用', align: 'center', render: (a) => <RefsBadge refs={a.refs ?? []} /> },
    {
      key: 'status', header: '状态', align: 'center',
      render: (a) => (a.status === 'inactive' ? <Badge variant="destructive">已删除</Badge> : <Badge variant="secondary">正常</Badge>),
    },
    { key: 'createdAt', header: '创建时间', align: 'center', cellClassName: 'text-muted-foreground', render: (a) => new Date(a.createdAt).toLocaleDateString('zh-CN') },
    { key: 'updatedAt', header: '更新时间', align: 'center', cellClassName: 'text-muted-foreground', render: (a) => new Date(a.updatedAt).toLocaleDateString('zh-CN') },
    {
      key: 'actions', header: '操作', align: 'center',
      render: (a) => {
        const inactive = a.status === 'inactive'
        return (
          <div className="flex items-center justify-center gap-1">
            {!inactive && a.subjectCode === 'OVERVIEW' && canUpdate && (
              <Button variant="ghost" size="sm" onClick={() => { setInsertTarget(a); setInsertReportId('') }}>
                <Link2 className="mr-1 h-3.5 w-3.5" /> 插入报告
              </Button>
            )}
            {!inactive && canUpdate && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(a)}><Pencil className="mr-1 h-3.5 w-3.5" /> 编辑</Button>
            )}
            {!inactive && canDelete && (
              <Button variant="ghost" size="sm" aria-label="删除分析" onClick={() => handleDelete(a)} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
            {inactive && canUpdate && (
              <Button variant="ghost" size="sm" onClick={() => handleRestore(a)}><RotateCcw className="mr-1 h-3.5 w-3.5" /> 恢复</Button>
            )}
          </div>
        )
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleDelete/handleRestore 为组件内闭包，重算代价可忽略
  ], [canUpdate, canDelete, getDisplayName, setInsertTarget, setEditing, handleDelete, handleRestore])
  const [inserting, setInserting] = useState(false)
  const { data: draftReports } = useReports({ status: 'draft', pageSize: 100 })
  const { data: insertReport } = useReport(insertTarget && insertReportId ? insertReportId : null)
  const setReportSections = useSetReportSections()

  const handleInsertToReport = async () => {
    if (!insertTarget || !insertReport) return
    setInserting(true)
    try {
      // 保留现有章节，追加预分析引用章节（全量提交，乐观锁沿用现有 mutation 封装）
      const existingItems: ReportSectionInput[] = insertReport.sections.map((s) =>
        s.analysisId ? { analysisId: s.analysisId } : { id: s.id, title: s.title, content: s.content },
      )
      await setReportSections.mutateAsync({
        id: insertReport.id,
        items: [...existingItems, { analysisId: insertTarget.id }],
        expectedUpdatedAt: insertReport.updatedAt,
      })
      setInsertTarget(null)
      setInsertReportId('')
      flash('已插入报告章节（实时引用该预分析）')
    } catch (e) {
      flash((e as Error).message || '插入失败', 'error')
    } finally {
      setInserting(false)
    }
  }

  return (
    <>
      {/* 控制层：筛选工具条（筛选卡，吸顶；flex-nowrap 强制单行：空间不足时科目/期间/搜索先压缩省略号，公司名与开关恒完整） */}
      <Card className="sticky z-10 rounded-card p-4" style={{ top: stickyTop }}>
      <div className="flex flex-nowrap items-center gap-1.5">
          <Select value={companyCode} onValueChange={(v) => { setCompanyCode(v); resetPage() }}>
            <SelectTrigger className="h-8 w-44 min-w-[96px]"><SelectValue placeholder="公司" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部公司</SelectItem>
              {entityCompanies.map((c) => <SelectItem key={c.code} value={c.code}>{displayNameMap.get(c.code) ?? c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={analysisKind} onValueChange={(v) => { setAnalysisKind(v as 'all' | 'overview' | 'subject'); resetPage() }}>
            <SelectTrigger className="h-8 w-32 min-w-0"><SelectValue placeholder="分析类型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分析</SelectItem>
              <SelectItem value="overview">AI 预分析</SelectItem>
              <SelectItem value="subject">科目分析</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={subjectType}
            onValueChange={(v) => { setSubjectType(v); setSubjectCode(ALL); resetPage() }}
            disabled={analysisKind === 'overview'}
          >
            <SelectTrigger className="h-8 w-28 min-w-0"><SelectValue placeholder="科目类型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部类型</SelectItem>
              <SelectItem value="operating">经营科目</SelectItem>
              <SelectItem value="static">静态科目</SelectItem>
              <SelectItem value="transaction">往来科目</SelectItem>
            </SelectContent>
          </Select>
          <Select value={subjectCode} onValueChange={(v) => { setSubjectCode(v); resetPage() }} disabled={subjectType === ALL || analysisKind === 'overview'}>
            <SelectTrigger className="h-8 w-44 min-w-0"><SelectValue placeholder={subjectType === ALL ? '先选科目类型' : '科目'} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部科目</SelectItem>
              {subjects.map((s) => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <MonthPicker
            value={period === ALL ? '' : period}
            onChange={(v) => { setPeriod(v || ALL); resetPage() }}
            availablePeriods={periods}
            allowedPeriods={periods}
            placeholder="全部期间"
            className="h-8 w-32 min-w-0"
          />
          <div className="relative w-52 min-w-0">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); resetPage() }}
              placeholder="标题/正文关键词…"
              className="h-8 pl-8"
            />
          </div>
          <label className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] text-muted-foreground">
            <Switch checked={includeInactive} onCheckedChange={(v) => { setIncludeInactive(v); resetPage() }} />
            包含已删除
          </label>
      </div>
      </Card>

      {/* 展示层：分析列表（表格卡） */}
      <Card className="animate-fade-in overflow-hidden rounded-card border border-border">
        {msg && <FlashMessage type={msg.type} className="pt-2">{msg.text}</FlashMessage>}

        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">暂无符合条件的单项分析。可在「指标分析」页各科目行点击「分析」撰写。</p>
          </div>
        ) : (
          <DataTable
            columns={listColumns}
            data={items}
            rowKey={(a) => a.id}
            density="dense"
            caption="单项分析列表"
            maxHeight="60vh"
          />
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
              summary={`共 ${total} 条单项分析`}
            />
          </div>
        )}

        {/* 快速编辑 */}
        <EditAnalysisDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSave={async (id, title, content) => {
            try {
              await updateAnalysis.mutateAsync({ id, data: { title, content } })
              setEditing(null)
              flash('已保存')
            } catch (e) {
              flash((e as Error).message || '保存失败', 'error')
            }
          }}
          saving={updateAnalysis.isPending}
        />

        {/* 插入报告（AI 预分析归档 → 追加为引用章节） */}
        <InsertReportDialog
          target={insertTarget}
          reportId={insertReportId}
          onReportIdChange={setInsertReportId}
          reports={(draftReports?.items ?? []).map((r) => ({ id: r.id, title: r.title }))}
          onConfirm={handleInsertToReport}
          onClose={() => setInsertTarget(null)}
          busy={inserting}
        />
        {confirmElement}
      </Card>
    </>
  )
}

/** 引用情况徽标：数量 + Popover 列出引用报告 */
function RefsBadge({ refs }: { refs: { reportId: string; reportTitle: string; reportStatus: string }[] }) {
  if (refs.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 px-2 text-helper">
          <Link2 className="mr-1 h-3 w-3" /> 引用 {refs.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3">
        <p className="mb-2 text-[13px] font-medium text-foreground">被以下报告引用</p>
        <ul className="space-y-1.5">
          {refs.map((r) => (
            <li key={`${r.reportId}`} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="truncate text-foreground">{r.reportTitle}</span>
              <Badge variant="outline" className="shrink-0">{REPORT_STATUS_LABEL[r.reportStatus] ?? r.reportStatus}</Badge>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/** 快速编辑对话框：标题 + 富文本正文（公司/科目/期间不可变更） */
function EditAnalysisDialog({ item, onClose, onSave, saving }: {
  item: AnalysisItem | null
  onClose: () => void
  onSave: (id: string, title: string, content: string) => void
  saving: boolean
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const { getDisplayName } = useCompanyDisplayName()

  // item 切换时同步表单（渲染期间同步 state，避免 useEffect 闪烁）
  if (item && item.id !== loadedId) {
    setLoadedId(item.id)
    setTitle(item.title)
    setContent(item.content)
  }

  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑单项分析</DialogTitle>
          <DialogDescription>
            {item ? `${getDisplayName(item.companyCode, item.companyName)} · ${item.subjectName ?? item.subjectCode} · ${item.period}（公司/科目/期间不可变更）` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="分析标题" />
          <RichTextEditor value={content} onChange={setContent} editable placeholder="撰写分析结论…" polishEnabled />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => item && onSave(item.id, title, content)} disabled={saving || !title.trim()}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 插入报告对话框：将 AI 预分析归档追加为指定草稿报告的引用章节（实时更新） */
function InsertReportDialog({
  target,
  reportId,
  onReportIdChange,
  reports,
  onConfirm,
  onClose,
  busy,
}: {
  target: AnalysisItem | null
  reportId: string
  onReportIdChange: (v: string) => void
  reports: { id: string; title: string }[]
  onConfirm: () => void
  onClose: () => void
  busy: boolean
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>插入报告</DialogTitle>
          <DialogDescription>
            将「{target?.title}」作为引用章节追加到报告，章节实时展示该预分析最新内容（重新生成后自动更新）。
          </DialogDescription>
        </DialogHeader>
        <Select value={reportId} onValueChange={onReportIdChange}>
          <SelectTrigger className="h-8 w-full"><SelectValue placeholder="选择草稿报告" /></SelectTrigger>
          <SelectContent>
            {reports.length === 0 ? (
              <SelectItem value="__none" disabled>暂无草稿报告</SelectItem>
            ) : (
              reports.map((r) => <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>)
            )}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={onConfirm} disabled={busy || !reportId}><FilePlus2 className="mr-1 h-4 w-4" /> 插入章节</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
