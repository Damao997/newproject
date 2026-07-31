import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { Pagination } from '@/components/data-table/pagination'
import { PAGINATION } from '@/lib/constants'
import {
  useAnalyses, useUpdateAnalysis, useDeleteAnalysis, useRestoreAnalysis,
  useCompanies, useSubjects, useAvailablePeriods,
} from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { usePermission } from '@/hooks/usePermission'
import type { AnalysisItem } from '@/types'
import { FileText, Search, Pencil, Trash2, RotateCcw, Link2 } from 'lucide-react'

/**
 * 单项分析集中管理：列表（筛选/搜索/分页）+ 引用情况 + 快速编辑/删除/恢复。
 * 新建入口维持在指标分析页 AnalysisDrawer（公司×科目×期间 上下文）。
 */

const ALL = '__all'
const REPORT_STATUS_LABEL: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' }

/** 往来单项分析对象（六大往来类型粒度，TXN_* 编码不在 accountSubject 体系内，前端静态提供） */
const TXN_SUBJECT_OPTIONS = [
  { code: 'TXN_AR', name: '应收账款' },
  { code: 'TXN_AROT', name: '其他应收款' },
  { code: 'TXN_PER_AR', name: '预收账款' },
  { code: 'TXN_AP', name: '应付账款' },
  { code: 'TXN_APOT', name: '其他应付款' },
  { code: 'TXN_PER_AP', name: '预付账款' },
]

export function AnalysisManager() {
  const { can } = usePermission()
  const canUpdate = can('reports', 'update')
  const canDelete = can('reports', 'delete')

  // 筛选态（变化时重置分页）
  const [companyCode, setCompanyCode] = useState(ALL)
  const [subjectType, setSubjectType] = useState(ALL)
  const [subjectCode, setSubjectCode] = useState(ALL)
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
  const [msg, setMsg] = useState<string | null>(null)

  const flash = (m: string) => {
    setMsg(m)
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
      flash((e as Error).message || '删除失败')
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
      flash((e as Error).message || '恢复失败')
    }
  }

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-0">
        {/* 筛选工具条 */}
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Select value={companyCode} onValueChange={(v) => { setCompanyCode(v); resetPage() }}>
            <SelectTrigger className="h-8 w-44"><SelectValue placeholder="公司" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部公司</SelectItem>
              {entityCompanies.map((c) => <SelectItem key={c.code} value={c.code}>{displayNameMap.get(c.code) ?? c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={subjectType} onValueChange={(v) => { setSubjectType(v); setSubjectCode(ALL); resetPage() }}>
            <SelectTrigger className="h-8 w-28"><SelectValue placeholder="科目类型" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部类型</SelectItem>
              <SelectItem value="operating">经营科目</SelectItem>
              <SelectItem value="static">静态科目</SelectItem>
              <SelectItem value="transaction">往来科目</SelectItem>
            </SelectContent>
          </Select>
          <Select value={subjectCode} onValueChange={(v) => { setSubjectCode(v); resetPage() }} disabled={subjectType === ALL}>
            <SelectTrigger className="h-8 w-44"><SelectValue placeholder={subjectType === ALL ? '先选科目类型' : '科目'} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部科目</SelectItem>
              {subjects.map((s) => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={(v) => { setPeriod(v); resetPage() }}>
            <SelectTrigger className="h-8 w-32"><SelectValue placeholder="期间" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部期间</SelectItem>
              {periods.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative w-52">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); resetPage() }}
              placeholder="标题/正文关键词…"
              className="h-8 pl-8"
            />
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Switch checked={includeInactive} onCheckedChange={(v) => { setIncludeInactive(v); resetPage() }} />
            包含已删除
          </label>
        </div>

        {msg && <p className="px-4 pt-2 text-[13px] text-primary">{msg}</p>}

        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">暂无符合条件的单项分析。可在「指标分析」页各科目行点击「分析」撰写。</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/50 text-black">
                <th className="h-11 px-4 text-center font-medium">公司</th>
                <th className="h-11 px-4 text-center font-medium">科目</th>
                <th className="h-11 px-4 text-center font-medium">期间</th>
                <th className="h-11 px-4 text-center font-medium">标题</th>
                <th className="h-11 px-4 text-center font-medium">引用</th>
                <th className="h-11 px-4 text-center font-medium">状态</th>
                <th className="h-11 px-4 text-center font-medium">创建时间</th>
                <th className="h-11 px-4 text-center font-medium">更新时间</th>
                <th className="h-11 px-4 text-center font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const inactive = a.status === 'inactive'
                return (
                  <tr key={a.id} className="border-b transition-colors hover:bg-muted/50">
                    <td className="px-4 py-2.5 text-center text-muted-foreground" title={a.companyName ?? a.companyCode}>
                      {getDisplayName(a.companyCode, a.companyName)}
                      <div className="font-mono text-[11px]">{a.companyCode}</div>
                    </td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">
                      {a.subjectName ?? a.subjectCode}
                      <div className="font-mono text-[11px]">{a.subjectCode}</div>
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono text-muted-foreground">{a.period}</td>
                    <td className="px-4 py-2.5 text-left font-medium text-foreground">{a.title}</td>
                    <td className="px-4 py-2.5 text-center">
                      <RefsBadge refs={a.refs ?? []} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {inactive
                        ? <Badge variant="destructive">已删除</Badge>
                        : <Badge variant="secondary">正常</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">{new Date(a.createdAt).toLocaleDateString('zh-CN')}</td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">{new Date(a.updatedAt).toLocaleDateString('zh-CN')}</td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {!inactive && canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(a)}><Pencil className="mr-1 h-3.5 w-3.5" /> 编辑</Button>
                        )}
                        {!inactive && canDelete && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(a)} className="text-finance-red"><Trash2 className="h-3.5 w-3.5" /></Button>
                        )}
                        {inactive && canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => handleRestore(a)}><RotateCcw className="mr-1 h-3.5 w-3.5" /> 恢复</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
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
              flash((e as Error).message || '保存失败')
            }
          }}
          saving={updateAnalysis.isPending}
        />
        {confirmElement}
      </CardContent>
    </Card>
  )
}

/** 引用情况徽标：数量 + Popover 列出引用报告 */
function RefsBadge({ refs }: { refs: { reportId: string; reportTitle: string; reportStatus: string }[] }) {
  if (refs.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 px-2 text-[12px]">
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
