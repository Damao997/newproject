import { Fragment, useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { useTransactionImportCoverage, useActivateImport } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { useBatchActivate, buildActivateConflictDescription } from '@/hooks/use-batch-activate'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Grid3X3, Loader2, RefreshCw } from 'lucide-react'
import type { TransactionCoverageCell } from '@/types'

/**
 * 导入覆盖 Tab：公司 × 期间 × 六大往来类型 的导入完整性矩阵。
 * 绿=已生效(笔数，按笔数分档底色深浅)、青=已导入·该期确无往来款、黄=草稿未激活(可点击直激活)、灰虚线=缺失；
 * 顶部为覆盖率可视化（大数字分档变色 + 四色堆叠条）与待激活批次提醒（默认折叠为前 3 条）；
 * 矩阵支持公司折叠、公司搜索、状态筛选、按缺失数排序、sticky 表头/公司列。
 */

const MONTH_OPTIONS = [
  { value: 3, label: '最近 3 个月' },
  { value: 6, label: '最近 6 个月' },
  { value: 12, label: '最近 12 个月' },
]

/** 状态筛选：行级过滤（仅显示含该状态单元格的期间行） */
const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '仅生效' },
  { value: 'empty', label: '仅无数据' },
  { value: 'draft', label: '仅草稿' },
  { value: 'missing', label: '仅缺失' },
] as const

type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number]['value']
type SortBy = 'code' | 'missing-desc'
type HoverStatus = 'active' | 'empty' | 'draft' | 'missing' | null

/** 公司排序：默认按后端 orderNo 顺序，可切换为缺失数降序（问题公司置顶） */
const SORT_OPTIONS = [
  { value: 'code', label: '按公司编码' },
  { value: 'missing-desc', label: '缺失多在前' },
] as const

/** 草稿直激活弹层目标：矩阵中某个 draft 单元格及其关联批次 */
interface DraftCellTarget {
  companyCode: string
  period: string
  type: string
  batchIds: string[]
}

function cellKey(companyCode: string, period: string, type: string): string {
  return `${companyCode}|${period}|${type}`
}

