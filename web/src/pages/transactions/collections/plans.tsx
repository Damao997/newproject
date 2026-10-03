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
      navigation={<SubPageTabs items={TRANSACTION_TABS} />}
      viewportBound
      title="催收计划"
      stickyHeader
      headerRef={headerRef}
    >
      <CollectionsTab stickyTop={headerHeight} />
    </PageContainer>
  )
}
