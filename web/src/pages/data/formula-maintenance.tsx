import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'
import { PAGINATION } from '@/lib/constants'
import {
  useMetrics,
  useSubjects,
  useCompanies,
  useUpdateMetric,
  useCreateMetric,
  useDeleteMetric,
  usePurgeMetric,
  useRestoreMetric,
  useConvertMetric,
  useTrialCalc,
  useDependencies,
} from '@/hooks/api-queries'
import { Pencil, Sparkles, History, Trash2, MoreHorizontal, Plus, Calculator, Download, ShieldAlert, RotateCcw, ArrowRightLeft } from 'lucide-react'
import { HistoryDialog } from './formula-history-dialog'
import { FormulaText } from './formula-text'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface CalcMetricRow {
  id: string
  code: string
  name: string
  category: string
  formula: string | null
  status: string
}

const PAGE_SIZE = PAGINATION.DEFAULT_PAGE_SIZE

/** 期间维度后缀中文名（{编码@维度} 跨期间引用，与后端 DIM_SUFFIXES 白名单一致） */
const DIM_LABELS: Record<string, string> = {
  BUDGET_AMOUNT: '预算', ACTUAL_MONTH: '本月实际', SAME_PERIOD_ACTUAL: '同期实际', YTD_ACTUAL: '本年累计', SAME_PERIOD_YTD: '同期累计',
  CURRENT_AMOUNT: '本期', YEAR_START: '年初', SAME_PERIOD_AMOUNT: '同期', LAST_YEAR_START: '上年年初',
}

/** 伪操作数（非科目编码）中文名 */
const PSEUDO_LABELS: Record<string, string> = { DAYS_YTD: '期间天数' }

interface FormulaMaintenanceProps {
  canCreate?: boolean
  canUpdate?: boolean
  canDelete?: boolean
  /** 指标审批（高危，仅 superadmin）；未传时回退为可编辑即可审批的旧行为 */
  canApprove?: boolean
  /** 彻底删除已停用指标（物理删除，仅 superadmin） */
  canPurge?: boolean
  /** 指标类型转换 data ↔ calc（高危，仅 superadmin） */
  canConvert?: boolean
  /** 兼容旧用法：仅传 canManage 时按 update 处理 */
  canManage?: boolean
}

/**
 * 计算类指标公式维护（真实后端）。
 * 功能：列表（中文公式展示）、新建（限科目体系内科目）/编辑/停用/恢复启用、类型转换、
 * 公式试算、依赖影响分析、版本历史与回滚、轻量审批、经营/静态切换。
 */
