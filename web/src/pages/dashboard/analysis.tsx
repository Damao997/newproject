import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { DASHBOARD_ANALYSIS_TABS } from '@/components/layout/module-tabs'
import { AnalysisFailure, AnalysisModeSwitch } from '@/components/analysis/workspace'
import { AnalysisContext } from '@/components/analysis/analysis-context'
import { CompanyPill } from '@/components/layout/company-pill'
import { Card } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { AnalysisPageSkeleton } from '@/components/ui/skeleton-blocks'
import { useAvailablePeriods, useCompanies, useKeyMetrics } from '@/hooks/api-queries'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { defaultAnalysisState, usePageStore } from '@/stores/pageStateStore'
import { CoreMetricsOverview } from './core-metrics-overview'
import { CategoryBudgetContent } from './analysis/category-budget-content'
import { CashFlowContent } from './analysis/cash-flow-content'
import { ReceivableAgingContent } from './analysis/receivable-aging-content'
import { ExpenseContent } from './analysis/expense-content'
import { SubjectBudgetContent } from './analysis/subject-budget-content'
import { InventoryAgingContent } from './analysis/inventory-aging-content'
import { CoreMetricsContent } from './analysis/core-metrics-content'

export type AnalysisVariantKey = 'key-metrics' | 'cash-flow' | 'receivable-aging' | 'inventory-aging' | 'category-budget' | 'subject-budget' | 'expense' | 'core-metrics'
const ANALYSIS_CONTENT = { 'key-metrics': CoreMetricsOverview, 'cash-flow': CashFlowContent, 'receivable-aging': ReceivableAgingContent, 'inventory-aging': InventoryAgingContent, 'category-budget': CategoryBudgetContent, 'subject-budget': SubjectBudgetContent, expense: ExpenseContent, 'core-metrics': CoreMetricsContent }
/** 默认主体先由服务端解析；所有子页再使用同一个实际生效主体，避免接口默认范围不一致。 */
export function AnalysisPage({ variant }: { variant: AnalysisVariantKey }) {
  const period = usePeriodStore(s => s.period), fiscalYear = usePeriodStore(s => s.fiscalYear), codes = usePeriodStore(s => s.companyCodes)
  const periods = useAvailablePeriods()
  const candidates = filterPeriodsByFiscalYear(periods.data?.periods ?? [], fiscalYear, periods.data?.fiscalStartMonth ?? 1)
  const currentPeriod = period || candidates.at(-1) || ''
  const multiple = (codes?.length ?? 0) > 1
  const requestedCode = codes?.length === 1 ? codes[0] : undefined
  const scope = useKeyMetrics({ period: currentPeriod || undefined, companyCode: requestedCode }, { enabled: !multiple })
  const companies = useCompanies()
  const knownCompany = companies.data?.find(company => company.code === requestedCode)
  const resolved = scope.isPlaceholderData ? undefined : scope.data
  const actualCompanyName = resolved?.companyName ?? knownCompany?.name
  const state = usePageStore(s => s.analysis[variant]) ?? defaultAnalysisState
  const setAnalysis = usePageStore(s => s.setAnalysis)
  const companyCode = resolved?.companyCode ?? knownCompany?.code
  const companyType = resolved?.companyType ?? (knownCompany ? knownCompany.type === 'summary' ? 'summary' : 'single' : undefined)
  const Content = ANALYSIS_CONTENT[variant]
  return <PageContainer className="analysis-page" title="经营分析" navigation={<SubPageTabs items={DASHBOARD_ANALYSIS_TABS} />}>
    {multiple ? <Card className="p-6"><h3 className="mb-2 text-base font-semibold">选择本次分析主体</h3><p className="mb-4 text-sm text-muted-foreground">当前范围包含多家公司。经营分析需要一个单体公司或汇总主体，取消选择会保留原范围。</p><CompanyPill selectionMode="single" /></Card> : periods.isError && !currentPeriod ? <AnalysisFailure title="期间加载失败" retry={periods.refetch} /> : !currentPeriod ? <p role="status" className="p-6 text-sm text-muted-foreground">{periods.isPending ? '正在加载可用期间…' : '暂无可用期间'}</p> : scope.isError && !companyCode ? <AnalysisFailure title="分析主体加载失败" retry={scope.refetch} /> : (scope.isPending || scope.isPlaceholderData) && !knownCompany ? <AnalysisPageSkeleton blocks={[180, 320]} /> : !companyCode ? <p className="p-6 text-sm text-muted-foreground">当前授权范围内没有可分析的主体。</p> : <AnalysisContext.Provider value={{ state, companyType, update: patch => setAnalysis(variant, patch) }}>
      <Card variant="filter" className="analysis-toolbar">
        <div className="analysis-toolbar-context"><span>主体：<strong className="text-foreground">{actualCompanyName ?? companyCode}</strong>{scope.data?.degraded ? '（权限回退后生效）' : !requestedCode ? '（默认）' : ''}</span><span>{currentPeriod} · 单位：万元</span></div>
        <div className="flex flex-wrap items-center gap-2">{['category-budget', 'subject-budget', 'expense'].includes(variant) && <AnalysisModeSwitch />}{state.selected && <Button variant="ghost" size="sm" onClick={() => setAnalysis(variant, { selected: '', keyword: '', page: 1 })}>清除局部筛选</Button>}
          <Tabs value={state.view} onValueChange={value => setAnalysis(variant, { view: value as 'focus' | 'report' })}><TabsList variant="segmented"><TabsTrigger value="focus">重点</TabsTrigger><TabsTrigger value="report">完整报表</TabsTrigger></TabsList></Tabs>
        </div>
      </Card>
      {scope.isError && <AnalysisFailure title="主体信息刷新失败，保留当前内容" retry={scope.refetch} />}
      <div className="analysis-workspace" data-analysis-view={state.view} key={variant + ':' + companyCode + ':' + currentPeriod}><Content period={currentPeriod} companyCode={companyCode} /></div>
    </AnalysisContext.Provider>}
  </PageContainer>
}
