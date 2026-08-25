import { useParams } from 'react-router-dom'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { BOARD_TABS } from '@/components/layout/module-tabs'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { usePermission } from '@/hooks/usePermission'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Info } from 'lucide-react'
import { ProductCategoryPanel } from '@/components/dimension/product-category-panel'
import { ExpenseMappingPanel } from '@/components/dimension/expense-mapping-panel'
import { SubjectBudgetPanel } from '@/components/dimension/subject-budget-panel'
import { BudgetRatioPanel } from '@/components/dimension/budget-ratio-panel'
import { ProductConfigPanel } from '@/components/dimension/product-config-panel'

// 「看板管理」三级子标签（与路由路径段对应）
const BOARD_SUB_TABS = ['category', 'expense', 'subject', 'budget-ratio', 'product'] as const
type BoardSubTab = (typeof BOARD_SUB_TABS)[number]

// 主标题 hover 说明：面板顶部静态说明文字收纳到标题旁提示（节省空间、保持界面整洁）；budget-ratio 无说明
const BOARD_TITLE_HELP: Partial<Record<BoardSubTab, string>> = {
  category: '维护品类预算达成分析的品类与经营科目树收入类别的对应关系：品类通过「匹配关键词」自动匹配收入科目（名称包含关键词，可命中多个并求和），毛利数据按镜像科目（"XX收入"→"XX毛利"）自动配对。经营科目树发生变化后，点击「刷新检测」查看未覆盖科目。',
  expense: '维护运营费用分析的展示指标与经营科目编码集合的对应关系：每个映射选择一个或多个科目（多科目自动汇总求和），看板「运营费用分析」按映射顺序展示。编码规范：单选科目=科目编码（OP_ 前缀）；归并/自定义=EXP_ 前缀小写英文（如 EXP_rd_expense）。未导入数据/预算的科目不会在看板展示，导入后自动出现。',
  subject: '维护看板「主体预算达成分析」展示的主体：仅配置且启用（active）的主体会在看板中展示。公司表新增主体后，点击「刷新检测」查看未配置主体并加入展示列表。',
  product: '维护壹品慧关键指标表「按产品分」明细的产品与经营科目树收入类别的对应关系：产品通过「匹配关键词」自动匹配收入科目（名称包含关键词，可命中多个并求和），毛利数据按镜像科目（"XX收入"→"XX毛利"）自动配对。独立于品类配置（品类预算达成分析），两套配置各自维护。',
}

/**
 * 数据管理 · 看板管理：品类配置 / 运营费用映射 / 主体配置 / 月度预算比例 / 产品配置。
 * 三级子页由路由路径段驱动（/data/board/category 等），非法段回退品类配置。
 */
export default function DataBoardPage() {
  const { can } = usePermission()
  const { headerRef } = useStickyHeader()
  const { sub } = useParams<{ sub: string }>()
  const boardSubTab: BoardSubTab = BOARD_SUB_TABS.includes(sub as BoardSubTab) ? (sub as BoardSubTab) : 'category'

  // 页头标题固定为模块名（Tab 承担分类切换指示）；说明文字收纳到标题 hover 提示（budget-ratio 无说明）
  const pageTitleText = '看板管理'
  const help = BOARD_TITLE_HELP[boardSubTab]
  // side=bottom + align=start：标题贴侧边栏（内容区最左），tooltip 从标题左缘向右下展开，避免向左弹出被侧边栏截断；max-w-sm 限宽自动换行
  const pageTitle = help ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1.5">
          {pageTitleText}
          <Info className="h-4 w-4 text-muted-foreground" aria-label="说明" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-sm whitespace-normal text-xs leading-relaxed">
        {help}
      </TooltipContent>
    </Tooltip>
  ) : pageTitleText

  return (
    <PageContainer title={pageTitle} stickyHeader headerRef={headerRef}>
      {/* 页内 Tab：品类配置（默认）/ 运营费用映射 / 主体配置 / 月度预算比例 */}
      <SubPageTabs items={BOARD_TABS} />
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
      {boardSubTab === 'product' && (
        <ProductConfigPanel
          canCreate={can('data:subject', 'create')}
          canUpdate={can('data:subject', 'update')}
          canDelete={can('data:subject', 'delete')}
        />
      )}
    </PageContainer>
  )
}