export function FormulaMaintenance({ canCreate = false, canUpdate = false, canDelete = false, canApprove, canPurge = false, canConvert = false, canManage }: FormulaMaintenanceProps) {
  // 兼容：canManage 视为可编辑
  const effectiveUpdate = canUpdate || !!canManage
  const effectiveApprove = canApprove ?? effectiveUpdate

  const [subjectType, setSubjectType] = useState<'operating' | 'static'>('operating')
  // includeInactive：列表需包含已停用指标（状态筛选/恢复启用/彻底删除入口依赖），后端默认被软删除过滤
  const { data, isLoading } = useMetrics({ page: 1, pageSize: 1000, includeInactive: 'true' })
  const { data: subjectsData } = useSubjects({ page: 1, pageSize: 1000, type: subjectType } as never)
  // 全量科目（经营+静态）：公式支持跨类型引用（如静态 ROA 引用经营科目），校验与预览须覆盖全部编码，与后端全局校验一致
  const { data: allSubjectsData } = useSubjects({ page: 1, pageSize: 2000 } as never)
  const { data: companiesData } = useCompanies()
  const updateMetric = useUpdateMetric()
  const createMetric = useCreateMetric()
  const deleteMetric = useDeleteMetric()
  const purgeMetric = usePurgeMetric()
  const restoreMetric = useRestoreMetric()
  const convertMetric = useConvertMetric()
  const trialCalc = useTrialCalc()

  const [keyword, setKeyword] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  // 编辑
  const [editing, setEditing] = useState<CalcMetricRow | null>(null)
  const [draftFormula, setDraftFormula] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [trialCompany, setTrialCompany] = useState('all')
  const [trialResult, setTrialResult] = useState<{ value: number | null; period: string | null; operands: { code: string; name: string; value: number }[] } | null>(null)
  const [showDeps, setShowDeps] = useState(false)
  // 新建（仅限科目体系内尚无指标记录的科目）
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ subjectCode: '', formula: '' })
  const [createError, setCreateError] = useState<string | null>(null)
  // 历史
  const [historyMetric, setHistoryMetric] = useState<CalcMetricRow | null>(null)
  // 类型转换（data → calc）
  const [convertOpen, setConvertOpen] = useState(false)
  const [convertForm, setConvertForm] = useState({ id: '', formula: '' })
  const [convertError, setConvertError] = useState<string | null>(null)
  const { confirm, element: confirmElement } = useConfirm()
  const [listError, setListError] = useState<string | null>(null)
  const [subjectSearch, setSubjectSearch] = useState('')
  // 插入科目时的可选期间维度后缀（''=当前列，跨期间公式如周转天数用）
  const [insertDim, setInsertDim] = useState('')

  // 编码 → 中文名称映射（公式中文展示与校验，含跨类型科目）
  const codeNameMap = useMemo(() => {
    const items = (allSubjectsData?.items ?? []) as unknown as Array<Record<string, unknown>>
    const map = new Map<string, string>()
    for (const s of items) map.set(String(s.code), String(s.name))
    return map
  }, [allSubjectsData])

  const formatFormula = (formula: string | null | undefined): string => {
    if (!formula) return '—'
    return formula.replace(/\{([^}@]+)(?:@([A-Z_]+))?\}/g, (_m, rawCode: string, dim: string | undefined) => {
      const code = rawCode.trim()
      if (PSEUDO_LABELS[code]) return PSEUDO_LABELS[code]
      const name = codeNameMap.get(code) ?? `{${code}}`
      return dim ? `${name}(${DIM_LABELS[dim] ?? dim})` : name
    })
  }

  const renderColoredFormula = (formula: string) => {
    const parts = formula.split(/(\{[^}]+\})/g)
    return parts.map((part, i) => {
      if (part.startsWith('{') && part.endsWith('}')) {
        const raw = part.slice(1, -1).trim()
        const [code, dim] = raw.split('@')
        const label = PSEUDO_LABELS[code] ?? (() => {
          const name = codeNameMap.get(code) ?? code
          return dim ? `${name}(${DIM_LABELS[dim] ?? dim})` : name
        })()
        return <Badge key={i} variant="secondary" className="mx-0.5 font-mono text-[11px]">{label}</Badge>
      }
      return <span key={i} className="font-mono">{part}</span>
    })
  }

  const calcMetrics: CalcMetricRow[] = useMemo(() => {
    const items = (data?.items ?? []) as unknown as Array<Record<string, unknown>>
    const prefix = subjectType === 'static' ? 'ST_' : 'OP_'
    return items
      .filter((m) => m.dataType === 'calc' && String(m.code).startsWith(prefix))
      .map((m) => ({
        id: String(m.id),
        code: String(m.code),
        name: String(m.name),
        category: String(m.category ?? '—'),
        formula: (m.formula as string | null) ?? null,
        status: String(m.status ?? 'active'),
      }))
  }, [data, subjectType])

  const categories = useMemo(() => Array.from(new Set(calcMetrics.map((s) => s.category))), [calcMetrics])

  // 可转换为计算类的数据类指标（当前类型下、启用中）
  const dataMetrics = useMemo(() => {
    const items = (data?.items ?? []) as unknown as Array<Record<string, unknown>>
    const prefix = subjectType === 'static' ? 'ST_' : 'OP_'
    return items
      .filter((m) => m.dataType === 'data' && String(m.code).startsWith(prefix) && String(m.status ?? 'active') === 'active')
      .map((m) => ({ id: String(m.id), code: String(m.code), name: String(m.name) }))
  }, [data, subjectType])

  // 可新建为计算类指标的科目：当前类型下、科目体系内、尚无同编码指标记录（新建指标的前置条件）
  const creatableSubjects = useMemo(() => {
    const metricCodes = new Set(((data?.items ?? []) as unknown as Array<Record<string, unknown>>).map((m) => String(m.code)))
    const items = (subjectsData?.items ?? []) as unknown as Array<Record<string, unknown>>
    return items
      .filter((s) => !metricCodes.has(String(s.code)))
      .map((s) => ({ code: String(s.code), name: String(s.name), category: String(s.category ?? '自定义') }))
  }, [data, subjectsData])

  const filtered = useMemo(
    () =>
      calcMetrics.filter((s) => {
        if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
        if (statusFilter !== 'all' && s.status !== statusFilter) return false
        if (keyword.trim()) {
          const kw = keyword.trim().toLowerCase()
          if (!s.name.toLowerCase().includes(kw) && !s.code.toLowerCase().includes(kw)) return false
        }
        return true
      }),
    [calcMetrics, categoryFilter, statusFilter, keyword],
  )

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const resetPage = () => setPage(1)

  const companies = useMemo(() => {
    const list = (companiesData ?? []) as unknown as Array<Record<string, unknown>>
    return list.filter((c) => c.type === 'entity').map((c) => ({ code: String(c.code), name: String(c.name) }))
  }, [companiesData])

  // 父级编码 → 直接子级的映射（用于结构聚合推荐）
  const childrenMap = useMemo(() => {
    const items = (subjectsData?.items ?? []) as unknown as Array<Record<string, unknown>>
    const map = new Map<string, { code: string; name: string }[]>()
    for (const s of items) {
      const parent = s.parentCode ? String(s.parentCode) : ''
      if (!parent) continue
      if (!map.has(parent)) map.set(parent, [])
      map.get(parent)!.push({ code: String(s.code), name: String(s.name) })
    }
    return map
  }, [subjectsData])

  /** 结构聚合推荐：某科目 = 直接子级之和（仅预览，不自动落库） */
  const structuralFormulaOf = (code: string): string | null => {
    const children = childrenMap.get(code)
    if (!children || children.length === 0) return null
    return children.map((c) => `{${c.code}}`).join(' + ')
  }

  const filteredSubjectsForInsert = useMemo(() => {
    // 默认展示当前类型科目；搜索时跨经营/静态全量匹配，支持插入跨类型引用
    const items = (subjectsData?.items ?? []) as unknown as Array<Record<string, unknown>>
    if (!subjectSearch.trim()) return items.slice(0, 50)
    const all = (allSubjectsData?.items ?? []) as unknown as Array<Record<string, unknown>>
    const kw = subjectSearch.trim().toLowerCase()
    return all.filter((s) => String(s.name).toLowerCase().includes(kw) || String(s.code).toLowerCase().includes(kw)).slice(0, 100)
  }, [subjectsData, allSubjectsData, subjectSearch])

  const formulaValidation = useMemo(() => {
    if (!draftFormula.trim()) return { valid: true, messages: [] as string[] }
    const msgs: string[] = []
    const refs = draftFormula.match(/\{([^}]+)\}/g)?.map((m) => m.slice(1, -1).trim()) ?? []
    for (const ref of refs) {
      const [code, dim] = ref.split('@')
      if (PSEUDO_LABELS[code]) {
        if (dim) msgs.push(`伪操作数 ${code} 不支持维度后缀`)
        continue
      }
      if (!codeNameMap.has(code)) msgs.push(`引用了不存在的编码：${code}`)
      if (dim && !DIM_LABELS[dim]) msgs.push(`无效的期间维度码：${dim}`)
    }
    const expr = draftFormula.replace(/\{[^}]+\}/g, '0')
    if (expr.trim() && !/^[0-9+\-*/().\s]+$/.test(expr)) msgs.push('包含非法字符（仅支持 +-*/() 数字）')
    if (draftFormula.length > 500) msgs.push('公式长度超过 500 字符限制')
    return { valid: msgs.length === 0, messages: msgs }
  }, [draftFormula, codeNameMap])

  // ---------- 编辑 ----------
  const openEdit = (row: CalcMetricRow) => {
    setEditing(row)
    setDraftFormula(row.formula ?? '')
    setSaveError(null)
    setTrialResult(null)
    setShowDeps(false)
  }

  const saveFormula = async () => {
    if (!editing) return
    setSaveError(null)
    try {
      const formula = draftFormula.trim() === '' ? null : draftFormula.trim()
      await updateMetric.mutateAsync({ id: editing.id, data: { formula } })
      setEditing(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (row: CalcMetricRow) => {
    if (!(await confirm({ title: '停用指标', description: `确认停用指标「${row.name}」？`, danger: true, confirmText: '停用' }))) return
    setListError(null)
    try {
      await deleteMetric.mutateAsync(row.id)
    } catch (err) {
      setListError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handlePurge = async (row: CalcMetricRow) => {
    if (!(await confirm({ title: '彻底删除指标', description: `将物理删除指标「${row.name}」（${row.code}）及其全部公式历史版本，此操作不可恢复！`, danger: true, confirmText: '彻底删除', requireInput: row.code }))) return
    setListError(null)
    try {
      await purgeMetric.mutateAsync(row.id)
    } catch (err) {
      setListError(err instanceof Error ? err.message : '彻底删除失败')
    }
  }

  const handleRestore = async (row: CalcMetricRow) => {
    if (!(await confirm({ title: '恢复启用指标', description: `确认恢复启用指标「${row.name}」？恢复后将重新参与公式校验与计算。`, confirmText: '恢复启用' }))) return
    setListError(null)
    try {
      await restoreMetric.mutateAsync({ id: row.id })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '恢复失败'
      // 公式依赖失效 → 提供“清空公式后恢复”选项（可事后编辑或从版本历史回滚）
      if (msg.includes('公式依赖已失效')) {
        if (await confirm({ title: '公式依赖已失效', description: `${msg}。清空后可重新编辑公式或从版本历史回滚。`, danger: true, confirmText: '清空公式并恢复' })) {
          try {
            await restoreMetric.mutateAsync({ id: row.id, clearFormula: true })
          } catch (err2) {
            setListError(err2 instanceof Error ? err2.message : '恢复失败')
          }
        }
      } else {
        setListError(msg)
      }
    }
  }

  const handleConvertToData = async (row: CalcMetricRow) => {
    if (!(await confirm({ title: '转为数据类指标', description: `将指标「${row.name}」（${row.code}）转换为数据类：公式将被清空（保留版本历史），转换后不再参与公式计算。`, danger: true, confirmText: '转换' }))) return
    setListError(null)
    try {
      await convertMetric.mutateAsync({ id: row.id, dataType: 'data' })
    } catch (err) {
      setListError(err instanceof Error ? err.message : '转换失败')
    }
  }

  const submitConvertToCalc = async () => {
    if (!convertForm.id) return
    setConvertError(null)
    try {
      await convertMetric.mutateAsync({ id: convertForm.id, dataType: 'calc', formula: convertForm.formula.trim() || undefined })
      setConvertOpen(false)
      setConvertForm({ id: '', formula: '' })
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : '转换失败')
    }
  }

  const handleTrial = async () => {
    if (!draftFormula.trim()) return
    setTrialResult(null)
    try {
      const res = await trialCalc.mutateAsync({ formula: draftFormula.trim(), companyCode: trialCompany === 'all' ? undefined : trialCompany })
      setTrialResult(res)
    } catch (err) {
      setTrialResult({ value: null, period: null, operands: [] })
      setSaveError(err instanceof Error ? err.message : '试算失败')
    }
  }

  const insertSubject = (code: string) => {
    const operand = insertDim ? `{${code}@${insertDim}}` : `{${code}}`
    setDraftFormula((prev) => (prev ? `${prev} ${operand}` : operand))
  }

  // ---------- 新建（以科目体系存在同编码科目为前置条件，编码/名称/类别由所选科目带出） ----------
  const submitCreate = async () => {
    const subject = creatableSubjects.find((s) => s.code === createForm.subjectCode)
    if (!subject) return
    setCreateError(null)
    try {
      await createMetric.mutateAsync({
        code: subject.code,
        name: subject.name,
        category: subject.category,
        dataType: 'calc',
        formula: createForm.formula.trim() || undefined,
      })
      setCreateOpen(false)
      setCreateForm({ subjectCode: '', formula: '' })
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败')
    }
  }

  const columns: DataTableColumn<CalcMetricRow>[] = [
    { key: 'code', header: '科目编码', cellClassName: 'font-mono text-muted-foreground' },
    {
      key: 'name', header: '科目名称', cellClassName: 'font-medium',
      render: (r) => (
        <span>
          {r.name}
          {r.status !== 'active' && <Badge variant="secondary" className="ml-2">已停用</Badge>}
        </span>
      ),
    },
    { key: 'category', header: '类别', cellClassName: 'text-muted-foreground' },
    {
      key: 'formula', header: '公式', cellClassName: 'font-mono',
      render: (r) => (r.formula ? <FormulaText text={formatFormula(r.formula)} className="max-w-[200px] md:max-w-[300px] xl:max-w-[420px]" /> : <span className="text-muted-foreground">—</span>),
    },
    {
      key: 'actions', header: '操作', align: 'right',
      render: (r) =>
        (effectiveUpdate || canDelete || canPurge || canConvert) ? (
          <div className="flex items-center justify-end gap-1">
            {effectiveUpdate && (
              <Button variant="ghost" size="sm" onClick={() => openEdit(r)} aria-label="编辑公式" title="编辑公式">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="更多操作">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {effectiveUpdate && (
                  <DropdownMenuItem onClick={() => setHistoryMetric(r)}>
                    <History className="mr-2 h-4 w-4" /> 历史/回滚
                  </DropdownMenuItem>
                )}
                {effectiveUpdate && r.status !== 'active' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleRestore(r)}>
                      <RotateCcw className="mr-2 h-4 w-4" /> 恢复启用
                    </DropdownMenuItem>
                  </>
                )}
                {canConvert && r.status === 'active' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleConvertToData(r)}>
                      <ArrowRightLeft className="mr-2 h-4 w-4" /> 转为数据类
                    </DropdownMenuItem>
                  </>
                )}
                {canDelete && r.status === 'active' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleDelete(r)}>
                      <Trash2 className="mr-2 h-4 w-4" /> 停用
                    </DropdownMenuItem>
                  </>
                )}
                {canPurge && r.status !== 'active' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handlePurge(r)}>
                      <ShieldAlert className="mr-2 h-4 w-4" /> 彻底删除
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={subjectType} onValueChange={(v) => { setSubjectType(v as 'operating' | 'static'); resetPage(); setCategoryFilter('all') }}>
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue placeholder="科目类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="operating">经营指标</SelectItem>
            <SelectItem value="static">静态指标</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); resetPage() }}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="选择类别" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类别</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); resetPage() }}>
          <SelectTrigger className="w-full sm:w-[120px]">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">启用中</SelectItem>
            <SelectItem value="inactive">已停用</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="搜索科目名称或编码..."
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); resetPage() }}
          className="min-w-[160px] flex-1"
        />
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <Button variant="outline" size="sm" onClick={() => { setCreateOpen(true); setCreateError(null) }}>
              <Plus className="mr-2 h-4 w-4" /> 新建指标
            </Button>
          )}
          {canConvert && (
            <Button variant="outline" size="sm" onClick={() => { setConvertOpen(true); setConvertError(null); setConvertForm({ id: '', formula: '' }) }}>
              <ArrowRightLeft className="mr-2 h-4 w-4" /> 转为计算类
            </Button>
          )}
          {effectiveUpdate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/data/metrics/formulas/export`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}` },
                  })
                  const json = await res.json()
                  const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `formula-export-${new Date().toISOString().slice(0, 10)}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                } catch { /* ignore */ }
              }}
            >
              <Download className="mr-2 h-4 w-4" /> 导出公式
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {isLoading ? '加载中...' : `共 ${filtered.length} 个计算类指标（${subjectType === 'operating' ? '经营' : '静态'}）`}
      </p>
      {listError && <p className="text-xs text-destructive">{listError}</p>}

      <DataTable columns={columns} data={paged} rowKey={(r) => r.code} dense emptyText="暂无计算类指标" />
      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />

      {/* 编辑公式对话框 */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] overflow-y-auto overflow-x-hidden rounded-lg sm:w-full sm:max-w-2xl lg:max-w-3xl">
          <DialogHeader>
            <DialogTitle>编辑公式</DialogTitle>
            <DialogDescription>{editing ? `${editing.name}（${editing.code}）` : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">公式表达式</label>
            <Input value={draftFormula} onChange={(e) => setDraftFormula(e.target.value)} placeholder="如：{OP_0201} - {OP_020101}" maxLength={500} />
            {draftFormula.trim() && (
              <p className="text-xs text-muted-foreground">中文预览：{renderColoredFormula(draftFormula)}</p>
            )}
            {draftFormula.trim() && (
              formulaValidation.valid ? (
                <p className="text-xs text-success-strong">语法校验通过</p>
              ) : (
                <div className="space-y-0.5">
                  {formulaValidation.messages.map((m, i) => (
                    <p key={i} className="text-xs text-destructive">{m}</p>
                  ))}
                </div>
              )
            )}
            {/* 插入科目（可选期间维度后缀） */}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="搜索科目..."
                value={subjectSearch}
                onChange={(e) => setSubjectSearch(e.target.value)}
                className="h-9 w-full sm:w-[150px]"
              />
              <Select value="" onValueChange={(code) => insertSubject(code)}>
                <SelectTrigger className="min-w-0 flex-1 sm:min-w-[180px]">
                  <SelectValue placeholder="选择科目插入" />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {filteredSubjectsForInsert.map((s) => (
                    <SelectItem key={String(s.code)} value={String(s.code)}>
                      <span className="font-mono text-xs">{String(s.code)}</span> {String(s.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={insertDim || 'current'} onValueChange={(v) => setInsertDim(v === 'current' ? '' : v)}>
                <SelectTrigger className="w-[130px] flex-none" title="插入时附加的期间维度后缀">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">当前列（默认）</SelectItem>
                  {Object.entries(DIM_LABELS).map(([dim, label]) => (
                    <SelectItem key={dim} value={dim}>@{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setDraftFormula((prev) => (prev ? `${prev} {DAYS_YTD}` : '{DAYS_YTD}'))}>
                插入天数
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              操作数用 {'{指标编码}'} 引用，仅支持四则运算与括号；跨期间引用用 {'{编码@维度}'}（如 @YEAR_START 年初、@YTD_ACTUAL 本年累计），{'{DAYS_YTD}'} 为财年累计天数；
              含跨期间引用的公式在“年初/上年年初”列不参与计算。保存时后端校验并检测依赖环；清空输入并保存可移除公式。
            </p>
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          </div>

          {/* 试算 */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <label className="flex items-center gap-1 text-sm font-medium">
              <Calculator className="h-4 w-4 text-primary" /> 公式试算
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={trialCompany} onValueChange={setTrialCompany}>
                <SelectTrigger className="w-full max-w-full sm:w-[200px]">
                  <SelectValue placeholder="选择公司" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部公司（汇总）</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={handleTrial} disabled={trialCalc.isPending || !draftFormula.trim()}>
                {trialCalc.isPending ? '试算中...' : '试算'}
              </Button>
            </div>
            {trialResult && (
              <div className="rounded-md bg-muted/50 p-2 text-xs">
                <p>期间：{trialResult.period ?? '—'}　试算结果：<span className="font-num font-semibold">{trialResult.value ?? '无法计算'}</span></p>
                {trialResult.operands.length > 0 && (
                  <p className="mt-1 text-muted-foreground">
                    取值：{trialResult.operands.map((o) => `${o.name}=${o.value}`).join('，')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 依赖影响分析 */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">依赖影响分析</label>
              <Button variant="ghost" size="sm" onClick={() => setShowDeps((v) => !v)} disabled={!editing}>
                {showDeps ? '收起' : '展开'}
              </Button>
            </div>
            {showDeps && editing && <DependencyPanel metricId={editing.id} />}
          </div>

          {/* 智能推荐（结构聚合） */}
          {editing && (() => {
            const structural = structuralFormulaOf(editing.code)
            return (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <label className="flex items-center gap-1 text-sm font-medium">
                  <Sparkles className="h-4 w-4 text-primary" /> 智能推荐
                </label>
                <p className="text-xs text-muted-foreground">基于科目层级结构推荐（父子求和），点击“应用”后可试算并保存。</p>
                {structural ? (
                  <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p><Badge variant="secondary">结构聚合</Badge> <span className="ml-1 text-muted-foreground">父子求和</span></p>
                      <p className="mt-1 break-all font-mono">{formatFormula(structural)}</p>
                    </div>
                    <Button size="sm" variant="secondary" className="self-end sm:self-auto" onClick={() => setDraftFormula(structural)}>应用</Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">该科目无直接子级，暂无结构推荐；可手动编辑公式。</p>
                )}
              </div>
            )
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={saveFormula} disabled={updateMetric.isPending}>
              {updateMetric.isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建指标对话框（前置条件：科目体系中存在同编码科目） */}
      <Dialog open={createOpen} onOpenChange={(open) => !open && setCreateOpen(false)}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] overflow-y-auto rounded-lg sm:w-full">
          <DialogHeader>
            <DialogTitle>新建计算指标</DialogTitle>
            <DialogDescription>从科目体系选择科目创建计算类指标，编码/名称/类别自动带出，可选填公式（后端校验）</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">选择科目</label>
              <Select value={createForm.subjectCode} onValueChange={(code) => setCreateForm({ ...createForm, subjectCode: code })}>
                <SelectTrigger>
                  <SelectValue placeholder="选择科目体系内的科目" />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {creatableSubjects.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      <span className="font-mono text-xs">{s.code}</span> {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {creatableSubjects.length === 0 && (
                <p className="text-xs text-muted-foreground">当前类型下所有科目均已有对应指标；如需将数据类指标改为计算类，请使用「转为计算类」。</p>
              )}
              {createForm.subjectCode && (() => {
                const s = creatableSubjects.find((x) => x.code === createForm.subjectCode)
                return s ? (
                  <p className="text-xs text-muted-foreground">编码：<span className="font-mono">{s.code}</span>　名称：{s.name}　类别：{s.category}</p>
                ) : null
              })()}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">公式（可选）</label>
              <Input value={createForm.formula} onChange={(e) => setCreateForm({ ...createForm, formula: e.target.value })} placeholder="如：{OP_020101} / {OP_02}" maxLength={500} />
              {createForm.formula.trim() && (
                <p className="text-xs text-muted-foreground">中文预览：{formatFormula(createForm.formula)}</p>
              )}
              {createForm.formula.trim() && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const res = await trialCalc.mutateAsync({ formula: createForm.formula.trim() })
                        setTrialResult(res)
                      } catch { /* ignore */ }
                    }}
                    disabled={trialCalc.isPending}
                  >
                    {trialCalc.isPending ? '试算中...' : '试算'}
                  </Button>
                  {trialResult && (
                    <span className="text-xs text-muted-foreground">
                      结果：{trialResult.value ?? '无法计算'}（期间 {trialResult.period ?? '—'}）
                    </span>
                  )}
                </div>
              )}
            </div>
            {createError && <p className="text-xs text-destructive">{createError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={submitCreate} disabled={createMetric.isPending || !createForm.subjectCode}>
              {createMetric.isPending ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 类型转换对话框（data → calc，高危） */}
      <Dialog open={convertOpen} onOpenChange={(open) => !open && setConvertOpen(false)}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] overflow-y-auto rounded-lg sm:w-full">
          <DialogHeader>
            <DialogTitle>数据类指标转为计算类</DialogTitle>
            <DialogDescription>选择一个数据类指标转换为计算类，可选填初始公式（后端校验并写入版本历史）。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">选择指标</label>
              <Select value={convertForm.id} onValueChange={(id) => setConvertForm({ ...convertForm, id })}>
                <SelectTrigger>
                  <SelectValue placeholder="选择数据类指标" />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {dataMetrics.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="font-mono text-xs">{m.code}</span> {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dataMetrics.length === 0 && <p className="text-xs text-muted-foreground">当前类型下没有可转换的数据类指标</p>}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">初始公式（可选）</label>
              <Input value={convertForm.formula} onChange={(e) => setConvertForm({ ...convertForm, formula: e.target.value })} placeholder="如：{OP_020101} / {OP_02}" maxLength={500} />
              {convertForm.formula.trim() && (
                <p className="text-xs text-muted-foreground">中文预览：{formatFormula(convertForm.formula)}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">转换后该指标将参与公式计算体系；未填公式时可事后在列表中编辑。</p>
            {convertError && <p className="text-xs text-destructive">{convertError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>取消</Button>
            <Button onClick={submitConvertToCalc} disabled={convertMetric.isPending || !convertForm.id}>
              {convertMetric.isPending ? '转换中...' : '确认转换'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 历史/回滚对话框 */}
      <HistoryDialog
        metric={historyMetric}
        formatFormula={formatFormula}
        onClose={() => setHistoryMetric(null)}
        canApprove={effectiveApprove}
      />
      {confirmElement}
    </div>
  )
}

// 依赖影响分析面板（懒加载）
function DependencyPanel({ metricId }: { metricId: string }) {
  const { data, isLoading } = useDependencies(metricId)
  if (isLoading) return <p className="text-xs text-muted-foreground">加载中...</p>
  if (!data) return null
  return (
    <div className="space-y-2 text-xs">
      <div>
        <p className="font-medium">依赖（本指标引用 {data.dependsOn.length} 个）：</p>
        {data.dependsOn.length > 0 ? data.dependsOn.map((d) => (
          <p key={d.code} className="ml-3 font-mono text-muted-foreground">├─ {d.name}（{d.code}）</p>
        )) : <p className="ml-3 text-muted-foreground">无</p>}
      </div>
      <div>
        <p className="font-medium">被依赖（引用本指标 {data.usedBy.length} 个）：</p>
        {data.usedBy.length > 0 ? data.usedBy.map((d) => (
          <p key={d.code} className="ml-3 font-mono text-muted-foreground">├─ {d.name}（{d.code}）</p>
        )) : <p className="ml-3 text-muted-foreground">无</p>}
      </div>
    </div>
  )
}
