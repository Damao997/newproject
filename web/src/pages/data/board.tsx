import { useParams } from 'react-router-dom'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { usePermission } from '@/hooks/usePermission'
import { ProductCategoryPanel } from '@/components/dimension/product-category-panel'
import { ExpenseMappingPanel } from '@/components/dimension/expense-mapping-panel'
import { SubjectBudgetPanel } from '@/components/dimension/subject-budget-panel'
import { BudgetRatioPanel } from '@/components/dimension/budget-ratio-panel'

// 「看板管理」三级子标签（与路由路径段对应）
const BOARD_SUB_TABS = ['category', 'expense', 'subject', 'budget-ratio'] as const
type BoardSubTab = (typeof BOARD_SUB_TABS)[number]

/**
 * 数据管理 · 看板管理：品类配置 / 运营费用映射 / 主体配置 / 月度预算比例。
 * 三级子页由路由路径段驱动（/data/board/category 等），非法段回退品类配置。
 */
export default function DataBoardPage() {
  const { can } = usePermission()
  const { headerRef } = useStickyHeader()
  const { sub } = useParams<{ sub: string }>()
  const boardSubTab: BoardSubTab = BOARD_SUB_TABS.includes(sub as BoardSubTab) ? (sub as BoardSubTab) : 'category'

  // 页头标题随三级子页变化（面包屑承担完整路径指示，页内不再重复层级标题）
  const pageTitle = { category: '品类配置', expense: '运营费用映射', subject: '主体配置', 'budget-ratio': '月度预算比例' }[boardSubTab]
  // 各子页职责说明：渲染为标题旁 Info 图标 + Tooltip（不占页面空间，文案与面板 JSDoc 对齐）
  const pageDescription = {
    category: '维护品类与收入科目名关键词的对应关系，检测未覆盖/失效科目',
    expense: '维护运营费用科目与看板费用类别的映射关系',
    subject: '配置看板主体及其预算科目口径',
    'budget-ratio': '配置年度预算的月度占比拆分规则',
  }[boardSubTab]

  return (
    <PageContainer title={pageTitle} description={pageDescription} stickyHeader headerRef={headerRef}>
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
    </PageContainer>
  )
}
