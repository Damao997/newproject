import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CalendarDays,
  Calculator,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Layers,
  ListTree,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { IMPORT_TABS } from '@/components/layout/module-tabs'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'
import { MiniBarChart } from '@/components/charts/mini-bar-chart'
import {
  useAggregationMap,
  useCrossTable,
  type CrossTable,
} from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { usePermission } from '@/hooks/usePermission'
import { usePageStore } from '@/stores/pageStateStore'
import { usePeriodStore } from '@/stores/periodStore'
import { api } from '@/lib/api'
import { downloadBlob } from '@/lib/export'
import { PAGINATION } from '@/lib/constants'
import { cn, formatMetricValue } from '@/lib/utils'

type SubjectType = 'operating' | 'static' | 'cashflow'
type CrossRow = CrossTable['rows'][number]

const SUBJECT_TYPES: { value: SubjectType; label: string }[] = [
  { value: 'operating', label: '经营数据' },
  { value: 'static', label: '静态数据' },
  { value: 'cashflow', label: '现金流量' },
]

/** 非数据类行标记（calc=公式计算 / display=仅展示），提示其值不参与数据行汇总 */
const DATA_TYPE_TAG: Record<string, string> = { calc: '计算', display: '展示' }

/**
 * 数据管理 · 数据预览：科目（行）× 公司（列）交叉浏览真实指标数据。
 *
 * - 筛选：公司/期间跟随顶部 Header 全局筛选（periodStore：companyCodes null/[] = 全部公司，
 *   含汇总主体时客户端展开为成员列）+ subjectType 切换（经营/静态/现金流），
 *   subjectType 与展开行持久化到 pageStateStore；
 * - 数据：useCrossTable({ period, subjectType })，DataTable + Pagination 渲染，行点击展开 MiniBarChart 公司分布；
 * - 导出：api.exportData({ format: 'excel'|'pdf', ...筛选 }) + downloadBlob，按钮按 can('data','export') 显隐。
 */
