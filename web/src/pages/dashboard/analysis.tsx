import { useStickyHeader } from '@/hooks/useStickyHeader'
import { Card, CardContent } from '@/components/ui/card'
import { StaleBar } from '@/components/ui/stale-bar'
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

/** 经营分析子页类型：func=已迁移功能卡，placeholder=入口占位 */
export type AnalysisVariantKey =
  | 'key-metrics'
  | 'cash-flow'
  | 'receivable-aging'
  | 'inventory-aging'
  | 'category-budget'
  | 'subject-budget'
  | 'expense'
  | 'core-metrics'

interface AnalysisPageProps {
  /** 路由入口决定的子页类型（/dashboard/analysis/:variant） */
  variant: AnalysisVariantKey
}

/**
 * 首页看板 · 经营分析共享页：二级导航 SubPageTabs + 顶部筛选 + 子页内容。
 * - Tab 条路由驱动（切换即导航到 /dashboard/analysis/*）；
 * - 顶部主体维度筛选复用首页看板筛选（useDashboardFilters），期间读全局 periodStore，口径连续；
 * - 已迁移功能卡（品类/公司预算达成、运营费用）直接包裹 Card 展示；其余为占位。
 */
export function AnalysisPage({ variant }: AnalysisPageProps) {
  const { headerRef } = useStickyHeader()
  const { selectedPeriod, periodOptions, companyCode } =
    useDashboardFilters()
  // 真实生效期间：选定期或后端最新期（与首页看板一致）
  const currentPeriod = selectedPeriod || periodOptions[periodOptions.length - 1] || ''

  return (
    <PageContainer
      title="经营分析"
      stickyHeader
      headerRef={headerRef}
      actionsFullWidth
      // 仅 key-metrics 子页启用视口撑满布局（关键指标表展开明细后表格区内滚动、页面不滚动）：
      // main 可视高 = 100dvh - Header(h-14=56px) - main pt-6(24px) - pb-6(24px)；lg 断点 pb-8=32px → 112px。
      // 104/112 必须与 main-layout.tsx 的 Header 高与 pt/pb 同步（改布局时需同步更新）
      className={
        variant === 'key-metrics'
          ? 'flex h-[calc(100dvh-104px)] flex-col lg:h-[calc(100dvh-112px)]'
          : undefined
      }
    >
      {/* 二级导航：经营分析子页 Tab（路由驱动） */}
      <SubPageTabs items={DASHBOARD_ANALYSIS_TABS} />

      {/* 数据时效条：与首页看板口径连续；数据随数据管理批次激活同步，不虚构采集进度 */}
      <StaleBar meta={`当前期间：${currentPeriod || '最新期间'}`}>
        数据随数据管理批次激活同步更新
      </StaleBar>

      {(() => {
        switch (variant) {
          case 'key-metrics':
            return (
              // 视口撑满布局：CardContent 为内部滚动容器（表格 + 差距分析超出视口时卡片内滚动、页面不滚动不出框）；
              // 数据少时 flex-1 撑满、内容贴顶部展示
              <Card className="flex min-h-0 flex-1 flex-col animate-fade-in border border-border shadow-sm">
                <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 pb-0">
                  <CoreMetricsOverview
                    period={currentPeriod || undefined}
                    companyCode={companyCode}
                  />
                </CardContent>
              </Card>
            )
          case 'cash-flow':
            return (
              <Card className="animate-fade-in border border-border shadow-sm">
                <CardContent className="px-6 py-6">
                  <CashFlowContent
                    period={currentPeriod || undefined}
                    companyCode={companyCode}
                  />
                </CardContent>
              </Card>
            )
          case 'category-budget':
            return (
              <CategoryBudgetContent
                period={currentPeriod || undefined}
                companyCode={companyCode}
              />
            )
          case 'subject-budget':
            return (
              <SubjectBudgetContent
                period={currentPeriod || undefined}
                companyCode={companyCode}
              />
            )
          case 'expense':
            return (
              <ExpenseContent
                period={currentPeriod || undefined}
                companyCode={companyCode}
              />
            )
          case 'receivable-aging':
            return (
              <Card className="animate-fade-in border border-border shadow-sm">
                <CardContent className="px-6 py-6">
                  <ReceivableAgingContent
                    period={currentPeriod || undefined}
                    companyCode={companyCode}
                  />
                </CardContent>
              </Card>
            )
          case 'core-metrics':
            return (
              <Card className="animate-fade-in border border-border shadow-sm">
                <CardContent className="px-6 py-6">
                  <CoreMetricsContent
                    period={currentPeriod || undefined}
                    companyCode={companyCode}
                  />
                </CardContent>
              </Card>
            )
          case 'inventory-aging':
            return (
              <Card className="animate-fade-in border border-border shadow-sm">
                <CardContent className="px-6 py-6">
                  <InventoryAgingContent
                    period={currentPeriod || undefined}
                    companyCode={companyCode}
                  />
                </CardContent>
              </Card>
            )
          default:
            return <AnalysisPlaceholder title="经营分析" />
        }
      })()}
    </PageContainer>
  )
}
