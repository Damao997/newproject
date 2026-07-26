import { useMemo, useRef, useState } from 'react'
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
  useFormulaRules,
  useBatchPreviewFormulas,
  useBatchApplyFormulas,
  useTrialCalc,
  useDependencies,
  useCheckFormulas,
  type FormulaGenItem,
  type FormulaCheckItem,
} from '@/hooks/api-queries'
import { Pencil, Sparkles, Wand2, History, Trash2, MoreHorizontal, Plus, Settings2, Calculator, Download, ShieldCheck, ShieldAlert } from 'lucide-react'
import { HistoryDialog } from './formula-history-dialog'
import { RuleManageDialog } from './formula-rule-dialog'
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
/** 批量 AI 体检单次请求条数（后端单次上限 30） */
const AI_CHECK_CHUNK = 20

/** 风险等级徽章 */
function riskBadge(level: FormulaCheckItem['riskLevel']) {
  if (level === 'high') return <Badge variant="destructive">高风险</Badge>
  if (level === 'medium') return <Badge variant="warning">中风险</Badge>
  if (level === 'low') return <Badge variant="success">低风险</Badge>
  return <Badge variant="secondary">未知</Badge>
}

const RISK_ORDER: Record<FormulaCheckItem['riskLevel'], number> = { high: 0, medium: 1, unknown: 2, low: 3 }

interface FormulaMaintenanceProps {
  canCreate?: boolean
  canUpdate?: boolean
  canDelete?: boolean
  canManageRule?: boolean
  /** 指标审批（高危，仅 superadmin）；未传时回退为可编辑即可审批的旧行为 */
  canApprove?: boolean
  /** 彻底删除已停用指标（物理删除，仅 superadmin） */
  canPurge?: boolean
  /** 兼容旧用法：仅传 canManage 时按 update 处理 */
  canManage?: boolean
}

/**
 * 计算类指标公式维护（真实后端）。
 * 功能：列表（中文公式展示）、新建/编辑/删除、AI 辅助生成、批量规则生成（勾选应用）、
 * 公式试算、依赖影响分析、版本历史与回滚、轻量审批、公式规则库管理、经营/静态切换。
 */
