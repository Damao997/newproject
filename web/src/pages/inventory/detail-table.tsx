import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { usePageStore } from '@/stores/pageStateStore'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import type { InventoryDetailRow } from '@/hooks/api-queries'
import type { AnalysisTarget } from '@/components/indicators/analysis-drawer'
import { exportToExcel } from '@/lib/export'
import { cn, formatMoneyWan, getChangeColor, getChangePrefix } from '@/lib/utils'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileText, Package, RefreshCw, Search, X } from 'lucide-react'
import {
  DIM_EMPTY_HINTS,
  DIM_EMPTY_TITLES,
  DIM_REGION_LABELS,
  DIM_SEARCH_EMPTY_HINTS,
  DIM_TITLES,
  exportColumns,
  makeComparator,
  round2,
  type DetailDim,
  type SortKey,
  type SortState,
  type ViewRow,
} from './inventory-utils'

/** 变动率徽标：红涨绿跌（国内财报习惯），分母为 0 显示 '-'，变动为 0 也显示 '-' */
export function ChangeRate({ current, base }: { current: number; base: number }) {
  if (!base) return <span className="font-num text-muted-foreground">-</span>
  const rate = ((current - base) / base) * 100
  return (
    <span className={cn('font-num', getChangeColor(rate))}>
      {rate === 0 ? '-' : `${getChangePrefix(rate)}${Math.abs(rate).toFixed(1)}%`}
    </span>
  )
}

/** 查询失败提示 + 重试（overview/details 共用，模式同趋势卡） */
export function QueryError({ message, onRetry, fetching }: { message?: string; onRetry: () => void; fetching?: boolean }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card">
      <p className="text-sm text-destructive">{message || '数据加载失败'}</p>
      <Button variant="outline" size="sm" disabled={fetching} onClick={onRetry}>
        <RefreshCw className="mr-1 h-3.5 w-3.5" />
        重试
      </Button>
    </div>
  )
}

