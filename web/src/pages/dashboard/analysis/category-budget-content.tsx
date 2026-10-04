import { AnalysisSection, AnalysisFailure } from '@/components/analysis/workspace'
import { useAnalysisWorkspace } from '@/components/analysis/analysis-context'
import { BudgetFocus } from '@/components/analysis/budget-focus'
import { EmptyState } from '@/components/ui/empty-state'
import { AnalysisPageSkeleton } from '@/components/ui/skeleton-blocks'
import { useProductBudget } from '@/hooks/api-queries'
import { ProductBudgetCard } from '../product-budget-card'
import { GapAnalysisPanel } from '../core-metrics-gap-analysis'
import { buildCategoryGapAnalysisItems } from './category-gap-analysis'

export function CategoryBudgetContent({ period, companyCode }: { period?: string; companyCode?: string }) {
  const workspace = useAnalysisWorkspace()

  const { data, isLoading, isError, isPlaceholderData, refetch } = useProductBudget({ period, companyCode })
  if (isLoading || isPlaceholderData) return <AnalysisPageSkeleton blocks={[160, 320]} />
  if (isError && !data) return <AnalysisFailure title="品类预算达成数据加载失败" retry={refetch} />
  const rows = data?.rows ?? []
  if (!rows.length) return <EmptyState title="暂无品类预算达成数据" description="请检查当前主体、期间及预算配置" />
  return <div className="space-y-4">
    {isError && <AnalysisFailure title="刷新失败，保留当前数据" retry={refetch} />}
    <AnalysisSection kind="focus"><BudgetFocus company={false} rows={rows.map(row => ({ ...row, id: row.category, label: row.category }))} /><GapAnalysisPanel items={buildCategoryGapAnalysisItems(rows)} onSelect={key => workspace?.update({ selected: key })} /></AnalysisSection>
    <AnalysisSection kind="report"><ProductBudgetCard period={period} companyCode={companyCode} /></AnalysisSection>
  </div>
}