export function FormulaMaintenance({ canCreate = false, canUpdate = false, canDelete = false, canManageRule, canApprove, canPurge = false, canManage }: FormulaMaintenanceProps) {
  // 兼容：canManage 视为可编辑
  const effectiveUpdate = canUpdate || !!canManage
  const effectiveRuleManage = canManageRule ?? canCreate
  const effectiveApprove = canApprove ?? effectiveUpdate

  const [subjectType, setSubjectType] = useState<'operating' | 'static'>('operating')
  const { data, isLoading } = useMetrics({ page: 1, pageSize: 1000 })
  const { data: subjectsData } = useSubjects({ page: 1, pageSize: 1000, type: subjectType } as never)
  const { data: companiesData } = useCompanies()
  const { data: rulesData } = useFormulaRules()
  const updateMetric = useUpdateMetric()
  const createMetric = useCreateMetric()
  const deleteMetric = useDeleteMetric()
  const purgeMetric = usePurgeMetric()
  const batchPreview = useBatchPreviewFormulas()
  const batchApply = useBatchApplyFormulas()
  const trialCalc = useTrialCalc()
  const checkFormulas = useCheckFormulas()

  const [keyword, setKeyword] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [page, setPage] = useState(1)
  // 编辑
  const [editing, setEditing] = useState<CalcMetricRow | null>(null)
  const [draftFormula, setDraftFormula] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [trialCompany, setTrialCompany] = useState('all')
  const [trialResult, setTrialResult] = useState<{ value: number | null; period: string | null; operands: { code: string; name: string; value: number }[] } | null>(null)
  const [showDeps, setShowDeps] = useState(false)
  // 新建
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ code: '', name: '', category: '', formula: '' })
  const [createError, setCreateError] = useState<string | null>(null)
  // 历史
  const [historyMetric, setHistoryMetric] = useState<CalcMetricRow | null>(null)
  // 批量
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchResults, setBatchResults] = useState<FormulaGenItem[]>([])
  const [batchError, setBatchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applyResults, setApplyResults] = useState<{ code: string; ok: boolean; message?: string }[] | null>(null)
  const [batchKeyword, setBatchKeyword] = useState('')
  const [onlyApplicable, setOnlyApplicable] = useState(false)
  // 规则管理
  const [ruleOpen, setRuleOpen] = useState(false)
  // AI 检测（单条，编辑对话框内）
  const [aiCheck, setAiCheck] = useState<FormulaCheckItem | null>(null)
  // AI 体检（批量）
  const [aiScanOpen, setAiScanOpen] = useState(false)
  const [aiScanResults, setAiScanResults] = useState<(FormulaCheckItem & { name: string; formula: string })[]>([])
  const [aiScanError, setAiScanError] = useState<string | null>(null)
  const [aiScanProgress, setAiScanProgress] = useState<{ done: number; total: number } | null>(null)
  const [aiScanRisk, setAiScanRisk] = useState('all')
  const aiScanCancelRef = useRef(false)
  const { confirm, element: confirmElement } = useConfirm()
  const [listError, setListError] = useState<string | null>(null)
  const [subjectSearch, setSubjectSearch] = useState('')
  const [showAggregate, setShowAggregate] = useState(false)

  // 编码 → 中文名称映射（公式中文展示）
  const codeNameMap = useMemo(() => {
    const items = (subjectsData?.items ?? []) as unknown as Array<Record<string, unknown>>
    const map = new Map<string, string>()
    for (const s of items) map.set(String(s.code), String(s.name))
    return map
  }, [subjectsData])

  const formatFormula = (formula: string | null | undefined): string => {
    if (!formula) return '—'
    return formula.replace(/\{([^}]+)\}/g, (_m, code: string) => codeNameMap.get(code.trim()) ?? `{${code}}`)
  }

  const renderColoredFormula = (formula: string) => {
    const parts = formula.split(/(\{[^}]+\})/g)
    return parts.map((part, i) => {
      if (part.startsWith('{') && part.endsWith('}')) {
        const code = part.slice(1, -1).trim()
        const name = codeNameMap.get(code)
        return <Badge key={i} variant="secondary" className="mx-0.5 font-mono text-[11px]">{name ?? code}</Badge>
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

  const filtered = useMemo(
    () =>
      calcMetrics.filter((s) => {
        if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
        if (keyword.trim()) {
          const kw = keyword.trim().toLowerCase()
          if (!s.name.toLowerCase().includes(kw) && !s.code.toLowerCase().includes(kw)) return false
        }
        return true
      }),
    [calcMetrics, categoryFilter, keyword],
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

  /** 规则推荐：按指标名包含规则名匹配（取最长匹配，与后端 matchRule 一致） */
  const ruleFormulaOf = (name: string): { formula: string; ruleName: string } | null => {
    const rules = (rulesData ?? []) as Array<{ name: string; formulaTemplate: string }>
    let best: { name: string; formulaTemplate: string } | null = null
    for (const r of rules) {
      if (r.name && name.includes(r.name)) {
        if (!best || r.name.length > best.name.length) best = r
      }
    }
    return best ? { formula: best.formulaTemplate, ruleName: best.name } : null
  }

  // 父子聚合只读预览：当前类型下所有含子级的科目→ sum(直接子级)
  const aggregatePreview = useMemo(() => {
    const prefix = subjectType === 'static' ? 'ST_' : 'OP_'
    const rows: { code: string; name: string; formula: string }[] = []
    for (const [parentCode, children] of childrenMap) {
      if (!parentCode.startsWith(prefix)) continue
      rows.push({
        code: parentCode,
        name: codeNameMap.get(parentCode) ?? parentCode,
        formula: children.map((c) => `{${c.code}}`).join(' + '),
      })
    }
    return rows.sort((a, b) => a.code.localeCompare(b.code))
  }, [childrenMap, codeNameMap, subjectType])

  const filteredSubjectsForInsert = useMemo(() => {
    const items = (subjectsData?.items ?? []) as unknown as Array<Record<string, unknown>>
    if (!subjectSearch.trim()) return items.slice(0, 50)
    const kw = subjectSearch.trim().toLowerCase()
    return items.filter((s) => String(s.name).toLowerCase().includes(kw) || String(s.code).toLowerCase().includes(kw)).slice(0, 100)
  }, [subjectsData, subjectSearch])

  const formulaValidation = useMemo(() => {
    if (!draftFormula.trim()) return { valid: true, messages: [] as string[] }
    const msgs: string[] = []
    const codes = draftFormula.match(/\{([^}]+)\}/g)?.map((m) => m.slice(1, -1).trim()) ?? []
    for (const c of codes) {
      if (!codeNameMap.has(c)) msgs.push(`引用了不存在的编码：${c}`)
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
    setAiCheck(null)
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
    if (!(await confirm({ title: '彻底删除指标', description: `将物理删除指标「${row.name}」（${row.code}）及其全部公式历史版本，此操作不可恢复！`, danger: true, confirmText: '彻底删除' }))) return
    setListError(null)
    try {
      await purgeMetric.mutateAsync(row.id)
    } catch (err) {
      setListError(err instanceof Error ? err.message : '彻底删除失败')
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
    setDraftFormula((prev) => (prev ? `${prev} {${code}}` : `{${code}}`))
  }

  // ---------- AI 检测（单条） ----------
  const handleAiCheck = async () => {
    if (!editing || !draftFormula.trim()) return
    setAiCheck(null)
    setSaveError(null)
    try {
      const res = await checkFormulas.mutateAsync({
        items: [{ code: editing.code, name: editing.name, formula: draftFormula.trim() }],
        subjectType,
      })
      setAiCheck(res[0] ?? null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'AI 检测失败')
    }
  }

  // ---------- AI 体检（批量，分块串行请求） ----------
  const runAiScan = async () => {
    const targets = calcMetrics.filter((m) => m.formula)
    setAiScanOpen(true)
    setAiScanResults([])
    setAiScanError(null)
    setAiScanRisk('all')
    aiScanCancelRef.current = false
    setAiScanProgress({ done: 0, total: targets.length })
    if (targets.length === 0) return
    const infoMap = new Map(targets.map((t) => [t.code, t]))
    try {
      for (let i = 0; i < targets.length; i += AI_CHECK_CHUNK) {
        if (aiScanCancelRef.current) break
        const chunk = targets.slice(i, i + AI_CHECK_CHUNK)
        const res = await checkFormulas.mutateAsync({
          items: chunk.map((m) => ({ code: m.code, name: m.name, formula: m.formula as string })),
          subjectType,
        })
        setAiScanResults((prev) => [
          ...prev,
          ...res.map((r) => ({ ...r, name: infoMap.get(r.code)?.name ?? r.code, formula: infoMap.get(r.code)?.formula ?? '' })),
        ])
        setAiScanProgress({ done: Math.min(i + chunk.length, targets.length), total: targets.length })
      }
    } catch (err) {
      setAiScanError(err instanceof Error ? err.message : 'AI 体检失败')
    }
  }

  const closeAiScan = () => {
    aiScanCancelRef.current = true
    setAiScanOpen(false)
  }

  const displayedScanResults = useMemo(() => {
    const list = aiScanRisk === 'all' ? aiScanResults : aiScanResults.filter((r) => r.riskLevel === aiScanRisk)
    return [...list].sort((a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel] || a.code.localeCompare(b.code))
  }, [aiScanResults, aiScanRisk])

  // ---------- 新建 ----------
  const submitCreate = async () => {
    setCreateError(null)
    try {
      await createMetric.mutateAsync({
        code: createForm.code.trim(),
        name: createForm.name.trim(),
        category: createForm.category.trim() || '自定义',
        dataType: 'calc',
        formula: createForm.formula.trim() || undefined,
      })
      setCreateOpen(false)
      setCreateForm({ code: '', name: '', category: '', formula: '' })
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败')
    }
  }

  // ---------- 批量 ----------
  const openBatch = async () => {
    setBatchOpen(true)
    setBatchResults([])
    setBatchError(null)
    setApplyResults(null)
    setBatchKeyword('')
    setOnlyApplicable(false)
    try {
      const res = await batchPreview.mutateAsync({ subjectType })
      setBatchResults(res)
      setSelected(new Set(res.filter((r) => r.valid && r.formula).map((r) => r.code)))
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : '生成失败')
    }
  }

  const toggleSelect = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const validItems = batchResults.filter((r) => r.valid && r.formula && selected.has(r.code))
  const applicableCodes = batchResults.filter((r) => r.valid && r.formula).map((r) => r.code)

  // 批量预览过滤（名称/编码搜索 + 仅可应用）
  const displayedBatchResults = batchResults.filter((r) => {
    if (onlyApplicable && !(r.valid && r.formula)) return false
    const kw = batchKeyword.trim().toLowerCase()
    if (kw && !r.name.toLowerCase().includes(kw) && !r.code.toLowerCase().includes(kw)) return false
    return true
  })

  const invertSelect = () => {
    setSelected((prev) => {
      const next = new Set<string>()
      for (const code of applicableCodes) if (!prev.has(code)) next.add(code)
      return next
    })
  }

  const applyBatch = async () => {
    if (validItems.length === 0) return
    setApplyResults(null)
    try {
      const res = await batchApply.mutateAsync(validItems.map((r) => ({ code: r.code, formula: r.formula as string, dependsOn: r.dependsOn })))
      setApplyResults((res as { results?: { code: string; ok: boolean; message?: string }[] }).results ?? [])
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : '应用失败')
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
      render: (r) => (r.formula ? formatFormula(r.formula) : <span className="text-muted-foreground">—</span>),
    },
    {
      key: 'actions', header: '操作', align: 'right',
      render: (r) =>
        (effectiveUpdate || canDelete || canPurge) ? (
          <div className="flex items-center justify-end gap-1">
            {effectiveUpdate && (
              <Button variant="ghost" size="sm" onClick={() => openEdit(r)} title="编辑公式">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {effectiveUpdate && (
                  <DropdownMenuItem onClick={() => setHistoryMetric(r)}>
                    <History className="mr-2 h-4 w-4" /> 历史/回滚
                  </DropdownMenuItem>
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
      <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-x-2 sm:space-y-0">
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
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="选择类别" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类别</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="搜索科目名称或编码..."
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); resetPage() }}
          className="flex-1"
        />
        {canCreate && (
          <Button variant="outline" size="sm" onClick={() => { setCreateOpen(true); setCreateError(null) }}>
            <Plus className="mr-2 h-4 w-4" /> 新建指标
          </Button>
        )}
        {effectiveUpdate && (
          <Button variant="outline" size="sm" onClick={openBatch} disabled={batchPreview.isPending}>
            <Wand2 className="mr-2 h-4 w-4" /> {batchPreview.isPending ? '生成中...' : '批量生成'}
          </Button>
        )}
        {effectiveUpdate && (
          <Button variant="outline" size="sm" onClick={runAiScan} disabled={checkFormulas.isPending}>
            <ShieldCheck className="mr-2 h-4 w-4" /> AI 体检
          </Button>
        )}
        {effectiveRuleManage && (
          <Button variant="ghost" size="sm" onClick={() => setRuleOpen(true)}>
            <Settings2 className="mr-2 h-4 w-4" /> 规则管理
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

      <p className="text-xs text-muted-foreground">
        {isLoading ? '加载中...' : `共 ${filtered.length} 个计算类指标（${subjectType === 'operating' ? '经营' : '静态'}）`}
      </p>
      {listError && <p className="text-xs text-destructive">{listError}</p>}

      <DataTable columns={columns} data={paged} rowKey={(r) => r.code} emptyText="暂无计算类指标" />
      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />

      {/* 编辑公式对话框 */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑公式</DialogTitle>
            <DialogDescription>{editing ? `${editing.name}（${editing.code}）` : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">公式表达式</label>
            <Input value={draftFormula} onChange={(e) => setDraftFormula(e.target.value)} placeholder="如：{OP_002} - {OP_030}" maxLength={500} />
            {draftFormula.trim() && (
              <p className="text-xs text-muted-foreground">中文预览：{renderColoredFormula(draftFormula)}</p>
            )}
            {draftFormula.trim() && (
              formulaValidation.valid ? (
                <p className="text-xs text-green-600">语法校验通过</p>
              ) : (
                <div className="space-y-0.5">
                  {formulaValidation.messages.map((m, i) => (
                    <p key={i} className="text-xs text-destructive">{m}</p>
                  ))}
                </div>
              )
            )}
            {/* 插入科目 */}
            <div className="flex items-center space-x-2">
              <Input
                placeholder="搜索科目..."
                value={subjectSearch}
                onChange={(e) => setSubjectSearch(e.target.value)}
                className="w-[160px] h-9"
              />
              <Select value="" onValueChange={(code) => insertSubject(code)}>
                <SelectTrigger className="w-[240px]">
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
            </div>
            <p className="text-xs text-muted-foreground">
              操作数用 {'{指标编码}'} 引用，仅支持四则运算与括号；保存时后端校验并检测依赖环。清空输入并保存可移除公式。
            </p>
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          </div>

          {/* 试算 */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <label className="flex items-center gap-1 text-sm font-medium">
              <Calculator className="h-4 w-4 text-primary" /> 公式试算
            </label>
            <div className="flex items-center space-x-2">
              <Select value={trialCompany} onValueChange={setTrialCompany}>
                <SelectTrigger className="w-[200px]">
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
                <p>期间：{trialResult.period ?? '—'}　试算结果：<span className="font-mono font-semibold">{trialResult.value ?? '无法计算'}</span></p>
                {trialResult.operands.length > 0 && (
                  <p className="mt-1 text-muted-foreground">
                    取值：{trialResult.operands.map((o) => `${o.name}=${o.value}`).join('，')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* AI 检测（语义审查，仅供参考） */}
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" /> AI 检测
              </label>
              <Button variant="outline" size="sm" onClick={handleAiCheck} disabled={checkFormulas.isPending || !draftFormula.trim()}>
                {checkFormulas.isPending ? '检测中...' : '开始检测'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">AI 审查公式与指标名称的语义一致性与业务合理性，结果仅供参考，不影响保存。</p>
            {aiCheck && (
              <div className="space-y-1 rounded-md bg-muted/50 p-2 text-xs">
                <p className="flex items-center gap-1">风险等级：{riskBadge(aiCheck.riskLevel)}</p>
                {aiCheck.ruleWarnings.map((w, i) => (
                  <p key={`rw-${i}`} className="text-destructive">• [规则] {w}</p>
                ))}
                {aiCheck.issues.map((m, i) => (
                  <p key={`is-${i}`}>• {m}</p>
                ))}
                {aiCheck.issues.length === 0 && aiCheck.ruleWarnings.length === 0 && (
                  <p className="text-green-600">未发现问题</p>
                )}
                {aiCheck.suggestion && <p className="text-muted-foreground">建议：{aiCheck.suggestion}</p>}
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

          {/* 智能推荐（结构聚合 + 规则库，无自然语言） */}
          {editing && (() => {
            const structural = structuralFormulaOf(editing.code)
            const rule = ruleFormulaOf(editing.name)
            return (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <label className="flex items-center gap-1 text-sm font-medium">
                  <Sparkles className="h-4 w-4 text-primary" /> 智能推荐
                </label>
                <p className="text-xs text-muted-foreground">基于科目层级结构与公式规则库推荐，点击“应用”后可试算并保存。</p>
                {structural && (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 p-2 text-xs">
                    <div className="min-w-0">
                      <p><Badge variant="secondary">结构聚合</Badge> <span className="ml-1 text-muted-foreground">父子求和</span></p>
                      <p className="mt-1 break-all font-mono">{formatFormula(structural)}</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setDraftFormula(structural)}>应用</Button>
                  </div>
                )}
                {rule && (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 p-2 text-xs">
                    <div className="min-w-0">
                      <p><Badge>规则</Badge> <span className="ml-1 text-muted-foreground">{rule.ruleName}</span></p>
                      <p className="mt-1 break-all font-mono">{formatFormula(rule.formula)}</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setDraftFormula(rule.formula)}>应用</Button>
                  </div>
                )}
                {!structural && !rule && (
                  <p className="text-xs text-muted-foreground">暂无结构或规则推荐；可手动编辑公式或在“规则管理”中新增规则。</p>
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

      {/* 新建指标对话框 */}
      <Dialog open={createOpen} onOpenChange={(open) => !open && setCreateOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建计算指标</DialogTitle>
            <DialogDescription>创建 calc 类型指标并可选填公式（后端校验）</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">指标编码</label>
              <Input value={createForm.code} onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })} placeholder="如：CALC_自定义指标" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">指标名称</label>
              <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="如：自定义毛利率" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">类别</label>
              <Input value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })} placeholder="如：财务指标" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">公式（可选）</label>
              <Input value={createForm.formula} onChange={(e) => setCreateForm({ ...createForm, formula: e.target.value })} placeholder="如：{OP_057} / {OP_005}" maxLength={500} />
              {createForm.formula.trim() && (
                <p className="text-xs text-muted-foreground">中文预览：{formatFormula(createForm.formula)}</p>
              )}
              {createForm.formula.trim() && (
                <div className="flex items-center space-x-2">
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
            <Button onClick={submitCreate} disabled={createMetric.isPending || !createForm.code.trim() || !createForm.name.trim()}>
              {createMetric.isPending ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量生成对话框 */}
      <Dialog open={batchOpen} onOpenChange={(open) => !open && setBatchOpen(false)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>批量生成公式（按规则）</DialogTitle>
            <DialogDescription>按「业务名 → 公式模板」规则生成公式，勾选后仅应用选中且校验通过项。</DialogDescription>
          </DialogHeader>
          {batchError && <p className="text-sm text-destructive">{batchError}</p>}
          {applyResults && (
            <p className="text-sm text-green-700">
              已应用 {applyResults.filter((r) => r.ok).length} 项
              {applyResults.some((r) => !r.ok) && `，失败 ${applyResults.filter((r) => !r.ok).length} 项`}
            </p>
          )}
          {!batchPreview.isPending && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="搜索指标名称或编码..."
                value={batchKeyword}
                onChange={(e) => setBatchKeyword(e.target.value)}
                className="h-8 w-full sm:w-[220px]"
              />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={onlyApplicable} onChange={(e) => setOnlyApplicable(e.target.checked)} />
                仅显示可应用
              </label>
              <Button variant="ghost" size="sm" onClick={invertSelect} disabled={applicableCodes.length === 0}>反选</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>清空</Button>
            </div>
          )}
          {batchPreview.isPending ? (
            <p className="py-8 text-center text-sm text-muted-foreground">生成中...</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left font-medium">
                      <input
                        type="checkbox"
                        checked={validItems.length > 0 && validItems.length === applicableCodes.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(applicableCodes) : new Set())}
                      />
                    </th>
                    <th className="p-2 text-left font-medium">指标</th>
                    <th className="p-2 text-left font-medium">命中规则</th>
                    <th className="p-2 text-left font-medium">生成公式</th>
                    <th className="p-2 text-left font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedBatchResults.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">无匹配项</td></tr>
                  ) : displayedBatchResults.map((r) => (
                    <tr key={r.code} className="border-b">
                      <td className="p-2">
                        <input type="checkbox" checked={selected.has(r.code)} disabled={!r.valid || !r.formula} onChange={() => toggleSelect(r.code)} />
                      </td>
                      <td className="p-2">{r.name}<span className="ml-1 font-mono text-xs text-muted-foreground">{r.code}</span></td>
                      <td className="p-2 text-muted-foreground">{r.ruleName ?? '—'}</td>
                      <td className="p-2 font-mono">{r.formula ? formatFormula(r.formula) : '—'}</td>
                      <td className="p-2">
                        {r.valid ? <Badge variant="success">可应用</Badge> : <Badge variant="secondary" title={r.warnings.join('；')}>跳过</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 父子聚合只读预览（不落库） */}
          {!batchPreview.isPending && aggregatePreview.length > 0 && (
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <button
                className="flex w-full items-center gap-1 text-sm font-medium"
                onClick={() => setShowAggregate((v) => !v)}
              >
                <Sparkles className="h-4 w-4 text-primary" /> 父子聚合关系预览（{aggregatePreview.length} 项）
                <span className="ml-auto text-xs text-muted-foreground">{showAggregate ? '收起' : '展开'}</span>
              </button>
              {showAggregate && (
                <div className="max-h-[220px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {aggregatePreview.map((a) => (
                        <tr key={a.code} className="border-b">
                          <td className="p-2 align-top">{a.name}<span className="ml-1 font-mono text-muted-foreground">{a.code}</span></td>
                          <td className="p-2 align-top font-mono text-muted-foreground">= {formatFormula(a.formula)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <span className="mr-auto text-xs text-muted-foreground">
              共 {batchResults.length} 项，已选 {validItems.length} 项
            </span>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>关闭</Button>
            <Button onClick={applyBatch} disabled={batchApply.isPending || validItems.length === 0}>
              {batchApply.isPending ? `应用中（${validItems.length} 项）...` : `确认应用（${validItems.length} 项）`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI 体检对话框（批量检测） */}
      <Dialog open={aiScanOpen} onOpenChange={(open) => !open && closeAiScan()}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>AI 公式体检</DialogTitle>
            <DialogDescription>
              AI 逐条审查当前类型下已配公式的计算指标（语义一致性与业务合理性），结果仅供参考。
            </DialogDescription>
          </DialogHeader>
          {aiScanError && <p className="text-sm text-destructive">{aiScanError}</p>}
          {aiScanProgress && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {aiScanProgress.total === 0 ? (
                <span>当前类型下没有已配公式的计算指标</span>
              ) : (
                <>
                  <span>
                    进度：{aiScanProgress.done} / {aiScanProgress.total}
                    {checkFormulas.isPending && '（检测中...）'}
                  </span>
                  {checkFormulas.isPending && (
                    <Button variant="ghost" size="sm" onClick={() => { aiScanCancelRef.current = true }}>停止</Button>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <span>风险筛选</span>
                    <Select value={aiScanRisk} onValueChange={setAiScanRisk}>
                      <SelectTrigger className="h-8 w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部</SelectItem>
                        <SelectItem value="high">高风险</SelectItem>
                        <SelectItem value="medium">中风险</SelectItem>
                        <SelectItem value="low">低风险</SelectItem>
                        <SelectItem value="unknown">未知</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
          )}
          {aiScanResults.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left font-medium">指标</th>
                    <th className="p-2 text-left font-medium">公式</th>
                    <th className="p-2 text-left font-medium">风险</th>
                    <th className="p-2 text-left font-medium">问题与建议</th>
                    <th className="p-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedScanResults.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">无匹配项</td></tr>
                  ) : displayedScanResults.map((r) => (
                    <tr key={r.code} className="border-b align-top">
                      <td className="p-2">{r.name}<span className="ml-1 font-mono text-xs text-muted-foreground">{r.code}</span></td>
                      <td className="p-2 font-mono text-xs">{formatFormula(r.formula)}</td>
                      <td className="p-2">{riskBadge(r.riskLevel)}</td>
                      <td className="p-2 text-xs">
                        {r.ruleWarnings.map((w, i) => (
                          <p key={`rw-${i}`} className="text-destructive">[规则] {w}</p>
                        ))}
                        {r.issues.map((m, i) => (
                          <p key={`is-${i}`}>{m}</p>
                        ))}
                        {r.issues.length === 0 && r.ruleWarnings.length === 0 && <span className="text-muted-foreground">—</span>}
                        {r.suggestion && <p className="text-muted-foreground">建议：{r.suggestion}</p>}
                      </td>
                      <td className="p-2 text-right">
                        {effectiveUpdate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="编辑公式"
                            onClick={() => {
                              const row = calcMetrics.find((m) => m.code === r.code)
                              if (row) { closeAiScan(); openEdit(row) }
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <span className="mr-auto text-xs text-muted-foreground">
              {aiScanResults.length > 0 &&
                `高风险 ${aiScanResults.filter((r) => r.riskLevel === 'high').length} 项，中风险 ${aiScanResults.filter((r) => r.riskLevel === 'medium').length} 项`}
            </span>
            <Button variant="outline" onClick={closeAiScan}>关闭</Button>
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

      {/* 规则管理对话框 */}
      <RuleManageDialog open={ruleOpen} onClose={() => setRuleOpen(false)} canUpdate={effectiveUpdate} canDelete={canDelete} formatFormula={formatFormula} />
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