/** 可排序表头：点击循环 无→降序→升序，aria-sort 供读屏识别 */
function SortableTh({ label, sortKey, sort, onSort }: {
  label: string
  sortKey: SortKey
  sort: SortState | null
  onSort: (key: SortKey) => void
}) {
  const active = sort?.key === sortKey
  const dir = active ? sort!.dir : 'desc'
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-2 py-2 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-0.5 transition-colors hover:text-primary"
      >
        {label}
        {active
          ? (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
          : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  )
}

interface DetailTableProps {
  detailDim: DetailDim
  setDetailDim: (d: DetailDim) => void
  /** detailsQuery 原始行（品类钻取/维度聚合/搜索排序/合计在组件内完成） */
  rows: InventoryDetailRow[]
  /** detailsQuery 加载/错误/刷新态 */
  loading: boolean
  isError: boolean
  error: unknown
  fetching: boolean
  onRetry: () => void
  period: string
  categoryCode: string
  /** 当前钻取品类显示名（主文件从 overview/明细行解析） */
  categoryName: string
  canAnalyze: boolean
  /** 按公司汇总行「分析」禁用态：存货根科目静态树未就绪 */
  companyAnalyzeDisabled: boolean
  /** 按公司汇总行「分析」：公司级分析（存货根科目），主文件提供上下文 */
  onAnalyzeCompany: (row: ViewRow) => void
  /** 行级「分析」抽屉打开（公司×品类明细模式） */
  onAnalyze: (target: AnalysisTarget) => void
}

/** 存货明细表：维度切换/搜索/排序/行选择/导出/单项分析（公司×品类视图） */
export function DetailTable({
  detailDim,
  setDetailDim,
  rows,
  loading,
  isError,
  error,
  fetching,
  onRetry,
  period,
  categoryCode,
  categoryName,
  canAnalyze,
  companyAnalyzeDisabled,
  onAnalyzeCompany,
  onAnalyze,
}: DetailTableProps) {
  const setInventory = usePageStore((s) => s.setInventory)
  const storeKeyword = usePageStore((s) => s.inventory.keyword)
  const { getDisplayName } = useCompanyDisplayName()

  // ===== 关键词搜索：输入 300ms 防抖后写入持久化 store =====
  const [keywordInput, setKeywordInput] = useState(storeKeyword)
  useEffect(() => { setKeywordInput(storeKeyword) }, [storeKeyword])
  useEffect(() => {
    const t = setTimeout(() => {
      const next = keywordInput.trim()
      if (next !== usePageStore.getState().inventory.keyword) setInventory({ keyword: next })
    }, 300)
    return () => clearTimeout(t)
  }, [keywordInput, setInventory])

  // ===== 明细表：按维度聚合（品类钻取先于聚合，三模式一致生效） → 搜索/排序 → 合计 =====
  const [sort, setSort] = useState<SortState | null>(null)
  const cycleSort = useCallback((key: SortKey) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 'desc' }
      if (s.dir === 'desc') return { key, dir: 'asc' }
      return null
    })
  }, [])

  const viewRows = useMemo<ViewRow[]>(() => {
    const base = categoryCode ? rows.filter((r) => r.categoryCode === categoryCode) : rows
    if (detailDim === 'company') {
      const by = new Map<string, { name: string; current: number; yearStart: number; samePeriod: number; lastYearStart: number }>()
      for (const r of base) {
        const acc = by.get(r.companyCode) ?? { name: r.companyName, current: 0, yearStart: 0, samePeriod: 0, lastYearStart: 0 }
        acc.current += r.current
        acc.yearStart += r.yearStart
        acc.samePeriod += r.samePeriod
        acc.lastYearStart += r.lastYearStart
        by.set(r.companyCode, acc)
      }
      return [...by.entries()].map(([code, v]) => {
        const current = round2(v.current)
        const yearStart = round2(v.yearStart)
        const samePeriod = round2(v.samePeriod)
        const lastYearStart = round2(v.lastYearStart)
        const displayName = getDisplayName(code, v.name)
        return {
          key: `c:${code}`,
          label: displayName,
          company: { code, name: v.name },
          searchText: `${displayName} ${code}`.toLowerCase(),
          current, yearStart, samePeriod, lastYearStart,
          yoy: samePeriod ? ((current - samePeriod) / samePeriod) * 100 : Number.NaN,
        }
      })
    }
    if (detailDim === 'category') {
      const by = new Map<string, { name: string; current: number; yearStart: number; samePeriod: number; lastYearStart: number }>()
      for (const r of base) {
        const acc = by.get(r.categoryCode) ?? { name: r.categoryName, current: 0, yearStart: 0, samePeriod: 0, lastYearStart: 0 }
        acc.current += r.current
        acc.yearStart += r.yearStart
        acc.samePeriod += r.samePeriod
        acc.lastYearStart += r.lastYearStart
        by.set(r.categoryCode, acc)
      }
      return [...by.entries()].map(([code, v]) => {
        const current = round2(v.current)
        const yearStart = round2(v.yearStart)
        const samePeriod = round2(v.samePeriod)
        const lastYearStart = round2(v.lastYearStart)
        return {
          key: `k:${code}`,
          label: v.name,
          searchText: `${v.name} ${code}`.toLowerCase(),
          current, yearStart, samePeriod, lastYearStart,
          yoy: samePeriod ? ((current - samePeriod) / samePeriod) * 100 : Number.NaN,
        }
      })
    }
    return base.map((r) => {
      const displayName = getDisplayName(r.companyCode, r.companyName)
      return {
        key: `${r.companyCode}-${r.categoryCode}`,
        label: displayName,
        detail: r,
        searchText: `${displayName} ${r.companyCode} ${r.companyName} ${r.categoryName} ${r.categoryCode}`.toLowerCase(),
        current: r.current, yearStart: r.yearStart, samePeriod: r.samePeriod, lastYearStart: r.lastYearStart, yoy: r.yoy,
      }
    })
  }, [rows, detailDim, categoryCode, getDisplayName])

  const visibleRows = useMemo(() => {
    const kw = storeKeyword.trim().toLowerCase()
    let rows = viewRows
    if (kw) rows = rows.filter((r) => r.searchText.includes(kw))
    if (sort) rows = [...rows].sort(makeComparator(sort))
    return rows
  }, [viewRows, storeKeyword, sort])

  const totals = useMemo(() => {
    const sum = (pick: (r: ViewRow) => number) => visibleRows.reduce((s, r) => s + pick(r), 0)
    return { current: sum((r) => r.current), yearStart: sum((r) => r.yearStart), samePeriod: sum((r) => r.samePeriod) }
  }, [visibleRows])

  // ===== 批量勾选与导出（页面只读，批量操作仅覆盖导出；维度切换时清空选择，避免跨模式脏键） =====
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => { setSelected(new Set()) }, [detailDim])
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.key))
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visibleRows.map((r) => r.key)))
  const toggleOne = (k: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })
  const selectedRows = useMemo(() => visibleRows.filter((r) => selected.has(r.key)), [visibleRows, selected])

  const [exporting, setExporting] = useState(false)
  const doExport = async (rows: ViewRow[], tag = '') => {
    if (rows.length === 0) return
    setExporting(true)
    try {
      const dimLabel = detailDim === 'company' ? '公司汇总' : detailDim === 'category' ? '品类展开' : '明细'
      const sheetName = detailDim === 'company' ? '按公司汇总' : detailDim === 'category' ? '按品类展开' : '公司×品类明细'
      await exportToExcel({
        filename: `存货_${dimLabel}${tag}_${period ?? ''}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName,
        columns: exportColumns(detailDim),
        rows: rows.map((r) => {
          const base = {
            current: r.current,
            yearStart: r.yearStart,
            vsYearStart: r.yearStart ? `${(((r.current - r.yearStart) / r.yearStart) * 100).toFixed(1)}%` : '-',
            samePeriod: r.samePeriod,
            yoy: r.samePeriod ? `${r.yoy >= 0 ? '+' : ''}${r.yoy.toFixed(1)}%` : '-',
          }
          if (detailDim === 'detail') {
            const d = r.detail
            return {
              company: d ? getDisplayName(d.companyCode, d.companyName) : r.label,
              category: d?.categoryName ?? '',
              ...base,
            }
          }
          return { label: r.label, ...base }
        }),
      })
    } finally {
      setExporting(false)
    }
  }

  /** 打开行级单项分析抽屉（公司×品类明细模式）：品类为静态科目，指标上下文映射与指标页静态口径一致 */
  const handleAnalyze = (row: ViewRow) => {
    const d = row.detail
    if (!period || !d) return
    onAnalyze({
      companyCode: d.companyCode,
      companyName: d.companyName,
      subjectCode: d.categoryCode,
      subjectName: d.categoryName,
      subjectType: 'static',
      valueType: 'amount',
      // 库存分析不依赖全年预算：抽屉不展示预算/达成率，metricContext 不含 budget/achievement
      showBudget: false,
      fiscalYear: period.slice(0, 4),
      period,
      // 静态科目 → MetricValue：本期→actual、同期→samePeriod、年初→budget/ytd、上年年初→samePeriodYtd（budget/ytd 槽为年初金额占位，非预算数据）
      metric: { budget: d.yearStart, actual: d.current, samePeriod: d.samePeriod, ytd: d.yearStart, samePeriodYtd: d.lastYearStart },
    })
  }

  return (
    <>
      {/* 控制层：明细表工具条（维度切换 / 搜索 / 导出 / 选中操作，筛选卡） */}
      <Card className="rounded-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={detailDim} onValueChange={(v) => setDetailDim(v as DetailDim)}>
          <SelectTrigger className="h-8 w-[140px]" aria-label="明细表维度切换">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="company">按公司汇总</SelectItem>
            <SelectItem value="category">按品类展开</SelectItem>
            <SelectItem value="detail">公司×品类明细</SelectItem>
          </SelectContent>
        </Select>
        {selected.size > 0 && (
          <>
            <span className="text-xs text-muted-foreground">已选 <span className="font-num">{selected.size}</span> 行</span>
            <Button variant="outline" size="sm" disabled={exporting || selectedRows.length === 0} onClick={() => doExport(selectedRows, '_选中')}>
              <Download className="mr-1 h-3.5 w-3.5" />
              导出选中
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>取消选择</Button>
          </>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            placeholder="搜索公司 / 品类"
            aria-label="搜索公司或品类"
            className="h-8 w-full pl-8 sm:w-[200px]"
          />
        </div>
        <Button variant="outline" size="sm" disabled={exporting || loading || visibleRows.length === 0} onClick={() => doExport(visibleRows)}>
          <Download className="mr-1 h-3.5 w-3.5" />
          导出 Excel
        </Button>
      </div>
      </Card>

      {/* 展示层：明细表（表格卡） */}
      <Card className="animate-fade-in overflow-hidden rounded-card border border-border">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            {DIM_TITLES[detailDim]}
            <span className="ml-1 text-xs font-normal text-muted-foreground">{period ?? ''}</span>
          </h3>
          {categoryCode && (
            <span className="flex items-center gap-1">
              <Badge variant="secondary">品类：{categoryName}</Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                aria-label="清除品类筛选"
                onClick={() => setInventory({ categoryCode: '' })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </span>
          )}
        </div>
        <div>
          {loading ? (
            <div className="space-y-2 py-2" aria-label="加载中">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton h-8 w-full rounded" />
              ))}
            </div>
          ) : isError ? (
            <QueryError
              message={error instanceof Error ? error.message : undefined}
              onRetry={onRetry}
              fetching={fetching}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Package}
              title={DIM_EMPTY_TITLES[detailDim]}
              description={DIM_EMPTY_HINTS[detailDim]}
              compact
              className="py-12"
            />
          ) : visibleRows.length === 0 ? (
            <EmptyState
              icon={Search}
              title="无匹配结果"
              description={DIM_SEARCH_EMPTY_HINTS[detailDim]}
              compact
              className="py-12"
            />
          ) : (
            <div
              role="region"
              aria-label={DIM_REGION_LABELS[detailDim]}
              tabIndex={0}
              className={cn('max-h-[520px] overflow-auto transition-opacity duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', fetching && 'opacity-60')}
            >
              <table className="w-full min-w-[880px] text-sm">
                <thead className="sticky top-0 z-[2] bg-card">
                  <tr className="border-b bg-muted/50 text-center text-foreground">
                    <th className="sticky left-0 z-[3] w-9 bg-card px-2 py-2">
                      <Checkbox
                        size="sm"
                        aria-label="全选当前筛选结果"
                        className="cursor-pointer"
                        checked={allVisibleSelected}
                        onCheckedChange={toggleAll}
                      />
                    </th>
                    <th className="sticky left-9 z-[3] whitespace-nowrap bg-card px-2 py-2 font-medium">
                      {detailDim === 'category' ? '品类' : '公司'}
                    </th>
                    {detailDim === 'detail' && <th className="px-2 py-2 font-medium">品类</th>}
                    <SortableTh label="本期金额" sortKey="current" sort={sort} onSort={cycleSort} />
                    <SortableTh label="年初金额" sortKey="yearStart" sort={sort} onSort={cycleSort} />
                    <SortableTh label="较年初" sortKey="vsYearStart" sort={sort} onSort={cycleSort} />
                    <SortableTh label="同期金额" sortKey="samePeriod" sort={sort} onSort={cycleSort} />
                    <SortableTh label="同比" sortKey="yoy" sort={sort} onSort={cycleSort} />
                    {canAnalyze && detailDim !== 'category' && <th className="px-2 py-2 font-medium">操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.key} className="group border-b last:border-0 hover:bg-muted/50">
                      <td className="sticky left-0 z-[1] w-9 bg-card px-2 py-2 text-center transition-colors group-hover:bg-muted">
                        <Checkbox
                          size="sm"
                          aria-label={`选择 ${row.label}`}
                          className="cursor-pointer"
                          checked={selected.has(row.key)}
                          onCheckedChange={() => toggleOne(row.key)}
                        />
                      </td>
                      <td className="sticky left-9 z-[1] max-w-[180px] truncate bg-card px-2 py-2 text-xs transition-colors group-hover:bg-muted" title={row.label}>
                        {row.label}
                      </td>
                      {detailDim === 'detail' && <td className="px-2 py-2">{row.detail?.categoryName}</td>}
                      <td className="px-2 py-2 text-right font-num">{formatMoneyWan(row.current)}</td>
                      <td className="px-2 py-2 text-right font-num">{formatMoneyWan(row.yearStart)}</td>
                      <td className="px-2 py-2 text-right"><ChangeRate current={row.current} base={row.yearStart} /></td>
                      <td className="px-2 py-2 text-right font-num">{formatMoneyWan(row.samePeriod)}</td>
                      <td className="px-2 py-2 text-right">
                        {row.samePeriod ? (
                          <span className={cn('font-num', getChangeColor(row.yoy))}>{row.yoy === 0 ? '-' : `${getChangePrefix(row.yoy)}${Math.abs(row.yoy).toFixed(1)}%`}</span>
                        ) : (
                          <span className="font-num text-muted-foreground">-</span>
                        )}
                      </td>
                      {canAnalyze && detailDim !== 'category' && (
                        <td className="px-2 py-2 text-center">
                          {detailDim === 'company' ? (
                            // 按公司汇总：公司级分析（存货根科目）；静态树未就绪时禁用
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={companyAnalyzeDisabled} onClick={() => onAnalyzeCompany(row)}>
                              <FileText className="mr-1 h-3.5 w-3.5" />
                              分析
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleAnalyze(row)}>
                              <FileText className="mr-1 h-3.5 w-3.5" />
                              分析
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="sticky bottom-0 z-[2] border-t bg-secondary font-medium">
                    <td className="sticky left-0 z-[3] w-9 bg-secondary px-2 py-2" />
                    <td className="sticky left-9 z-[3] whitespace-nowrap bg-secondary px-2 py-2 text-xs">
                      {detailDim === 'detail' ? '合计' : `合计（${visibleRows.length} 行）`}
                    </td>
                    {detailDim === 'detail' && <td className="px-2 py-2 text-xs text-muted-foreground">{visibleRows.length} 行</td>}
                    <td className="px-2 py-2 text-right font-num">{formatMoneyWan(totals.current)}</td>
                    <td className="px-2 py-2 text-right font-num">{formatMoneyWan(totals.yearStart)}</td>
                    <td className="px-2 py-2 text-right"><ChangeRate current={totals.current} base={totals.yearStart} /></td>
                    <td className="px-2 py-2 text-right font-num">{formatMoneyWan(totals.samePeriod)}</td>
                    <td className="px-2 py-2 text-right"><ChangeRate current={totals.current} base={totals.samePeriod} /></td>
                    {canAnalyze && detailDim !== 'category' && <td className="px-2 py-2" />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </Card>
    </>
  )
}