export function CoverageTab({ stickyTop = 0 }: { stickyTop?: number }) {
  // 覆盖窗口月份持久化到 pageStateStore（切 tab/切路由/刷新后恢复）
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const months = usePageStore((s) => s.transactions.coverage.months)
  const setMonths = useCallback((v: number) => setTransactionsTab('coverage', { months: v }), [setTransactionsTab])
  const { can } = usePermission()
  const canImport = can('transactions', 'import')

  const { data, isLoading, isError, error, refetch, isFetching } = useTransactionImportCoverage(months)
  const activateMutation = useActivateImport()
  const { getDisplayName } = useCompanyDisplayName()
  const { confirm, element: confirmElement } = useConfirm()
  const batchActivate = useBatchActivate()
  // 待激活批次多选（用于批量激活）
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set())
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [activateError, setActivateError] = useState('')

  // 视图态（不持久化）：图例悬停高亮 / 公司折叠 / 公司搜索 / 状态筛选 / 排序 / 提醒条展开 / 导入对话框 / 草稿直激活
  const [hoverStatus, setHoverStatus] = useState<HoverStatus>(null)
  const [collapsedCompanies, setCollapsedCompanies] = useState<Set<string>>(new Set())
  const [companyKeyword, setCompanyKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortBy, setSortBy] = useState<SortBy>('code')
  const [expandDrafts, setExpandDrafts] = useState(false)
  const [draftCellTarget, setDraftCellTarget] = useState<DraftCellTarget | null>(null)

  const toggleDraftSelect = (id: string) => {
    setSelectedDraftIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCompanyCollapse = (code: string) => {
    setCollapsedCompanies((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  /** 批量激活：预检冲突 → 确认覆盖风险 → 串行逐个激活（单批失败不中断，失败项保留勾选便于重试） */
  const handleBatchActivate = async () => {
    const targets = draftBatches.filter((b) => selectedDraftIds.has(b.id))
    if (targets.length === 0) return
    const batches = targets.map((b) => ({ id: b.id, filename: b.filename }))
    setActivateError('')
    try {
      const check = await batchActivate.checkConflicts(batches.map((b) => b.id))
      const desc = buildActivateConflictDescription(check)
      if (desc && !(await confirm({ title: '批量激活确认', description: desc, danger: true, confirmText: '继续激活' }))) return
      const summary = await batchActivate.run(batches)
      const failIds = new Set(summary.failItems.map((f) => f.id))
      // 成功项移出勾选（失败项保留便于重试）；激活后覆盖矩阵自动刷新（激活 mutation 已失效 transactions 查询）
      setSelectedDraftIds((prev) => new Set([...prev].filter((id) => failIds.has(id))))
      if (summary.failCount > 0) {
        setActivateError(`激活完成：成功 ${summary.successCount} 个，失败 ${summary.failCount} 个。失败批次已保留勾选，可处理后重试。`)
      }
    } catch (e) {
      setActivateError(e instanceof Error ? e.message : '批量激活失败')
    }
  }

  /** 单批激活（提醒条折叠区与草稿直激活弹层共用）；返回是否成功 */
  const handleActivate = async (batchId: string): Promise<boolean> => {
    setActivateError('')
    setActivatingId(batchId)
    try {
      await activateMutation.mutateAsync(batchId)
      return true
    } catch (e) {
      setActivateError(e instanceof Error ? e.message : '激活失败')
      return false
    } finally {
      setActivatingId(null)
    }
  }

  /** 草稿单元格直激活：成功后从弹层批次列表移除（矩阵状态由 query 失效自动刷新） */
  const handleActivateDraftBatch = async (batchId: string) => {
    const ok = await handleActivate(batchId)
    if (ok) {
      setDraftCellTarget((prev) => (prev ? { ...prev, batchIds: prev.batchIds.filter((id) => id !== batchId) } : prev))
    }
  }

  const cellMap = useMemo(() => {
    const m = new Map<string, TransactionCoverageCell>()
    for (const c of data?.cells ?? []) m.set(cellKey(c.companyCode, c.period, c.transactionType), c)
    return m
  }, [data])

  // 期间倒序展示（最近期间在前）
  const periodsDesc = useMemo(() => [...(data?.periods ?? [])].reverse(), [data])

  // 各公司状态计数（组头行摘要 + 缺失排序）
  const companyStats = useMemo(() => {
    const m = new Map<string, { active: number; empty: number; draft: number; missing: number }>()
    for (const c of data?.cells ?? []) {
      if (!m.has(c.companyCode)) m.set(c.companyCode, { active: 0, empty: 0, draft: 0, missing: 0 })
      const s = m.get(c.companyCode)!
      s[c.status]++
    }
    return m
  }, [data])

  // 公司列表：关键词过滤 + 缺失数排序（'code' 保持后端 orderNo 顺序）
  const sortedCompanies = useMemo(() => {
    const list = (data?.companies ?? []).filter(
      (c) => !companyKeyword || c.code.includes(companyKeyword) || c.name.includes(companyKeyword),
    )
    if (sortBy === 'missing-desc') {
      return [...list].sort((a, b) => (companyStats.get(b.code)?.missing ?? 0) - (companyStats.get(a.code)?.missing ?? 0))
    }
    return list
  }, [data, companyKeyword, sortBy, companyStats])

  /** 行级状态过滤：该 公司×期间 行是否包含目标状态单元格（'all' 不过滤） */
  const periodHasStatus = useCallback(
    (companyCode: string, period: string) => {
      if (statusFilter === 'all') return true
      return (data?.types ?? []).some((t) => cellMap.get(cellKey(companyCode, period, t))?.status === statusFilter)
    },
    [statusFilter, data, cellMap],
  )

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">加载中…</div>
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-destructive">{error instanceof Error ? error.message : '数据加载失败'}</p>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          重试
        </Button>
      </div>
    )
  }
  if (!data) return <div className="py-12 text-center text-sm text-muted-foreground">暂无数据</div>

  const { summary, draftBatches } = data
  const totalCells = summary.expected || 1
  // 覆盖率分档：100% 绿 / ≥80% 黄 / <80% 红（口径 = (active+empty)/expected）
  const rateColor = summary.coverageRate >= 100 ? 'text-success' : summary.coverageRate >= 80 ? 'text-warning' : 'text-destructive'
  const stackedSegments = [
    { status: 'active', count: summary.active, cls: 'bg-success' },
    { status: 'empty', count: summary.empty, cls: 'bg-info' },
    { status: 'draft', count: summary.draft, cls: 'bg-warning' },
    { status: 'missing', count: summary.missing, cls: 'bg-border' },
  ] as const
  const legendItems = [
    { status: 'active', label: '已生效', count: summary.active, cls: 'bg-success' },
    { status: 'empty', label: '无数据', count: summary.empty, cls: 'bg-info' },
    { status: 'draft', label: '草稿', count: summary.draft, cls: 'bg-warning' },
    { status: 'missing', label: '缺失', count: summary.missing, cls: 'bg-border' },
  ] as const

  // 提醒条默认折叠为前 3 条，避免与矩阵争抢注意力
  const visibleDrafts = expandDrafts ? draftBatches : draftBatches.slice(0, 3)

  // 草稿直激活弹层：目标单元格关联批次（从 draftBatches 反查元数据）
  const targetBatches = draftCellTarget
    ? draftCellTarget.batchIds
        .map((id) => draftBatches.find((b) => b.id === id))
        .filter((b): b is NonNullable<typeof b> => !!b)
    : []

  return (
    <div className="space-y-4">
      {/* 待激活批次提醒（默认折叠前 3 条；逐批激活已下沉至矩阵草稿单元格，行内不再放激活按钮） */}
      {draftBatches.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/[0.08] p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-warning-strong">
            <AlertTriangle className="h-4 w-4" />
            有 {draftBatches.length} 个往来批次已上传未激活，未激活数据不参与分析
            {canImport && (
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs font-normal">
                  <Checkbox
                    checked={draftBatches.length > 0 && draftBatches.every((b) => selectedDraftIds.has(b.id))}
                    disabled={batchActivate.isBusy}
                    onCheckedChange={(checked) => setSelectedDraftIds(checked ? new Set(draftBatches.map((b) => b.id)) : new Set())}
                  />
                  全选
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 border-warning/50 px-2 text-xs"
                  disabled={selectedDraftIds.size === 0 || batchActivate.isBusy || activatingId !== null}
                  onClick={handleBatchActivate}
                >
                  {batchActivate.isBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                  批量激活（{selectedDraftIds.size}）
                </Button>
              </span>
            )}
          </div>
          {batchActivate.progress && (
            <p className="mt-1 text-xs text-warning-strong/70">
              正在激活 {batchActivate.progress.done}/{batchActivate.progress.total}：{batchActivate.progress.currentFilename || '-'}
            </p>
          )}
          <ul className="mt-2 space-y-1.5">
            {visibleDrafts.map((b) => {
              const batchResult = batchActivate.results.get(b.id)
              return (
                <li key={b.id} className="flex items-center gap-3 text-sm text-warning-strong">
                  {canImport && (
                    <Checkbox
                      className="shrink-0"
                      checked={selectedDraftIds.has(b.id)}
                      disabled={batchActivate.isBusy}
                      onCheckedChange={() => toggleDraftSelect(b.id)}
                    />
                  )}
                  <span className="truncate">{b.filename}</span>
                  <span className="shrink-0 text-xs text-warning-strong/70">
                    {b.detailCount} 条 · {new Date(b.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  {batchResult?.status === 'success' ? (
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-success-strong">
                      <CheckCircle2 className="h-3 w-3" />已激活
                    </span>
                  ) : batchResult?.status === 'failed' ? (
                    <span className="ml-auto shrink-0 max-w-[220px] truncate text-xs text-destructive" title={batchResult.error}>激活失败：{batchResult.error}</span>
                  ) : (
                    <span className="ml-auto shrink-0 text-xs text-warning-strong/50">可在矩阵草稿格中激活</span>
                  )}
                </li>
              )
            })}
          </ul>
          {!expandDrafts && draftBatches.length > 3 && (
            <Button variant="ghost" size="sm" className="mt-1 h-6 px-1 text-xs" onClick={() => setExpandDrafts(true)}>
              展开全部 {draftBatches.length} 个批次
            </Button>
          )}
          {activateError && <p className="mt-1 text-xs text-destructive">{activateError}</p>}
        </div>
      )}

      {/* 统计卡：覆盖率大数字分档变色 + 四色堆叠比例条 + 图例计数 + 月份窗口（导入入口统一在数据管理页 /data/import）；吸顶 */}
      <Card className="sticky z-10 rounded-card p-4" style={{ top: stickyTop }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-muted-foreground">覆盖率</span>
            <span className={cn('font-num text-2xl font-semibold leading-none', rateColor)} title={`覆盖口径：(已生效 ${summary.active} + 无数据 ${summary.empty}) / 期望 ${summary.expected}`}>
              {summary.coverageRate}%
            </span>
          </div>
          <div className="min-w-[120px] flex-1" title="四色占比：绿=已生效 青=无数据 黄=草稿 灰=缺失">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              {stackedSegments.map((s) => (
                <div key={s.status} className={s.cls} style={{ width: `${(s.count / totalCells) * 100}%` }} />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {legendItems.map((item) => (
              <span
                key={item.status}
                className={cn('flex cursor-pointer items-center gap-1', hoverStatus === item.status && 'font-semibold text-foreground')}
                onMouseEnter={() => setHoverStatus(item.status)}
                onMouseLeave={() => setHoverStatus(null)}
              >
                <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', item.cls)} />
                {item.label} {item.count}
              </span>
            ))}
          </div>
          <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
            <SelectTrigger className="h-8 w-[140px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* 覆盖矩阵（表格卡）：工具条 + 限高滚动/sticky 表头与公司列 */}
      <Card className="rounded-card border border-border overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Grid3X3 className="h-4 w-4" />
            导入覆盖矩阵
          </h3>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input
              placeholder="搜索公司..."
              className="h-8 w-[180px]"
              value={companyKeyword}
              onChange={(e) => setCompanyKeyword(e.target.value)}
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="h-8 w-[130px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
              <SelectTrigger className="h-8 w-[140px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 px-2.5" disabled={isFetching} onClick={() => refetch()} title="刷新">
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            </Button>
          </div>
        </div>
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-foreground">
                <th className="sticky left-0 top-0 z-30 bg-muted px-2 py-2 text-center font-medium">公司</th>
                <th className="sticky top-0 z-30 bg-muted px-2 py-2 text-center font-medium">期间</th>
                {data.types.map((t) => (
                  <th key={t} className="sticky top-0 z-30 bg-muted px-2 py-2 text-center font-medium whitespace-nowrap">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedCompanies.map((company) => {
                const stats = companyStats.get(company.code) ?? { active: 0, empty: 0, draft: 0, missing: 0 }
                // 状态筛选：仅保留含目标状态的期间行；无匹配期间行的公司整组隐藏
                const periods = periodsDesc.filter((p) => periodHasStatus(company.code, p))
                if (periods.length === 0) return null
                const collapsed = collapsedCompanies.has(company.code)
                return (
                  <Fragment key={company.code}>
                    {/* 公司组头行：折叠/展开 + 状态摘要 + 缺失 badge */}
                    <tr
                      className="cursor-pointer border-b bg-muted/30 hover:bg-muted/50"
                      onClick={() => toggleCompanyCollapse(company.code)}
                      title={collapsed ? '展开该公司期间明细' : '收起该公司期间明细'}
                    >
                      <td colSpan={2 + data.types.length} className="px-3 py-2">
                        <div className="flex items-center gap-2 text-xs font-medium">
                          {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                          <span className="max-w-[180px] truncate">{getDisplayName(company.code, company.name)}</span>
                          <span className="font-normal text-muted-foreground">
                            生效 {stats.active} · 无数据 {stats.empty} · 草稿 {stats.draft}
                          </span>
                          {stats.missing > 0 && (
                            <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-num text-destructive">缺 {stats.missing}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {!collapsed &&
                      periods.map((period, pi) => (
                        <tr key={`${company.code}-${period}`} className={cn('border-b last:border-0', pi === periods.length - 1 && 'border-b-2')}>
                          {pi === 0 && (
                            <td rowSpan={periods.length} className="sticky left-0 z-20 border-r bg-card px-2 py-2 align-top text-xs font-medium" title={company.name}>
                              {getDisplayName(company.code, company.name)}
                            </td>
                          )}
                          <td className="px-2 py-1.5 text-center font-num text-xs text-muted-foreground">{period}</td>
                          {data.types.map((type) => {
                            const cell = cellMap.get(cellKey(company.code, period, type))
                            const status = cell?.status ?? 'missing'
                            const highlight = hoverStatus === status
                            if (status === 'active') {
                              // 按笔数分档底色：≤10 / ≤100 / >100
                              const count = cell!.recordCount
                              const shade = count > 100 ? 'bg-success/25' : count > 10 ? 'bg-success/15' : 'bg-success/10'
                              return (
                                <td key={type} className="px-1.5 py-1.5 text-center">
                                  <span
                                    title={`已生效 ${count} 条`}
                                    className={cn('inline-block min-w-[52px] rounded px-1.5 py-0.5 font-num text-xs font-medium text-success-strong', shade, highlight && 'ring-2 ring-primary/40')}
                                  >
                                    {count}
                                  </span>
                                </td>
                              )
                            }
                            if (status === 'empty') {
                              return (
                                <td key={type} className="px-1.5 py-1.5 text-center">
                                  <span
                                    title="已导入：该公司该期确无此类往来款（文件已申报，明细为 0 条，属正常空表）"
                                    className={cn('inline-block min-w-[52px] rounded bg-info/10 px-1.5 py-0.5 font-num text-xs text-info', highlight && 'ring-2 ring-primary/40')}
                                  >
                                    0
                                  </span>
                                </td>
                              )
                            }
                            if (status === 'draft') {
                              return (
                                <td key={type} className="px-1.5 py-1.5 text-center">
                                  <span
                                    title="已上传未激活，点击查看并激活该格对应批次"
                                    className={cn(
                                      'inline-block min-w-[52px] cursor-pointer rounded bg-warning/15 px-1.5 py-0.5 text-xs text-warning-strong hover:ring-2 hover:ring-warning/60',
                                      highlight && 'ring-2 ring-primary/40',
                                    )}
                                    onClick={() => setDraftCellTarget({ companyCode: company.code, period, type, batchIds: cell?.draftBatchIds ?? [] })}
                                  >
                                    草稿
                                  </span>
                                </td>
                              )
                            }
                            return (
                              <td key={type} className="px-1.5 py-1.5 text-center">
                                <span
                                  title={`未导入：请上传 ${company.name} ${period} 的${type}账龄报表（早期导入的批次未记录申报范围，真空数据重新上传后可识别为“无数据”）`}
                                  className={cn(
                                    'inline-block min-w-[52px] rounded border border-dashed border-muted-foreground/30 px-1.5 py-0.5 text-xs text-muted-foreground/70',
                                    highlight && 'ring-2 ring-primary/40',
                                  )}
                                >
                                  —
                                </span>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 草稿直激活弹层：展示该 公司×期间×类型 单元格关联的未激活批次 */}
      <Dialog open={draftCellTarget !== null} onOpenChange={(v) => { if (!v) { setDraftCellTarget(null); setActivateError('') } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>激活草稿批次</DialogTitle>
            <DialogDescription>
              {draftCellTarget ? `${getDisplayName(draftCellTarget.companyCode, undefined)} · ${draftCellTarget.period} · ${draftCellTarget.type}` : ''}
            </DialogDescription>
          </DialogHeader>
          {targetBatches.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">该单元格已无可激活批次（可能已全部激活）</p>
          ) : (
            <ul className="max-h-[320px] space-y-2 overflow-y-auto">
              {targetBatches.map((b) => {
                const batchResult = batchActivate.results.get(b.id)
                const batchActivating = activatingId === b.id
                return (
                  <li key={b.id} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{b.filename}</p>
                      <p className="text-xs text-muted-foreground">{b.detailCount} 条 · {new Date(b.createdAt).toLocaleDateString('zh-CN')}</p>
                    </div>
                    {batchResult?.status === 'success' ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-success-strong">
                        <CheckCircle2 className="h-3 w-3" />已激活
                      </span>
                    ) : batchResult?.status === 'failed' ? (
                      <span className="shrink-0 max-w-[140px] truncate text-xs text-destructive" title={batchResult.error}>失败：{batchResult.error}</span>
                    ) : canImport ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={activatingId !== null || batchActivate.isBusy}
                        onClick={() => handleActivateDraftBatch(b.id)}
                      >
                        {batchActivating ? <Loader2 className="h-3 w-3 animate-spin" /> : '激活'}
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          {activateError && <p className="text-xs text-destructive">{activateError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDraftCellTarget(null); setActivateError('') }}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmElement}
    </div>
  )
}
