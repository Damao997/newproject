import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MonthPicker } from '@/components/ui/month-picker'
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
import { ReclassifyCompanyDialog } from '@/components/reclassify/reclassify-company-dialog'
import { ReclassifySubjectDialog } from '@/components/reclassify/reclassify-subject-dialog'
import { ReclassifyLogsPanel } from '@/components/reclassify/reclassify-logs-panel'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { FormulaMaintenance } from './formula-maintenance'
import { ImportPanel } from './import-panel'

export default function DataPage() {
  const { can } = usePermission()
  const canExport = can('data', 'export')
  // 高危操作（仅 superadmin 持有对应权限码）
  const canPurgeMetric = can('data:metric', 'purge')
  const canApproveMetric = can('data:metric', 'approve')
  const canConvertMetric = can('data:metric', 'convert')
  const canReclassifyCompany = can('data:reclassify', 'company')
  const canReclassifySubject = can('data:reclassify', 'subject')

  const [activeTab, setActiveTab] = useState('manage')

  // 数据编辑入口：复用重分类/科目调整通道（校验、预览影响、二次确认、审计留痕均在对话框内）
  const [adjustSubjectOpen, setAdjustSubjectOpen] = useState(false)
  const [reclassifyCompanyOpen, setReclassifyCompanyOpen] = useState(false)

  // ---- 数据浏览（交叉表：指标 × 公司，支持多层级展开）----
  // 公司多选：空数组语义为「全部公司」
  const [browseCompanies, setBrowseCompanies] = useState<string[]>([])
  const [browsePeriod, setBrowsePeriod] = useState('')
  const [browseSubjectType, setBrowseSubjectType] = useState<'operating' | 'static'>('operating')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const { data: companies } = useCompanies()
  const { data: periodsData } = useAvailablePeriods()
  // 期间候选按全局选中财年过滤
  const dynamicPeriods = useMemo(
    () => filterPeriodsByFiscalYear(periodsData?.periods ?? [], fiscalYear, periodsData?.fiscalStartMonth ?? 1),
    [periodsData, fiscalYear],
  )
  const crossParams = useMemo(() => ({
    ...(browsePeriod ? { period: browsePeriod } : {}),
    subjectType: browseSubjectType,
  }), [browsePeriod, browseSubjectType])
  const { data: crossTable, isLoading: crossLoading, isFetching: crossFetching } = useCrossTable(crossParams)

  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  // 全称映射仅用于 Excel 导出（正式文件用全称）；屏幕展示统一走 displayNameMap（跟随「显示简称」开关）
  const companyNameMap = useMemo(() => new Map((companies ?? []).map((c) => [c.code, c.name])), [companies])
  const { displayNameMap } = useCompanyDisplayName()

  // 交叉表列：未勾选时展示全部公司，否则按交叉表返回顺序过滤已选公司
  const visibleCompanyCodes = useMemo(() => {
    const all = crossTable?.companies ?? []
    return browseCompanies.length === 0 ? all : all.filter((c) => browseCompanies.includes(c))
  }, [crossTable, browseCompanies])

  // 公司多选触发按钮文案：全部 / 单选名称 / 首选名称 等 N 家
  const companyTriggerLabel = useMemo(() => {
    if (browseCompanies.length === 0) return '全部公司'
    const firstName = displayNameMap.get(browseCompanies[0]) ?? browseCompanies[0]
    return browseCompanies.length === 1 ? firstName : `${firstName} 等 ${browseCompanies.length} 家`
  }, [browseCompanies, displayNameMap])

  // 编辑对话框预填：公司多选恰好只选 1 家时预填该公司
  const singleBrowseCompany = browseCompanies.length === 1 ? browseCompanies[0] : undefined

  const toggleBrowseCompany = (code: string, checked: boolean) => {
    setBrowseCompanies((prev) => (checked ? [...prev, code] : prev.filter((c) => c !== code)))
  }

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
        if (!expandedRows.has(p)) return false
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
  const isAllRowsExpanded = hasChildrenSet.size > 0 && [...hasChildrenSet].every((code) => expandedRows.has(code))

  const toggleExpandAllRows = () =>
    setExpandedRows(isAllRowsExpanded ? new Set() : new Set(hasChildrenSet))

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
                title={expandedRows.has(r.code) ? '收起下级科目' : '展开下级科目'}
                onClick={(e) => { e.stopPropagation(); toggleRowExpand(r.code) }}
              >
                {expandedRows.has(r.code) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
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
  }, [visibleCompanyCodes, displayNameMap, hasChildrenSet, expandedRows, toggleRowExpand])

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
      <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in">
        <TabsList>
          <TabsTrigger value="manage">数据管理</TabsTrigger>
          <TabsTrigger value="reclassify">重分类记录</TabsTrigger>
          <TabsTrigger value="dimensions">维度/科目体系</TabsTrigger>
          <TabsTrigger value="formulas">公式维护</TabsTrigger>
        </TabsList>

        <TabsContent value="manage" className="space-y-4">
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
                  <Select value={browseSubjectType} onValueChange={(v) => { setBrowseSubjectType(v as 'operating' | 'static'); setExpandedRows(new Set()) }}>
                    <SelectTrigger className="w-[140px] max-w-full shrink-0">
                      <SelectValue placeholder="指标类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="operating">经营指标</SelectItem>
                      <SelectItem value="static">静态指标</SelectItem>
                    </SelectContent>
                  </Select>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="h-9 w-[200px] max-w-full shrink-0 justify-between px-3 font-normal">
                        <span className="truncate">{companyTriggerLabel}</span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="max-h-[320px] w-[220px] overflow-y-auto">
                      <DropdownMenuItem
                        className="text-xs text-muted-foreground"
                        onSelect={(e) => { e.preventDefault(); setBrowseCompanies(entityCompanies.map((c) => c.code)) }}
                      >
                        全选
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-xs text-muted-foreground"
                        onSelect={(e) => { e.preventDefault(); setBrowseCompanies([]) }}
                      >
                        清空（全部公司）
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {entityCompanies.map((company) => (
                        <DropdownMenuCheckboxItem
                          key={company.code}
                          checked={browseCompanies.includes(company.code)}
                          onCheckedChange={(checked) => toggleBrowseCompany(company.code, checked === true)}
                          onSelect={(e) => e.preventDefault()}
                        >
                          {displayNameMap.get(company.code) ?? company.name}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="flex shrink-0 items-center space-x-2">
                    <span className="text-sm text-muted-foreground">月份:</span>
                    <MonthPicker value={browsePeriod} onChange={setBrowsePeriod} availablePeriods={dynamicPeriods ?? []} />
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
                  {canReclassifySubject && (
                    <Button variant="outline" size="sm" onClick={() => setAdjustSubjectOpen(true)}>
                      <ArrowLeftRight className="mr-2 h-4 w-4" />
                      科目调整
                    </Button>
                  )}
                  {canReclassifyCompany && (
                    <Button variant="outline" size="sm" onClick={() => setReclassifyCompanyOpen(true)}>
                      <ArrowLeftRight className="mr-2 h-4 w-4" />
                      跨公司重分类
                    </Button>
                  )}
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
        </TabsContent>

        <TabsContent value="reclassify" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                <span>重分类记录</span>
                <span className="flex items-center gap-2">
                  {canReclassifySubject && (
                    <Button variant="outline" size="sm" onClick={() => setAdjustSubjectOpen(true)}>
                      <ArrowLeftRight className="mr-2 h-4 w-4" />
                      科目调整
                    </Button>
                  )}
                  {canReclassifyCompany && (
                    <Button variant="outline" size="sm" onClick={() => setReclassifyCompanyOpen(true)}>
                      <ArrowLeftRight className="mr-2 h-4 w-4" />
                      跨公司重分类
                    </Button>
                  )}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ReclassifyLogsPanel canRevert={canReclassifyCompany} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dimensions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>维度/科目体系</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="operating" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="operating">经营分析科目</TabsTrigger>
                  <TabsTrigger value="static">静态科目</TabsTrigger>
                  <TabsTrigger value="company">公司</TabsTrigger>
                  <TabsTrigger value="summary">汇总主体</TabsTrigger>
                </TabsList>
                <TabsContent value="operating">
                  <SubjectTreePanel
                    type="operating"
                    canCreate={can('data:subject', 'create')}
                    canUpdate={can('data:subject', 'update')}
                    canDelete={can('data:subject', 'delete')}
                    canExport={canExport}
                    exportFileName="经营分析科目"
                    exportSheet="经营分析科目"
                    countSuffix="（level0-level4）"
                  />
                </TabsContent>
                <TabsContent value="static">
                  <SubjectTreePanel
                    type="static"
                    canCreate={can('data:subject', 'create')}
                    canUpdate={can('data:subject', 'update')}
                    canDelete={can('data:subject', 'delete')}
                    canExport={canExport}
                    exportFileName="静态科目"
                    exportSheet="静态科目"
                    countSuffix="（level0-level1）"
                  />
                </TabsContent>
                <TabsContent value="company">
                  <CompanyPanel
                    canCreate={can('data:company', 'create')}
                    canUpdate={can('data:company', 'update')}
                    canDelete={can('data:company', 'delete')}
                  />
                </TabsContent>
                <TabsContent value="summary">
                  <AggregationMapPanel canUpdate={can('data:company', 'update')} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="formulas" className="space-y-4">
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
        </TabsContent>
      </Tabs>

      {/* 同公司科目间调整（预填当前指标类型与单选公司） */}
      <ReclassifySubjectDialog
        key={`adjust-${browseSubjectType}-${singleBrowseCompany ?? 'all'}`}
        open={adjustSubjectOpen}
        onClose={() => setAdjustSubjectOpen(false)}
        defaultTemplateType={browseSubjectType}
        defaultCompany={singleBrowseCompany}
      />

      {/* 跨公司重分类（预填当前指标类型与单选源公司） */}
      <ReclassifyCompanyDialog
        key={`reclassify-${browseSubjectType}-${singleBrowseCompany ?? 'all'}`}
        open={reclassifyCompanyOpen}
        onClose={() => setReclassifyCompanyOpen(false)}
        defaultTemplateType={browseSubjectType}
        defaultSourceCompany={singleBrowseCompany}
      />
    </PageContainer>
  )
}
