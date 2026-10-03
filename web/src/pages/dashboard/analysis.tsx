import { Card, CardContent } from '@/components/ui/card'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { DASHBOARD_ANALYSIS_TABS } from '@/components/layout/module-tabs'
import { useDashboardFilters } from '@/hooks/useDashboardFilters'
import { CoreMetricsOverview } from './core-metrics-overview'
import { AnalysisPlaceholder } from './analysis-placeholder'
import { CategoryBudgetContent } from './analysis/category-budget-content'
import { CashFlowContent } from './analysis/cash-flow-content'
import { ReceivableAgingContent } from './analysis/receivable-aging-content'
import { ExpenseContent } from './analysis/expense-content'
import { SubjectBudgetContent } from './analysis/subject-budget-content'
import { InventoryAgingContent } from './analysis/inventory-aging-content'
import { CoreMetricsContent } from './analysis/core-metrics-content'

export type AnalysisVariantKey = 'key-metrics' | 'cash-flow' | 'receivable-aging' | 'inventory-aging' | 'category-budget' | 'subject-budget' | 'expense' | 'core-metrics'
interface AnalysisPageProps { variant: AnalysisVariantKey }

const ANALYSIS_CONTENT = {
  'key-metrics': CoreMetricsOverview,
  'cash-flow': CashFlowContent,
  'receivable-aging': ReceivableAgingContent,
  'inventory-aging': InventoryAgingContent,
  'category-budget': CategoryBudgetContent,
  'subject-budget': SubjectBudgetContent,
  expense: ExpenseContent,
  'core-metrics': CoreMetricsContent,
}

/** 分类、全局公司和期间沿用原路由与筛选；各分析区块直接呈现，宽表自行滚动。 */
export function AnalysisPage({ variant }: AnalysisPageProps) {
  const { selectedPeriod, periodOptions, companyCode } = useDashboardFilters()
  const currentPeriod = selectedPeriod || periodOptions[periodOptions.length - 1] || ''
  const Content = ANALYSIS_CONTENT[variant]
  return <PageContainer navigation={<SubPageTabs items={DASHBOARD_ANALYSIS_TABS} />} title="经营分析" viewportBound={variant === 'key-metrics'}>
    {!Content ? <AnalysisPlaceholder title="经营分析" /> : variant === 'key-metrics' ? (
      <Card className="flex min-h-0 flex-1 flex-col animate-fade-in">
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto p-0">
          <Content period={currentPeriod || undefined} companyCode={companyCode} />
        </CardContent>
      </Card>
    ) : <Content period={currentPeriod || undefined} companyCode={companyCode} />}
  </PageContainer>
}
