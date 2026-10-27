import { useState, type ReactElement } from 'react'
import { Download } from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { DASHBOARD_ANALYSIS_TABS } from '@/components/layout/module-tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { AnalysisPageSkeleton } from '@/components/ui/skeleton-blocks'
import { AnalysisFailure } from '@/components/analysis/workspace'
import { RowDimPicker } from '@/components/analysis/row-dim-picker'
import { ColDimPicker } from '@/components/analysis/col-dim-picker'
import { MetricPicker } from '@/components/analysis/metric-picker'
import { ViewManager } from '@/components/analysis/view-manager'
import { ResultTable } from '@/components/analysis/result-table'
import { useAnalysisQuery, useAvailablePeriods } from '@/hooks/api-queries'
import { isForbiddenError } from '@/lib/api'
import { analysisCsvFileName, buildAnalysisCsv, downloadCsv } from '@/lib/analysis-export'
import { usePermission } from '@/hooks/usePermission'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { ProductCategoryPanel } from '@/components/dimension/product-category-panel'
import { ProductConfigPanel } from '@/components/dimension/product-config-panel'
import { ExpenseMappingPanel } from '@/components/dimension/expense-mapping-panel'
import { SubjectBudgetPanel } from '@/components/dimension/subject-budget-panel'
import { BudgetRatioPanel } from '@/components/dimension/budget-ratio-panel'
import { resolveAnalysisViewState } from './query-state'
import type { AnalysisQuerySpec } from '@/types'

/**
 * 即席分析 / 自定义报表 工作台（技术方案 §8）。
 *
 * 分析区：自由组合「行维度 × 指标列 × 口径选项」，消费 POST /dashboard/analysis/query。
 * 配置区：就地维护映射管理（品类/产品/费用/主体/预算占比），改动即时反映到分析区 ——
 *         配置面板与「数据管理 · 映射管理」完全复用同一批组件，不另写一套 CRUD。
 *         权限显隐与后端 requirePermission 一致：CRUD 走 data:subject:*。
 */

const DEFAULT_ROW_DIM: AnalysisQuerySpec['rowDim'] = 'category'

const CONFIG_TABS: { key: string; label: string; Panel: (props: { canCreate: boolean; canUpdate: boolean; canDelete: boolean }) => ReactElement }[] = [
  { key: 'category', label: '品类配置', Panel: ProductCategoryPanel },
  { key: 'product', label: '产品配置', Panel: ProductConfigPanel },
  { key: 'expense', label: '费用映射', Panel: ExpenseMappingPanel },
  { key: 'subject', label: '主体配置', Panel: SubjectBudgetPanel },
]

