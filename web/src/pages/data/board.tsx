import { useParams } from 'react-router-dom'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { BOARD_TABS } from '@/components/layout/module-tabs'
import { usePermission } from '@/hooks/usePermission'
import { ProductCategoryPanel } from '@/components/dimension/product-category-panel'
import { ExpenseMappingPanel } from '@/components/dimension/expense-mapping-panel'
import { SubjectBudgetPanel } from '@/components/dimension/subject-budget-panel'
import { BudgetRatioPanel } from '@/components/dimension/budget-ratio-panel'
import { ProductConfigPanel } from '@/components/dimension/product-config-panel'

const BOARD_SUB_TABS = ['category', 'expense', 'subject', 'budget-ratio', 'product'] as const
type BoardSubTab = (typeof BOARD_SUB_TABS)[number]

/**
 * 数据管理 · 映射管理：按 :sub 挂载真实配置面板（Tab 导航复用 SubPageTabs + BOARD_TABS）。
 * - category → ProductCategoryPanel（品类树 CRUD）；expense → ExpenseMappingPanel（费用映射 CRUD + next-code 预取）；
 * - subject → SubjectBudgetPanel（主体预算展示配置）；budget-ratio → BudgetRatioPanel（按财年编辑 12 个月占比）；
 * - product → ProductConfigPanel（关键指标产品）。
 * 各面板自带 check 变化检测；后端 CRUD 均要求 data:subject:*，前端按钮按 usePermission 显隐。
 */
export default function DataBoardPage() {
  const { sub } = useParams<{ sub: string }>()
  const { can } = usePermission()
  const activeTab: BoardSubTab = (BOARD_SUB_TABS as readonly string[]).includes(sub ?? '')
    ? (sub as BoardSubTab)
    : 'category'

  // 与后端 requirePermission 一致：看板配置 CRUD 走 data:subject:create/update/delete
  const canCreate = can('data:subject', 'create')
  const canUpdate = can('data:subject', 'update')
  const canDelete = can('data:subject', 'delete')

  return (
    <PageContainer
      title="映射管理"
      description="配置经营看板的品类、费用映射、主体、月度预算与产品维度"
    >
      <SubPageTabs items={BOARD_TABS} />

      {activeTab === 'category' && (
        <ProductCategoryPanel canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} />
      )}
      {activeTab === 'expense' && (
        <ExpenseMappingPanel canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} />
      )}
      {activeTab === 'subject' && (
        <SubjectBudgetPanel canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} />
      )}
      {activeTab === 'budget-ratio' && <BudgetRatioPanel canUpdate={canUpdate} />}
      {activeTab === 'product' && (
        <ProductConfigPanel canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} />
      )}
    </PageContainer>
  )
}
