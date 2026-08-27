import { useCallback, useEffect, useMemo, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MonthPicker } from '@/components/ui/month-picker'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Collapsible } from '@/components/ui/collapsible'
import { FlashMessage } from '@/components/ui/flash-message'
import { CompanyMultiSelect } from '@/components/filters/company-select'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { IMPORT_TABS } from '@/components/layout/module-tabs'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { usePermission } from '@/hooks/usePermission'
import { useCompanies, useCrossTable, useAvailablePeriods, type CrossTable } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { exportToExcel } from '@/lib/export'
import { formatMetricValue, cn } from '@/lib/utils'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'
import {
  Download,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Filter,
  Loader2,
} from 'lucide-react'

/** 交叉表行：共享类型（数据源头 CrossTable.rows，含 dataType/valueType 供 display 掩码与分型格式化） */
type CrossRow = CrossTable['rows'][number]

/**
 * 数据管理 · 数据预览：指标 × 公司的交叉表浏览（多层级展开、全部展开/折叠、
 * 期间/公司/指标类型筛选、Excel 导出）。导入操作在 /data/import 独立页面。
 */
export default function DataBrowsePage() {
  const { can } = usePermission()
  const canExport = can('data', 'export')
  // 导出 loading + 结果反馈（成功/失败，自动消失）
  const [exporting, setExporting] = useState(false)
  const [exportFlash, setExportFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // 吸顶测量：标题区 + 筛选卡高度实时测量，驱动筛选卡/表格容器吸顶偏移
  const { headerRef, filterRef, headerHeight, filterHeight } = useStickyHeader()
  const stickyTop = headerHeight + filterHeight
  // 公司多选：空数组语义为「全部公司」；查询条件与展开状态持久化到 pageStateStore（路由切换/刷新后恢复）
  const setDataBrowse = usePageStore((s) => s.setDataBrowse)
  const browseCompanies = usePageStore((s) => s.dataBrowse.companies)
  const browsePeriod = usePageStore((s) => s.dataBrowse.period)
  const browseSubjectType = usePageStore((s) => s.dataBrowse.subjectType)
  const expandedRows = usePageStore((s) => s.dataBrowse.expandedRows)
  const browseFilterCollapsed = usePageStore((s) => s.dataBrowse.filterCollapsed)
  const setBrowseCompanies = useCallback((v: string[]) => setDataBrowse({ companies: v }), [setDataBrowse])
  const setBrowsePeriod = useCallback((v: string) => setDataBrowse({ period: v }), [setDataBrowse])
  const setBrowseSubjectType = useCallback((v: 'operating' | 'static' | 'cashflow') => setDataBrowse({ subjectType: v }), [setDataBrowse])
  const setBrowseFilterCollapsed = useCallback((v: boolean) => setDataBrowse({ filterCollapsed: v }), [setDataBrowse])
  // 展开集合由持久化数组派生（Set 不可序列化，store 以数组存储）
  const expandedRowSet = useMemo(() => new Set(expandedRows), [expandedRows])
  const setExpandedRows = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    const prev = new Set(usePageStore.getState().dataBrowse.expandedRows)
    usePageStore.getState().setDataBrowse({ expandedRows: [...updater(prev)] })
  }, [])
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const { data: companies } = useCompanies()
  // 持久化公司多选校验：编码已删除/越权时过滤，全部失效则回退全部公司（候选加载后生效，用户手动切换后不再覆盖）
  useEffect(() => {
    if (!companies || companies.length === 0) return
    const valid = new Set(companies.map((c) => c.code))
    const cur = usePageStore.getState().dataBrowse.companies
    if (cur.length === 0) return
    const filtered = cur.filter((c) => valid.has(c))
    if (filtered.length !== cur.length) setBrowseCompanies(filtered)
  }, [companies, setBrowseCompanies])
  // 持久化展开行防护：科目集合本页不加载，无法按有效编码过滤，仅做长度上限保护避免无限增长
  useEffect(() => {
    const cur = usePageStore.getState().dataBrowse.expandedRows
    if (cur.length > 500) {
      usePageStore.getState().setDataBrowse({ expandedRows: cur.slice(-500) })
    }
  }, [])
  const { data: periodsData } = useAvailablePeriods()
  // 期间候选按全局选中财年过滤
  const dynamicPeriods = useMemo(
    () => filterPeriodsByFiscalYear(periodsData?.periods ?? [], fiscalYear, periodsData?.fiscalStartMonth ?? 1),
    [periodsData, fiscalYear],
  )
  // 持久化期间校验：已选期间不在候选（如财年切换）时回退跟随最新
  useEffect(() => {
    if (dynamicPeriods.length === 0) return
    if (browsePeriod && !dynamicPeriods.includes(browsePeriod)) setBrowsePeriod('')
  }, [dynamicPeriods, browsePeriod, setBrowsePeriod])
  const crossParams = useMemo(() => ({
    ...(browsePeriod ? { period: browsePeriod } : {}),
    subjectType: browseSubjectType,
  }), [browsePeriod, browseSubjectType])
  const { data: crossTable, isLoading: crossLoading, isFetching: crossFetching } = useCrossTable(crossParams)

  // 全称映射仅用于 Excel 导出（正式文件用全称）；屏幕展示统一走 displayNameMap（跟随「显示简称」开关）
  const companyNameMap = useMemo(() => new Map((companies ?? []).map((c) => [c.code, c.name])), [companies])
  const { displayNameMap } = useCompanyDisplayName()

  // 交叉表列：未勾选时展示全部公司，否则按交叉表返回顺序过滤已选公司
  const visibleCompanyCodes = useMemo(() => {
    const all = crossTable?.companies ?? []
    return browseCompanies.length === 0 ? all : all.filter((c) => browseCompanies.includes(c))
  }, [crossTable, browseCompanies])

  const crossRows = useMemo(() => (crossTable?.rows ?? []) as CrossRow[], [crossTable])

  // 多层级展开：行可见 = 其全部祖先均已展开；默认仅展示 level0
  const hasChildrenSet = useMemo(() => {
    const s = new Set<string>()
    for (const r of crossRows) if (r.parentCode) s.add(r.parentCode)
    return s
  }, [crossRows])
  const visibleCrossRows = useMemo(() => {
    const byCode = new Map(crossRows.map((r) => [r.code, r]))
    return crossRows.filter((r) => {
      let p = r.parentCode
      let guard = 0
      while (p && guard < 20) {
        if (!expandedRowSet.has(p)) return false
        p = byCode.get(p)?.parentCode ?? null
        guard++
      }
      return true
    })
  }, [crossRows, expandedRows])
  const toggleRowExpand = useCallback((code: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }, [])

  // 是否已全部展开：用于展开/折叠切换按钮的状态判断
  const isAllRowsExpanded = hasChildrenSet.size > 0 && [...hasChildrenSet].every((code) => expandedRowSet.has(code))

  const toggleExpandAllRows = () =>
    setExpandedRows(() => (isAllRowsExpanded ? new Set() : new Set(hasChildrenSet)))

  const browseColumns: DataTableColumn<CrossRow>[] = useMemo(() => {
    const cols: DataTableColumn<CrossRow>[] = [
      {
        key: 'name', header: '指标', sticky: true,
        render: (r) => (
          <span className="flex items-center" style={{ paddingLeft: (r.level ?? 0) * 16 }}>
            {hasChildrenSet.has(r.code) ? (
              <button
                type="button"
                className="mr-1 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={expandedRowSet.has(r.code) ? '收起下级科目' : '展开下级科目'}
                onClick={(e) => { e.stopPropagation(); toggleRowExpand(r.code) }}
              >
                {expandedRowSet.has(r.code) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <span className="mr-1 inline-block w-[18px]" />
            )}
            <span className={cn((r.level ?? 0) === 0 && 'font-medium')}>{r.name}</span>
          </span>
        ),
      },
    ]
    for (const code of visibleCompanyCodes) {
      cols.push({
        key: code,
        header: displayNameMap.get(code) ?? code,
        align: 'right',
        cellClassName: 'font-num',
        // 按科目值类型渲染：金额千分位 / 数量整数 / 比率百分比；展示类（display）只读展示，值列统一渲染「—」
        render: (r) => (r.dataType === 'display' ? '—' : formatMetricValue(r.values[code] ?? 0, r.valueType)),
      })
    }
    return cols
  }, [visibleCompanyCodes, displayNameMap, hasChildrenSet, expandedRowSet, toggleRowExpand])

  const handleBrowseExport = async () => {
    if (exporting) return
    setExporting(true)
    setExportFlash(null)
    try {
      const rows = ((crossTable?.rows ?? []) as CrossRow[]).map((r) => {
        const row: Record<string, unknown> = { name: r.name }
        // 展示类（display）只读展示，导出值列统一写「—」
        for (const code of visibleCompanyCodes) row[code] = r.dataType === 'display' ? '—' : Number((r.values[code] ?? 0).toFixed(2))
        return row
      })
      await exportToExcel({
        filename: `数据明细_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: '数据明细',
        columns: [
          { header: '指标', key: 'name', width: 20 },
          ...visibleCompanyCodes.map((code) => ({ header: companyNameMap.get(code) ?? code, key: code, width: 16 })),
        ],
        rows,
      })
      setExportFlash({ type: 'success', text: `已导出 ${rows.length} 行（${visibleCompanyCodes.length} 家公司）` })
    } catch (e) {
      setExportFlash({ type: 'error', text: e instanceof Error ? e.message : '导出失败，请稍后重试' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <PageContainer
      title="数据预览"
      className="flex h-[calc(100dvh-104px)] flex-col lg:h-[calc(100dvh-112px)]"
      // 视口撑满布局（对齐财务指标页）：main 可视高 = 100dvh - Header(56px) - main pt-6(24px) - pb-6(24px)；
      // lg 断点 pb-8=32px → 112px。页面恒一屏、无全局滚动条，表格高度由 flex 链撑满；
      // 104/112 需与 main-layout.tsx 的 Header 高与 pt/pb 同步
      stickyHeader headerRef={headerRef}>
      {/* 页内 Tab：导入管理 / 数据预览 */}
      <SubPageTabs items={IMPORT_TABS} />
      <div className="flex min-h-0 flex-1 flex-col space-y-4">
        {/* 控制层：筛选条件卡（可折叠，折叠态摘要展示当前筛选值；filterRef 测高驱动表格吸顶，折叠后自动归零） */}
        <Collapsible
          open={!browseFilterCollapsed}
          onOpenChange={(o) => setBrowseFilterCollapsed(!o)}
          className="shrink-0"
          trigger={(open) => (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-card px-4 py-2.5">
              <span className="flex items-center text-sm font-semibold text-foreground">
                <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                筛选条件
              </span>
              <span className="flex items-center gap-3 text-muted-foreground">
                {/* 收起态摘要：当前筛选值一瞥（信息增量，符合设计规范） */}
                {!open && (
                  <span className="text-xs">
                    {browseSubjectType === 'operating' ? '经营指标' : browseSubjectType === 'cashflow' ? '现金流量' : '静态指标'}
                    {browseCompanies.length > 0 ? ` · ${browseCompanies.length} 家公司` : ' · 全部公司'}
                    {browsePeriod ? ` · ${browsePeriod}` : ' · 最新期间'}
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs">
                  {open ? '收起' : '展开'}
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
              </span>
            </div>
          )}
        >
        <Card ref={filterRef} className="sticky z-10 rounded-card p-4" style={{ top: headerHeight }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={browseSubjectType} onValueChange={(v) => { setBrowseSubjectType(v as 'operating' | 'static' | 'cashflow'); setExpandedRows(() => new Set()) }}>
              <SelectTrigger className="w-[140px] max-w-full shrink-0">
                <SelectValue placeholder="指标类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operating">经营指标</SelectItem>
                <SelectItem value="static">静态指标</SelectItem>
                <SelectItem value="cashflow">现金流量</SelectItem>
              </SelectContent>
            </Select>
            <CompanyMultiSelect value={browseCompanies} onChange={setBrowseCompanies} entitiesOnly />
            <div className="flex shrink-0 items-center space-x-2">
              <MonthPicker value={browsePeriod} onChange={setBrowsePeriod} availablePeriods={dynamicPeriods ?? []} placeholder="最新期间" />
            </div>
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={toggleExpandAllRows}>
              {isAllRowsExpanded ? (
                <ChevronsDownUp className="mr-2 h-4 w-4" />
              ) : (
                <ChevronsUpDown className="mr-2 h-4 w-4" />
              )}
              {isAllRowsExpanded ? '全部折叠' : '全部展开'}
            </Button>
            {canExport && (
              <Button variant="outline" size="sm" onClick={handleBrowseExport} disabled={exporting}>
                {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                {exporting ? '导出中…' : '导出'}
              </Button>
            )}
          </div>
        </div>
        </Card>
        </Collapsible>

        {/* 展示层：数据预览交叉表（表格卡，表格容器吸顶） */}
        <Card className="flex min-h-0 flex-1 flex-col rounded-card border border-border">
          <div className="border-b px-4 py-2.5">
            <h3 className="text-base font-semibold tracking-tight">数据预览</h3>
            {exportFlash && (
              <FlashMessage type={exportFlash.type} autoHideMs={4000} onAutoHide={() => setExportFlash(null)} className="mt-1">
                {exportFlash.text}
              </FlashMessage>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            {crossLoading ? (
              <div className="min-h-[320px] py-12 text-center text-sm text-muted-foreground">数据加载中…</div>
            ) : (
              <div className={cn('flex min-h-[320px] flex-1 flex-col transition-opacity duration-200', crossFetching && 'opacity-60')}>
                <div className="sticky min-h-0 flex-1 rounded-card bg-background" style={{ top: stickyTop }}>
                  <DataTable
                    columns={browseColumns}
                    data={visibleCrossRows}
                    rowKey={(r) => r.code}
                    dense
                    emptyText="暂无数据"
                    maxHeight={`calc(100dvh - ${stickyTop}px - 24px)`}
                  />
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </PageContainer>
  )
}
