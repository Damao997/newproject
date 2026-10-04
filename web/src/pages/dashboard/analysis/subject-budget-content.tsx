import { AnalysisSection, AnalysisFailure } from '@/components/analysis/workspace'
import { useAnalysisWorkspace } from '@/components/analysis/analysis-context'
import { BudgetFocus } from '@/components/analysis/budget-focus'
import { EmptyState } from '@/components/ui/empty-state'
import { AnalysisPageSkeleton } from '@/components/ui/skeleton-blocks'
import { useSubjectBudget } from '@/hooks/api-queries'
import { SubjectBudgetCard } from '../subject-budget-card'
import { usePageStore } from '@/stores/pageStateStore'

export function SubjectBudgetContent({ period, companyCode }: { period?: string; companyCode?: string }) {
  const workspace = useAnalysisWorkspace()
  const dim = usePageStore(s => s.dashboard.dim)
  const mode = workspace ? (workspace.companyType === 'summary' ? 'summary' : 'single') : dim.startsWith('summary:') ? 'summary' : 'single'
  const { data, isLoading, isError, isPlaceholderData, refetch } = useSubjectBudget({ period, companyCode, mode })
  if (isLoading || isPlaceholderData) return <AnalysisPageSkeleton blocks={[160, 320]} />
  if (isError && !data) return <AnalysisFailure title="公司预算达成数据加载失败" retry={refetch} />
  const rows = data?.rows ?? []
  if (!rows.length) return <EmptyState title="暂无公司预算达成数据" description="请检查当前主体、期间及预算配置" />
  return <div className="space-y-4">
    {isError && <AnalysisFailure title="刷新失败，保留当前数据" retry={refetch} />}
    <AnalysisSection kind="focus"><BudgetFocus company={true} rows={rows.map(row => ({ ...row, id: row.code, label: row.name }))} /></AnalysisSection>
    <AnalysisSection kind="report"><SubjectBudgetCard period={period} companyCode={companyCode} mode={mode} /></AnalysisSection>
  </div>
}
