import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MonthPicker } from '@/components/ui/month-picker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CompanyMultiSelect } from '@/components/filters/company-select'
import { PageContainer } from '@/components/layout/page-container'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { usePermission } from '@/hooks/usePermission'
import { useCompanies, useCrossTable, useAvailablePeriods } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { exportToExcel } from '@/lib/export'
import { formatMetricValue, cn } from '@/lib/utils'
import {
  Download,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ArrowLeftRight,
} from 'lucide-react'
import { SubjectTreePanel } from '@/components/subject-tree/subject-tree-panel'
import { CompanyPanel } from '@/components/dimension/company-panel'
import { AggregationMapPanel } from '@/components/dimension/aggregation-map-panel'
import { ProductCategoryPanel } from '@/components/dimension/product-category-panel'
import { ExpenseMappingPanel } from '@/components/dimension/expense-mapping-panel'
import { SubjectBudgetPanel } from '@/components/dimension/subject-budget-panel'
import { BudgetRatioPanel } from '@/components/dimension/budget-ratio-panel'
import { ReclassifyCompanyDialog } from '@/components/reclassify/reclassify-company-dialog'
import { ReclassifySubjectDialog } from '@/components/reclassify/reclassify-subject-dialog'
import { ReclassifyLogsPanel } from '@/components/reclassify/reclassify-logs-panel'
import { ReadonlyLogMeta, type ReclassifyLogMeta } from '@/components/reclassify/shared'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ReclassifyLog } from '@/types'
import { ConsolidationAdjustDialog } from '@/components/reclassify/consolidation-adjust-dialog'
import { ConsolidationAdjustmentsPanel } from '@/components/reclassify/consolidation-adjustments-panel'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'
import { FormulaMaintenance } from './formula-maintenance'
import { ImportPanel } from './import-panel'

// 页面子标签（与侧边栏二级菜单 ?tab= 参数对应）
const DATA_TABS = ['manage', 'reclassify', 'dimensions', 'board', 'formulas'] as const
type DataTab = (typeof DATA_TABS)[number]

// 「维度/科目体系」内部三级子标签（与侧边栏三级菜单 &sub= 参数对应）
const DIM_SUB_TABS = ['operating', 'static', 'company', 'summary'] as const
type DimSubTab = (typeof DIM_SUB_TABS)[number]

// 「看板管理」内部三级子标签（品类配置 / 运营费用映射 / 主体配置 / 月度预算比例，从科目体系拆出）
const BOARD_SUB_TABS = ['category', 'expense', 'subject', 'budget-ratio'] as const
type BoardSubTab = (typeof BOARD_SUB_TABS)[number]

