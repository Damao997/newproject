import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { CollectionsTab } from '../collections-tab'

/**
 * 往来分析 · 催收计划：应收账款客商台账（公司×客商粒度，余额>0），
 * 关联最新催收计划（状态机流转与催收记录仅计划行可用）、
 * 客商扩展字段（业务员/已开票未收款，未计划客商亦可维护）。
 */

export default function CollectionsPlansPage() {
  const { headerRef, headerHeight } = useStickyHeader()
  return (
    <PageContainer title="催收计划" stickyHeader headerRef={headerRef}>
      <CollectionsTab stickyTop={headerHeight} />
    </PageContainer>
  )
}