export default function AnalysisWorkspacePage() {
  const period = usePeriodStore((s) => s.period)
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const codes = usePeriodStore((s) => s.companyCodes)
  const periods = useAvailablePeriods()
  const candidates = filterPeriodsByFiscalYear(periods.data?.periods ?? [], fiscalYear, periods.data?.fiscalStartMonth ?? 1)
  const currentPeriod = period || candidates.at(-1) || ''
  const multiple = (codes?.length ?? 0) > 1
  const requestedCode = codes?.length === 1 ? codes[0] : undefined

  const { can } = usePermission()
  const canCreate = can('data:subject', 'create')
  const canUpdate = can('data:subject', 'update')
  const canDelete = can('data:subject', 'delete')
  const canBrowse = can('data:browse', 'view')

  const [rowDim, setRowDim] = useState<AnalysisQuerySpec['rowDim']>(DEFAULT_ROW_DIM)
  // 列维度（矩阵模式，v2）：undefined = 单轴 v1 形态；colCodes 空数组 = 全部成员
  const [colDim, setColDim] = useState<AnalysisQuerySpec['colDim']>(undefined)
  const [colCodes, setColCodes] = useState<string[]>([])
  // 空数组 = 用该维度的默认列集（与后端 DEFAULT_METRICS 一致）
  const [metrics, setMetrics] = useState<string[]>([])
  const [keyword, setKeyword] = useState('')
  const [includeEmptyRows, setIncludeEmptyRows] = useState(false)
  const [includeTotals, setIncludeTotals] = useState(true)
  const [level, setLevel] = useState<number | null>(null)

  const spec: AnalysisQuerySpec = {
    ...(requestedCode ? { companyCode: requestedCode } : {}),
    ...(currentPeriod ? { period: currentPeriod } : {}),
    rowDim,
    ...(colDim ? { colDim, ...(colCodes.length > 0 ? { colCodes } : {}) } : {}),
    filters: { excludeReclassify: false, keyword, rowCodes: [] },
    ...(metrics.length > 0 ? { metrics } : {}),
    options: { includeEmptyRows, includeTotals, level },
  }
  const query = useAnalysisQuery(spec, { enabled: !multiple && !!currentPeriod })
  const data = query.isPlaceholderData ? undefined : query.data
  // 本次查询为空的维度只作提示（同一维度换主体/期间可能就有数据，不永久禁用）
  const emptyDims = data && data.rows.length === 0 ? [data.rowDim] : []
  const viewState = resolveAnalysisViewState({
    hasPeriod: !!currentPeriod,
    periodsPending: periods.isPending,
    periodsError: periods.isError,
    queryPending: query.isPending,
    queryError: query.isError,
    queryForbidden: isForbiddenError(query.error),
    hasData: !!data,
    rowCount: data?.rows.length ?? 0,
    keywordActive: keyword.trim().length > 0,
  })
  const queryErrorText = query.error instanceof Error ? query.error.message : '查询请求失败'
  const resultSource = data ? `${data.period} · ${data.companyName ?? data.companyCode ?? '默认合计'}` : ''
  const partialReasons = data
    ? [
        data.degraded ? '当前账号权限已回退到可见范围' : '',
        data.meta.unmatchedRows.length > 0 ? `${data.meta.unmatchedRows.length} 行配置失效未纳入` : '',
      ].filter(Boolean)
    : []

  /** 视图加载：spec → 全部控件状态（spec 为后端规范化形态，缺省字段回落默认） */
  const applySpec = (s: AnalysisQuerySpec) => {
    setRowDim(s.rowDim)
    setColDim(s.colDim)
    setColCodes(s.colCodes ?? [])
    setMetrics(s.metrics ?? [])
    setKeyword(s.filters?.keyword ?? '')
    setIncludeEmptyRows(s.options?.includeEmptyRows ?? false)
    setIncludeTotals(s.options?.includeTotals ?? true)
    setLevel(s.options?.level ?? null)
  }

  const handleExport = () => {
    if (!data) return
    downloadCsv(
      analysisCsvFileName(data.rowDim, data.period),
      buildAnalysisCsv(data.columns, data.rows, data.colDim ? data.colMembers : undefined),
    )
  }

  return (
    <PageContainer className="analysis-page" title="即席分析" navigation={<SubPageTabs items={DASHBOARD_ANALYSIS_TABS} />}>
      {multiple ? (
        <Card className="p-6">
          <h3 className="mb-2 text-base font-semibold">选择本次分析主体</h3>
          <p className="text-sm text-muted-foreground">当前范围包含多家公司。即席分析需要一个单体公司或汇总主体，请先在顶部主体筛选中单选。</p>
        </Card>
      ) : (
        <Tabs defaultValue="analysis">
          <TabsList variant="segmented">
            <TabsTrigger value="analysis">分析区</TabsTrigger>
            <TabsTrigger value="config">配置区</TabsTrigger>
          </TabsList>

          <TabsContent value="analysis" className="space-y-3">
            <Card variant="filter" className="analysis-toolbar">
              <div className="analysis-toolbar-context">
                <span>
                  主体：<strong className="text-foreground">{data?.companyName ?? data?.companyCode ?? '默认合计'}</strong>
                  {data?.degraded ? '（权限回退后生效）' : ''}
                </span>
                <span>{currentPeriod || '—'} · 单位：万元</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RowDimPicker value={rowDim} onChange={(v) => { setRowDim(v); if (v === colDim) { setColDim(undefined); setColCodes([]) } }} emptyDims={emptyDims} />
                <ColDimPicker rowDim={rowDim} value={colDim} colCodes={colCodes}
                  onChange={(dim, codes) => { setColDim(dim); setColCodes(codes) }} />
                <MetricPicker rowDim={rowDim} value={metrics} onChange={setMetrics} />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch checked={includeEmptyRows} onCheckedChange={setIncludeEmptyRows} aria-label="含零值行" />
                  零值行
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch checked={includeTotals} onCheckedChange={setIncludeTotals} aria-label="含合计行" />
                  合计行
                </label>
                {rowDim === 'subject' && (
                  <Select value={level === null ? 'all' : String(level)}
                    onValueChange={(v) => setLevel(v === 'all' ? null : Number(v))}>
                    <SelectTrigger className="h-9 w-[120px]" aria-label="科目层级"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部层级</SelectItem>
                      {[0, 1, 2, 3].map((l) => <SelectItem key={l} value={String(l)}>第 {l + 1} 层</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Input className="h-9 w-[160px]" value={keyword} placeholder="行名关键字过滤"
                  aria-label="行名关键字过滤" onChange={(e) => setKeyword(e.target.value)} />
                {keyword && <Button variant="ghost" size="sm" onClick={() => setKeyword('')}>清除</Button>}
                <Button variant="outline" size="sm" className="h-9 gap-1.5"
                  disabled={!data || data.rows.length === 0} onClick={handleExport} aria-label="导出 CSV">
                  <Download className="h-3.5 w-3.5" />
                  导出 CSV
                </Button>
                <ViewManager spec={spec} onApply={applySpec} />
              </div>
            </Card>

            {viewState === 'period-loading' && (
              <p role="status" className="p-6 text-sm text-muted-foreground">正在加载可用期间…</p>
            )}
            {viewState === 'period-error' && <AnalysisFailure title="期间加载失败" retry={periods.refetch} />}
            {viewState === 'period-empty' && (
              <p role="status" className="p-6 text-sm text-muted-foreground">暂无可用期间</p>
            )}
            {viewState === 'query-loading' && <AnalysisPageSkeleton blocks={[180, 320]} />}
            {viewState === 'query-forbidden' && (
              <Card className="p-6" role="alert">
                <h3 className="mb-2 text-base font-semibold">无权限查看该范围的分析结果</h3>
                <p className="text-sm text-muted-foreground">当前账号无权读取所选主体或期间的数据；这不代表该范围没有数据。可切换有权限的主体或联系管理员开通。</p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => { void query.refetch() }}>重新验证权限</Button>
              </Card>
            )}
            {viewState === 'query-failure' && <AnalysisFailure title={`查询失败：${queryErrorText}`} retry={query.refetch} />}
            {(viewState === 'query-stale' || viewState === 'query-empty' || viewState === 'query-no-match' || viewState === 'query-ready') && (
              <>
                {viewState === 'query-stale' && (
                  <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                    <p className="font-medium">刷新失败：以下为上次成功结果（{resultSource}），不代表当前范围的最新数据。</p>
                    <p className="mt-1">{queryErrorText}</p>
                    <Button className="mt-2" size="sm" variant="outline" onClick={() => { void query.refetch() }}>重试查询</Button>
                  </div>
                )}
                {partialReasons.length > 0 && (
                  <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                    部分结果不可用：{partialReasons.join('；')}。
                  </div>
                )}
                {(viewState === 'query-empty' || viewState === 'query-no-match') && (
                  <p role="status" className="px-1 text-sm text-muted-foreground">
                    {viewState === 'query-no-match'
                      ? `无匹配：没有行名包含「${keyword.trim()}」的结果，可清除关键字或调整维度后再查。`
                      : '查询成功：当前口径下没有数据，可尝试开启「零值行」或调整期间、主体。'}
                  </p>
                )}
                <Card variant="content">
                  <CardContent className="p-4">
                    <ResultTable
                      columns={data?.columns ?? []}
                      rows={data?.rows ?? []}
                      totals={data?.totals}
                      colMembers={data?.colDim ? data.colMembers : undefined}
                      emptyHint={viewState === 'query-no-match'
                        ? '没有行名匹配当前关键字'
                        : '当前口径下没有行数据，可尝试调整「零值行」开关或期间、主体'}
                    />
                  </CardContent>
                </Card>
                <Card variant="content">
                  <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 text-xs text-muted-foreground">
                    <span>{data?.rows.length ?? 0} 行</span>
                    <span>{data?.columns.length ?? 0} 列</span>
                    {data?.colDim && <span>矩阵：{(data.colMembers?.length ?? 0) + 1} 列组 × {data?.columns.length ?? 0} 指标（含小计）</span>}
                    {(data?.meta.unmatchedRows.length ?? 0) > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">
                        失效配置 {data?.meta.unmatchedRows.length} 行（{data?.meta.unmatchedRows.slice(0, 5).join('、')}{data && data.meta.unmatchedRows.length > 5 ? ' 等' : ''}）
                      </span>
                    )}
                    {(data?.meta.skippedReclassifyLogs ?? 0) > 0 && <span>去重分类回放跳过硬编码记录 {data?.meta.skippedReclassifyLogs} 条</span>}
                    <span>口径与既有子页接口一致（契约对照测试保障）</span>
                    <Button variant="ghost" size="sm" className="ml-auto h-7" aria-label="刷新分析结果"
                      onClick={() => { void query.refetch() }}>刷新</Button>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="config" className="space-y-3">
            {!canBrowse ? (
              <Card className="p-6">
                <h3 className="mb-2 text-base font-semibold">无映射配置查看权限</h3>
                <p className="text-sm text-muted-foreground">当前角色仅可查看分析结果，映射配置需 data:browse:view 权限。</p>
              </Card>
            ) : (
              <Card variant="content">
                <CardContent className="space-y-3 p-4">
                  <p className="text-sm text-muted-foreground">
                    在此维护映射配置，保存后分析区立即生效（品类/产品为「关键词 + 显式科目」混合模式，二者至少配置一个）。
                  </p>
                  <Tabs defaultValue="category">
                    <TabsList>
                      {CONFIG_TABS.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
                      <TabsTrigger value="budget-ratio">预算占比</TabsTrigger>
                    </TabsList>
                    {CONFIG_TABS.map((t) => (
                      <TabsContent key={t.key} value={t.key}>
                        <t.Panel canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} />
                      </TabsContent>
                    ))}
                    <TabsContent value="budget-ratio"><BudgetRatioPanel canUpdate={canUpdate} /></TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  )
}
