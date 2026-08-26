import { useStickyHeader } from '@/hooks/useStickyHeader'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CompanySelect } from '@/components/filters/company-select'
import { Card, CardContent } from '@/components/ui/card'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { DASHBOARD_ANALYSIS_TABS } from '@/components/layout/module-tabs'
import { useDashboardFilters } from '@/hooks/useDashboardFilters'
import { ProductBudgetCard } from './product-budget-card'
import { SubjectBudgetCard } from './subject-budget-card'
import { ExpenseAnalysisCard } from './expense-analysis-card'
import { KeyMetricsTable } from './key-metrics-table'
import { AnalysisPlaceholder } from './analysis-placeholder'

interface PlaceholderConfig {
  title: string
  note?: string
  actionLabel?: string
  actionHref?: string
}

/** 占位子页配置（与 Tab 标签一致）；receivable-aging 数据已在往来账龄落地，提供跳转通道 */
const PLACEHOLDER_CONFIG: Record<string, PlaceholderConfig> = {
  'cash-flow': {
    title: '壹品慧业务现金流分析',
    note: '功能规划中，如有需求请联系管理员反馈优先级',
  },
  'receivable-aging': {
    title: '应收账款账龄分析表',
    note: '数据已在「往来分析 · 账龄分析」落地，可直接前往查看',
    actionLabel: '前往往来账龄分析',
    actionHref: '/transactions/aging',
  },
  'inventory-aging': {
    title: '存货库龄分析表',
    note: '功能规划中，如有需求请联系管理员反馈优先级',
  },
}

/** 经营分析子页类型：func=已迁移功能卡，placeholder=入口占位 */
export type AnalysisVariantKey =
  | 'key-metrics'
  | 'cash-flow'
  | 'receivable-aging'
  | 'inventory-aging'
  | 'category-budget'
  | 'subject-budget'
  | 'expense'

interface AnalysisPageProps {
  /** 路由入口决定的子页类型（/dashboard/analysis/:variant） */
  variant: AnalysisVariantKey
}

/**
 * 首页看板 · 经营分析共享页：二级导航 SubPageTabs + 顶部筛选 + 子页内容。
 * - Tab 条路由驱动（切换即导航到 /dashboard/analysis/*）；
 * - 顶部期间 + 主体维度筛选复用首页看板筛选（useDashboardFilters），口径连续；
 * - 已迁移功能卡（品类/公司预算达成、运营费用）直接包裹 Card 展示；其余为占位。
 */
export function AnalysisPage({ variant }: AnalysisPageProps) {
  const { headerRef } = useStickyHeader()
  const { dimFilter, setDimFilter, selectedPeriod, setSelectedPeriod, periodOptions, companyCode } =
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
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <CompanySelect
            value={dimFilter}
            onChange={setDimFilter}
            valueFormat="prefixed"
            allLabel="全部主体"
            ariaLabel="选择主体维度（汇总主体自动展开为成员合并口径）"
            title="选择主体维度（汇总主体自动展开为成员合并口径）"
            className="h-8 w-[150px] border-input/60 bg-page hover:bg-muted/60 sm:w-[180px]"
          />
          {periodOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <Select
                value={selectedPeriod || periodOptions[periodOptions.length - 1] || 'latest'}
                onValueChange={(v) => setSelectedPeriod(v === 'latest' ? '' : v)}
              >
                <SelectTrigger className="h-8 w-[140px] border-input/60 bg-page hover:bg-muted/60" title="选择预览期间">
                  <SelectValue placeholder="最新期间" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">最新期间</SelectItem>
                  {[...periodOptions].reverse().map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      }
    >
      {/* 二级导航：经营分析子页 Tab（路由驱动） */}
      <SubPageTabs items={DASHBOARD_ANALYSIS_TABS} />

      {(() => {
        switch (variant) {
          case 'key-metrics':
            return (
              // 内容自适应高度：数据少时卡片贴内容（下边框紧贴表格末行），数据多时 flex 链压缩滚动容器、页面不滚动
              <Card className="flex min-h-0 flex-col animate-fade-in border border-border shadow-sm">
                <CardContent className="flex min-h-0 flex-col px-6 pt-6 pb-0">
                  <KeyMetricsTable
                    period={currentPeriod || undefined}
                    companyCode={companyCode}
                  />
                </CardContent>
              </Card>
            )
          case 'category-budget':
            return (
              <Card className="animate-fade-in border border-border shadow-sm">
                <CardContent className="px-6 py-6">
                  <ProductBudgetCard
                    period={currentPeriod || undefined}
                    companyCode={companyCode}
                  />
                </CardContent>
              </Card>
            )
          case 'subject-budget':
            return (
              <Card className="animate-fade-in border border-border shadow-sm">
                <CardContent className="px-6 py-6">
                  <SubjectBudgetCard
                    period={currentPeriod || undefined}
                    companyCode={companyCode}
                  />
                </CardContent>
              </Card>
            )
          case 'expense':
            return (
              <Card className="animate-fade-in border border-border shadow-sm">
                <CardContent className="px-6 py-6">
                  <ExpenseAnalysisCard
                    period={currentPeriod || undefined}
                    companyCode={companyCode}
                  />
                </CardContent>
              </Card>
            )
          default:
            return <AnalysisPlaceholder {...(PLACEHOLDER_CONFIG[variant] ?? { title: '经营分析' })} />
        }
      })()}
    </PageContainer>
  )
}
