import { useCallback, useEffect, useMemo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MonthPicker } from '@/components/ui/month-picker'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CompanyMultiSelect } from '@/components/filters/company-select'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { usePermission } from '@/hooks/usePermission'
import { useCompanies, useCrossTable, useAvailablePeriods } from '@/hooks/api-queries'
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
} from 'lucide-react'

type CrossRow = { code: string; name: string; valueType?: 'amount' | 'quantity' | 'ratio'; level: number; parentCode: string | null; isLeaf: boolean; values: Record<string, number> }

/**
 * 数据管理 · 数据预览：指标 × 公司的交叉表浏览（多层级展开、全部展开/折叠、
 * 期间/公司/指标类型筛选、Excel 导出）。导入操作在 /data/import 独立页面。
 */
export default function DataBrowsePage() {
  const { can } = usePermission()
  const canExport = can('data', 'export')
  // 吸顶测量：标题区 + 筛选卡高度实时测量，驱动筛选卡/表格容器吸顶偏移
  const { headerRef, filterRef, headerHeight, filterHeight } = useStickyHeader()
  const stickyTop = headerHeight + filterHeight
  // 公司多选：空数组语义为「全部公司」；查询条件与展开状态持久化到 pageStateStore（路由切换/刷新后恢复）
  const setDataBrowse = usePageStore((s) => s.setDataBrowse)
  const browseCompanies = usePageStore((s) => s.dataBrowse.companies)
  const browsePeriod = usePageStore((s) => s.dataBrowse.period)
  const browseSubjectType = usePageStore((s) => s.dataBrowse.subjectType)
  const expandedRows = usePageStore((s) => s.dataBrowse.expandedRows)
  const setBrowseCompanies = useCallback((v: string[]) => setDataBrowse({ companies: v }), [setDataBrowse])
  const setBrowsePeriod = useCallback((v: string) => setDataBrowse({ period: v }), [setDataBrowse])
  const setBrowseSubjectType = useCallback((v: 'operating' | 'static') => setDataBrowse({ subjectType: v }), [setDataBrowse])
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
        // 按科目值类型渲染：金额千分位 / 数量整数 / 比率百分比
        render: (r) => formatMetricValue(r.values[code] ?? 0, r.valueType),
      })
    }
    return cols
  }, [visibleCompanyCodes, displayNameMap, hasChildrenSet, expandedRowSet, toggleRowExpand])

  const handleBrowseExport = async () => {
    const rows = (crossTable?.rows ?? []).map((r) => {
      const row: Record<string, unknown> = { name: r.name }
      for (const code of visibleCompanyCodes) row[code] = Number((r.values[code] ?? 0).toFixed(2))
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
  }

  return (
    <PageContainer title="数据预览" description="数据预览（指标 × 公司交叉表）" stickyHeader headerRef={headerRef}>
      <div className="space-y-4">
        {/* 控制层：数据预览筛选工具条（筛选卡，吸顶） */}
        <Card ref={filterRef} className="sticky z-10 rounded-card p-4" style={{ top: headerHeight }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={browseSubjectType} onValueChange={(v) => { setBrowseSubjectType(v as 'operating' | 'static'); setExpandedRows(() => new Set()) }}>
              <SelectTrigger className="w-[140px] max-w-full shrink-0">
                <SelectValue placeholder="指标类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operating">经营指标</SelectItem>
                <SelectItem value="static">静态指标</SelectItem>
              </SelectContent>
            </Select>
            <CompanyMultiSelect value={browseCompanies} onChange={setBrowseCompanies} entitiesOnly className="w-[200px]" />
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
              <Button variant="outline" size="sm" onClick={handleBrowseExport}>
                <Download className="mr-2 h-4 w-4" />
                导出
              </Button>
            )}
          </div>
        </div>
        </Card>

        {/* 展示层：数据预览交叉表（表格卡，表格容器吸顶） */}
        <Card className="rounded-card border border-border">
          <div className="border-b px-4 py-2.5">
            <h3 className="text-base font-semibold tracking-tight">数据预览（{browseSubjectType === 'operating' ? '经营指标' : '静态指标'} × 公司{crossTable?.period ? ` · ${crossTable.period}` : ''}）</h3>
          </div>
          <div className="p-4">
            {crossLoading ? (
              <div className="min-h-[320px] py-12 text-center text-sm text-muted-foreground">数据加载中…</div>
            ) : (
              <div className={cn('min-h-[320px] transition-opacity duration-200', crossFetching && 'opacity-60')}>
                <div className="sticky rounded-card bg-background" style={{ top: stickyTop }}>
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
