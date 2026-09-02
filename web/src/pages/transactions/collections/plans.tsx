import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { TRANSACTION_TABS } from '@/components/layout/module-tabs'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { CollectionsTab } from '../collections-tab'

/**
 * 往来分析 · 催收计划：应收款客商台账 + 催收状态机流转 + 催收记录 + 客商扩展字段。
 * 页面为薄壳，数据与交互全部在 CollectionsTab。
 */
export default function CollectionsPlansPage() {
  const { headerRef, headerHeight } = useStickyHeader()

  return (
    <PageContainer
      title="催收计划"
      description="应收款客商台账与催收计划状态流转，逾期任务优先介入"
      stickyHeader
      headerRef={headerRef}
    >
      <SubPageTabs items={TRANSACTION_TABS} />
      <CollectionsTab stickyTop={headerHeight} />
    </PageContainer>
  )
}