/** 数据调整入口（科目调整 / 跨公司重分类 / 汇总抵消）：按权限码显隐，两个 Tab 复用 */
function ReclassifyMenu({ canSubject, canCompany, onSubject, onCompany, onConsolidation }: {
  canSubject: boolean
  canCompany: boolean
  onSubject: () => void
  onCompany: () => void
  onConsolidation: () => void
}) {
  if (!canSubject && !canCompany) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="数据调整">
          <ArrowLeftRight className="mr-2 h-4 w-4" />
          数据调整
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {canSubject && (
          <DropdownMenuItem onClick={onSubject}>科目调整</DropdownMenuItem>
        )}
        {canCompany && (
          <DropdownMenuItem onClick={onCompany}>跨公司重分类</DropdownMenuItem>
        )}
        {canCompany && (
          <DropdownMenuItem onClick={onConsolidation}>汇总抵消调整</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function DataPage() {
  const { can } = usePermission()
  // 子标签由 URL ?tab= 驱动（默认数据管理），与侧边栏二级菜单联动
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  // 「维度/科目体系」内部三级子标签由 &sub= 驱动（默认经营分析科目），与侧边栏三级菜单联动；
  // 从 URL 直接派生而非 useState，保证导航三级菜单点击后页面立即联动
  const subParam = searchParams.get('sub')
  const dimSubTab: DimSubTab = DIM_SUB_TABS.includes(subParam as DimSubTab)
    ? (subParam as DimSubTab)
    : 'operating'
  // 「看板管理」三级子标签同样由 &sub= 派生（非法/缺失回退品类配置）
  const boardSubTab: BoardSubTab = BOARD_SUB_TABS.includes(subParam as BoardSubTab)
    ? (subParam as BoardSubTab)
    : 'category'

  const canExport = can('data', 'export')
  // 高危操作（仅 superadmin 持有对应权限码）
  const canPurgeMetric = can('data:metric', 'purge')
  const canApproveMetric = can('data:metric', 'approve')
  const canConvertMetric = can('data:metric', 'convert')
  const canReclassifyCompany = can('data:reclassify', 'company')
  const canReclassifySubject = can('data:reclassify', 'subject')

  // 子标签由 URL ?tab= 直接派生（非 useState：同 pathname 切换 tab 时组件不重挂载，
  // 派生可保证导航菜单点击后页面立即联动；默认数据管理）
  const activeTab: DataTab = DATA_TABS.includes(tabParam as DataTab)
    ? (tabParam as DataTab)
    : 'manage'

  // URL 归一化（replace，不产生历史记录）：
  // 1. tab=dimensions/board 缺 sub 或 sub 非法 → 补/改为各自默认值，保证 URL 始终反映具体三级子项、导航高亮与页面状态一致；
  // 2. 冗余的 ?tab=manage（默认值）→ 清除 query，保证侧边栏「导入与浏览」叶子（path=/data）精确高亮。
  useEffect(() => {
    if (activeTab === 'dimensions' && !DIM_SUB_TABS.includes(subParam as DimSubTab)) {
      setSearchParams({ tab: 'dimensions', sub: 'operating' }, { replace: true })
    } else if (activeTab === 'board' && !BOARD_SUB_TABS.includes(subParam as BoardSubTab)) {
      setSearchParams({ tab: 'board', sub: 'category' }, { replace: true })
    } else if (tabParam === 'manage') {
      setSearchParams({}, { replace: true })
    }
  }, [activeTab, subParam, tabParam, setSearchParams])

  // 数据编辑入口：复用重分类/科目调整通道（校验、预览影响、二次确认、审计留痕均在对话框内）
  const [adjustSubjectOpen, setAdjustSubjectOpen] = useState(false)
  const [reclassifyCompanyOpen, setReclassifyCompanyOpen] = useState(false)
  // 重分类记录「重新应用」目标：失效/已撤销日志 → 打开对应对话框并预填原参数（key 重挂载生效）
  const [reapplyLog, setReapplyLog] = useState<ReclassifyLog | null>(null)
  // 重分类记录「只读查看」目标：点击记录行 → 打开预填原始参数的只读详情对话框
  const [viewLog, setViewLog] = useState<ReclassifyLog | null>(null)
  // 汇总抵消调整（仅作用于汇总主体口径，单体报表不受影响）
  const [consolidationOpen, setConsolidationOpen] = useState(false)

  // ---- 数据浏览（交叉表：指标 × 公司，支持多层级展开）----
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

  // 编辑对话框预填：公司多选恰好只选 1 家时预填该公司
  const singleBrowseCompany = browseCompanies.length === 1 ? browseCompanies[0] : undefined

  type CrossRow = { code: string; name: string; valueType?: 'amount' | 'quantity' | 'ratio'; level: number; parentCode: string | null; isLeaf: boolean; values: Record<string, number> }
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
    <PageContainer title="数据管理" description="管理Excel导入、数据浏览、维度科目维护">
      <div className="animate-fade-in">
        {activeTab === 'manage' && (
          <div className="space-y-4">
          {/* 数据导入 + 导入质量概览（合并紧凑单卡，内部自带权限门禁） */}
          <ImportPanel />

          {/* 数据预览交叉表 */}
          <Card>
            <CardHeader>
              <CardTitle>数据预览（{browseSubjectType === 'operating' ? '经营指标' : '静态指标'} × 公司{crossTable?.period ? ` · ${crossTable.period}` : ''}）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap items-center gap-3">
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
              {crossLoading ? (
                <div className="min-h-[320px] py-12 text-center text-sm text-muted-foreground">数据加载中...</div>
              ) : (
                <div className={cn('min-h-[320px] transition-opacity duration-200', crossFetching && 'opacity-60')}>
                  <DataTable
                    columns={browseColumns}
                    data={visibleCrossRows}
                    rowKey={(r) => r.code}
                    dense
                    maxHeight="60vh"
                    emptyText="暂无数据"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'reclassify' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                <span>重分类管理</span>
                <ReclassifyMenu
                  canSubject={canReclassifySubject}
                  canCompany={canReclassifyCompany}
                  onSubject={() => setAdjustSubjectOpen(true)}
                  onCompany={() => setReclassifyCompanyOpen(true)}
                  onConsolidation={() => setConsolidationOpen(true)}
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ReclassifyLogsPanel
                canRevert={canReclassifyCompany}
                onReapply={(log) => {
                  setReapplyLog(log)
                  if (log.type === 'company') setReclassifyCompanyOpen(true)
                  else setAdjustSubjectOpen(true)
                }}
                onViewDetail={(log) => setViewLog(log)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>汇总抵消调整记录</CardTitle>
            </CardHeader>
            <CardContent>
              <ConsolidationAdjustmentsPanel />
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'dimensions' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>维度/科目体系</CardTitle>
            </CardHeader>
            <CardContent>
              {/* 三级子标签由 URL &sub= 驱动，切换完全走侧边栏三级菜单，页面内不再显示任何 tab 标签 */}
              {dimSubTab === 'operating' && (
                <SubjectTreePanel
                  type="operating"
                  canCreate={can('data:subject', 'create')}
                  canUpdate={can('data:subject', 'update')}
                  canDelete={can('data:subject', 'delete')}
                  canConvert={canConvertMetric}
                  canExport={canExport}
                  exportFileName="经营分析科目"
                  exportSheet="经营分析科目"
                  countSuffix="（level0-level4）"
                />
              )}
              {dimSubTab === 'static' && (
                <SubjectTreePanel
                  type="static"
                  canCreate={can('data:subject', 'create')}
                  canUpdate={can('data:subject', 'update')}
                  canDelete={can('data:subject', 'delete')}
                  canConvert={canConvertMetric}
                  canExport={canExport}
                  exportFileName="静态科目"
                  exportSheet="静态科目"
                  countSuffix="（level0-level1）"
                />
              )}
              {dimSubTab === 'company' && (
                <CompanyPanel
                  canCreate={can('data:company', 'create')}
                  canUpdate={can('data:company', 'update')}
                  canDelete={can('data:company', 'delete')}
                />
              )}
              {dimSubTab === 'summary' && (
                <AggregationMapPanel canUpdate={can('data:company', 'update')} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'board' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>看板管理</CardTitle>
            </CardHeader>
            <CardContent>
              {/* 三级子标签由 URL &sub= 驱动，切完全走侧边栏三级菜单，页面内不再显示任何 tab 标签 */}
              {boardSubTab === 'category' && (
                <ProductCategoryPanel
                  canCreate={can('data:subject', 'create')}
                  canUpdate={can('data:subject', 'update')}
                  canDelete={can('data:subject', 'delete')}
                />
              )}
              {boardSubTab === 'expense' && (
                <ExpenseMappingPanel
                  canCreate={can('data:subject', 'create')}
                  canUpdate={can('data:subject', 'update')}
                  canDelete={can('data:subject', 'delete')}
                />
              )}
              {boardSubTab === 'subject' && (
                <SubjectBudgetPanel
                  canCreate={can('data:subject', 'create')}
                  canUpdate={can('data:subject', 'update')}
                  canDelete={can('data:subject', 'delete')}
                />
              )}
              {boardSubTab === 'budget-ratio' && (
                <BudgetRatioPanel canUpdate={can('data:subject', 'update')} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'formulas' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>公式维护</CardTitle>
            </CardHeader>
            <CardContent>
              <FormulaMaintenance
                canCreate={can('data:metric', 'create')}
                canUpdate={can('data:metric', 'update')}
                canDelete={can('data:metric', 'delete')}
                canApprove={canApproveMetric}
                canPurge={canPurgeMetric}
                canConvert={canConvertMetric}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>

      {/* 日志 → 对话框预填参数与只读元信息（company/subject_adjust 共用；subject 换父类型无表单参数） */}
      {(() => {
        const log = viewLog ?? reapplyLog
        const templateTypeOf = (l: ReclassifyLog): 'operating' | 'static' | 'budget' =>
          l.templateType === 'static' || l.templateType === 'budget' ? l.templateType : 'operating'
        const metaOf = (l: ReclassifyLog): ReclassifyLogMeta => ({
          operator: l.operator,
          createdAt: l.createdAt,
          affectedRows: l.affectedRows,
          revertedAt: l.revertedAt,
          revertedBy: l.revertedBy,
          invalidatedAt: l.invalidatedAt,
          invalidatedReason: l.invalidatedReason,
          invalidation: l.invalidation,
        })
        const closeLog = () => { setReapplyLog(null); setViewLog(null) }
        return (
          <>
            {/* 同公司科目间调整（编辑/重新应用/只读查看共用；key 重挂载使 preset 生效） */}
            <ReclassifySubjectDialog
              key={`adjust-${browseSubjectType}-${singleBrowseCompany ?? 'all'}-${log?.id ?? 'none'}`}
              open={adjustSubjectOpen}
              onClose={() => { setAdjustSubjectOpen(false); closeLog() }}
              defaultTemplateType={browseSubjectType}
              defaultCompany={singleBrowseCompany}
              preset={log?.type === 'subject_adjust' ? {
                templateType: templateTypeOf(log),
                companyCode: log.sourceCompany ?? '',
                adjustMode: log.detail?.adjustMode ?? 'both',
                sourceAccountCode: log.sourceSubject ?? undefined,
                targetAccountCode: log.targetSubject ?? undefined,
                decreaseAmount: log.detail?.decreaseAmount ?? undefined,
                increaseAmount: log.detail?.increaseAmount ?? undefined,
                period: log.period ?? log.periodFrom ?? '',
                reason: log.detail?.reason ?? '',
              } : undefined}
              readonly={!!viewLog}
              meta={viewLog ? metaOf(viewLog) : undefined}
            />

            {/* 跨公司重分类（编辑/重新应用/只读查看共用；key 重挂载使 preset 生效） */}
            <ReclassifyCompanyDialog
              key={`reclassify-${browseSubjectType}-${singleBrowseCompany ?? 'all'}-${log?.id ?? 'none'}`}
              open={reclassifyCompanyOpen}
              onClose={() => { setReclassifyCompanyOpen(false); closeLog() }}
              defaultTemplateType={browseSubjectType}
              defaultSourceCompany={singleBrowseCompany}
              preset={log?.type === 'company' ? {
                templateType: templateTypeOf(log),
                sourceCompanyCode: log.sourceCompany ?? '',
                targetCompanyCode: log.targetCompany ?? '',
                transferMode: log.detail?.transferMode ?? 'all',
                ratio: log.detail?.ratio ?? undefined,
                amount: log.detail?.amount ?? undefined,
                period: log.period ?? log.periodFrom ?? '',
                accountCodes: log.detail?.accountCodes ?? [],
              } : undefined}
              readonly={!!viewLog}
              meta={viewLog ? metaOf(viewLog) : undefined}
            />

            {/* 科目归类（换父）记录：无调整表单，仅只读展示操作留痕 */}
            <Dialog open={!!viewLog && viewLog.type === 'subject'} onOpenChange={(o) => !o && setViewLog(null)}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>科目归类调整详情</DialogTitle>
                  <DialogDescription>
                    科目归类调整（换父）在科目树中执行，此处仅展示操作留痕
                    {viewLog?.type === 'subject' && <ReadonlyLogMeta meta={metaOf(viewLog)} />}
                  </DialogDescription>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">请在「维度/科目体系」的科目树中查看该科目的当前归属与调整历史。</p>
              </DialogContent>
            </Dialog>
          </>
        )
      })()}

      {/* 汇总抵消调整（仅作用于汇总主体口径，单体报表不受影响） */}
      <ConsolidationAdjustDialog
        open={consolidationOpen}
        onClose={() => setConsolidationOpen(false)}
      />
    </PageContainer>
  )
}