export default function DataBrowsePage() {
  const { can } = usePermission()
  const canExport = can('data', 'export')

  // ---- 页面特有筛选（pageStateStore 持久化，路由切换/刷新后恢复）----
  const subjectType = usePageStore((s) => s.dataBrowse.subjectType)
  const expandedRows = usePageStore((s) => s.dataBrowse.expandedRows)
  const setDataBrowse = usePageStore((s) => s.setDataBrowse)

  // ---- 全局筛选：公司/期间由顶部 Header 写入（companyCodes null/[] = 全部公司，period null = 未选择）----
  const period = usePeriodStore((s) => s.period)
  const selectedCompanies = usePeriodStore((s) => s.companyCodes) ?? []

  // ---- 交叉表数据（keepPreviousData：筛选刷新保留旧表避免闪烁）----
  const { data, isLoading, isFetching } = useCrossTable({ period: period || undefined, subjectType })

  const { getDisplayName } = useCompanyDisplayName()

  // 汇总主体 → 单体成员映射：公司多选含汇总主体时客户端展开为成员列（与后端 companyCodes 展开口径一致）
  const { data: aggMap } = useAggregationMap(null)
  const summaryMembers = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of aggMap ?? []) {
      m.set(e.summaryCompanyCode, [...(m.get(e.summaryCompanyCode) ?? []), e.singleCompanyCode])
    }
    return m
  }, [aggMap])

  // 已选公司展开为单体编码集合；空数组 = 全部（null 表示不过滤）
  const selectedEntityCodes = useMemo(() => {
    if (selectedCompanies.length === 0) return null
    const set = new Set<string>()
    for (const code of selectedCompanies) {
      const members = summaryMembers.get(code)
      if (members) members.forEach((c) => set.add(c))
      else set.add(code)
    }
    return set
  }, [selectedCompanies, summaryMembers])

  const visibleCompanies = useMemo(() => {
    const all = data?.companies ?? []
    if (!selectedEntityCodes) return all
    return all.filter((c) => selectedEntityCodes.has(c))
  }, [data?.companies, selectedEntityCodes])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const dataRowCount = useMemo(() => rows.filter((r) => (r.dataType ?? 'data') === 'data').length, [rows])

  // ---- 展开行（持久化到 dataBrowse.expandedRows）：行点击展开该公司分布 MiniBarChart ----
  const expandedSet = useMemo(() => new Set(expandedRows), [expandedRows])
  const toggleRow = useCallback((code: string) => {
    const cur = usePageStore.getState().dataBrowse.expandedRows
    usePageStore.getState().setDataBrowse({
      expandedRows: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code],
    })
  }, [])

  // ---- 客户端分页（交叉表行数=科目数；筛选变化后回到第 1 页）----
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGINATION.DEFAULT_PAGE_SIZE)
  useEffect(() => {
    setPage(1)
  }, [period, subjectType, selectedCompanies])
  const pagedRows = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize])

  // ---- 列定义：科目（冻结首列，层级缩进）× 公司（显示名跟随简称开关）× 合计 ----
  const columns = useMemo<DataTableColumn<CrossRow>[]>(() => {
    const cols: DataTableColumn<CrossRow>[] = [
      {
        key: 'name',
        header: '科目',
        align: 'left',
        sticky: 'left',
        minWidth: 220,
        render: (row) => (
          <span className="flex items-center gap-1" style={{ paddingLeft: row.level * 14 }}>
            <ChevronDown
              className={cn(
                'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                !expandedSet.has(row.code) && '-rotate-90',
              )}
            />
            <span className={cn('truncate', row.level === 0 && 'font-semibold')}>{row.name}</span>
            {row.dataType && row.dataType !== 'data' && (
              <span className="shrink-0 rounded bg-muted px-1 text-[10px] leading-4 text-muted-foreground">
                {DATA_TYPE_TAG[row.dataType] ?? row.dataType}
              </span>
            )}
          </span>
        ),
      },
      ...visibleCompanies.map(
        (code): DataTableColumn<CrossRow> => ({
          key: `company:${code}`,
          header: getDisplayName(code),
          align: 'right',
          cellClassName: 'font-num',
          render: (row) => formatMetricValue(row.values[code] ?? 0, row.valueType),
        }),
      ),
      {
        key: 'total',
        header: '合计',
        align: 'right',
        cellClassName: 'font-num font-medium',
        // 行合计=同一科目跨公司求和（同量纲），列方向混合量纲不做列合计
        render: (row) =>
          formatMetricValue(visibleCompanies.reduce((sum, c) => sum + (row.values[c] ?? 0), 0), row.valueType),
      },
    ]
    return cols
  }, [visibleCompanies, getDisplayName, expandedSet])

  // 展开行内容：该公司分布横向条形图（含占比提示，格式化跟随科目值类型）
  const renderExpanded = useCallback(
    (row: CrossRow) => {
      const total = visibleCompanies.reduce((s, c) => s + (row.values[c] ?? 0), 0)
      return (
        <div className="max-w-xl py-1">
          <MiniBarChart
            data={visibleCompanies.map((code) => ({
              label: getDisplayName(code),
              value: row.values[code] ?? 0,
              hint: total > 0 ? `${(((row.values[code] ?? 0) / total) * 100).toFixed(1)}%` : undefined,
            }))}
            valueFormatter={(v) => formatMetricValue(v, row.valueType)}
          />
        </div>
      )
    },
    [visibleCompanies, getDisplayName],
  )

  // ---- 导出（can('data','export') 门禁）：api.exportData + downloadBlob ----
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const handleExport = async (format: 'excel' | 'pdf') => {
    setExporting(format)
    setExportError(null)
    try {
      const blob = await api.exportData({
        format,
        type: subjectType,
        period: period || undefined,
        companyCode: selectedCompanies.length === 1 ? selectedCompanies[0] : undefined,
      })
      await downloadBlob(blob, `data-browse-${data?.period ?? (period || 'latest')}.${format === 'excel' ? 'xlsx' : 'pdf'}`)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '导出失败，请稍后重试')
    } finally {
      setExporting(null)
    }
  }

  const handleReset = () => setDataBrowse({ subjectType: 'operating', expandedRows: [] })

  // ---- KPI 摘要（全部由当前查询结果派生，无 mock）----
  const tiles = [
    { title: '数据期间', value: data?.period ?? period ?? '—', unit: '', icon: CalendarDays },
    { title: '公司主体', value: String(visibleCompanies.length), unit: '家', icon: Building2 },
    { title: '科目行数', value: String(rows.length), unit: '行', icon: ListTree },
    { title: '数据科目', value: String(dataRowCount), unit: '个', icon: Calculator },
    { title: '数据体系', value: SUBJECT_TYPES.find((t) => t.value === subjectType)?.label ?? '—', unit: '', icon: Layers },
  ]

  return (
    <PageContainer
      title="交叉浏览"
      description="以科目 × 公司透视经营数据，支持多公司多期间对比与导出"
      actions={
        canExport ? (
          <>
            <Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => handleExport('excel')}>
              {exporting === 'excel'
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <FileSpreadsheet className="mr-2 h-4 w-4" />}
              导出 Excel
            </Button>
            <Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => handleExport('pdf')}>
              {exporting === 'pdf'
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <FileText className="mr-2 h-4 w-4" />}
              导出 PDF
            </Button>
          </>
        ) : undefined
      }
    >
      <SubPageTabs items={IMPORT_TABS} />

      {/* KPI 摘要行：当前查询结果派生 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => {
          const Icon = t.icon
          return (
            <Card key={t.title} className="rounded-card p-3.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t.title}</span>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-xl font-semibold tabular-nums text-foreground">{t.value}</span>
                {t.unit && <span className="text-xs text-muted-foreground">{t.unit}</span>}
              </div>
            </Card>
          )
        })}
      </div>

      {/* 筛选行：数据体系 + 重置（公司/期间已上收顶部 Header 全局筛选，查询随筛选自动触发） */}
      <Card className="rounded-card p-0">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">数据体系</span>
            <Select value={subjectType} onValueChange={(v) => setDataBrowse({ subjectType: v as SubjectType })}>
              <SelectTrigger className="h-9 w-[140px]" aria-label="数据体系筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBJECT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="mr-2 h-4 w-4" />重置
            </Button>
          </div>
        </div>
      </Card>

      {/* 交叉表卡片：DataTable + Pagination */}
      <Card className="rounded-card p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light px-5 py-3.5">
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            交叉表 · {SUBJECT_TYPES.find((t) => t.value === subjectType)?.label}
            {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </h3>
          <div className="text-xs text-muted-foreground">
            行=科目（{rows.length}） · 列=公司（{visibleCompanies.length}） · 期间={data?.period ?? '—'} · 点击行展开公司分布
          </div>
        </div>
        {exportError && (
          <div className="mx-5 mt-3 rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
            {exportError}
          </div>
        )}
        {selectedCompanies.length > 0 && visibleCompanies.length === 0 && rows.length > 0 && (
          <div className="mx-5 mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            所选公司在当前数据范围/期间内无数据，请调整公司筛选。
          </div>
        )}
        <div className="p-5">
          <DataTable
            columns={columns}
            data={pagedRows}
            rowKey={(row) => row.code}
            loading={isLoading}
            density="compact"
            expandedKeys={expandedSet}
            renderExpanded={renderExpanded}
            onRowClick={(row) => toggleRow(row.code)}
            caption="科目×公司交叉表"
          />
        </div>
        {rows.length > 0 && (
          <div className="px-5 pb-4">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={rows.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </Card>
    </PageContainer>
  )
}
