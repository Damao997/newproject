import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { TRANSACTION_TABS } from '@/components/layout/module-tabs'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { CoverageTab } from './coverage-tab'

/**
 * 往来分析 · 导入覆盖：公司 × 期间 × 六大往来类型 的导入完整性矩阵。
 * 页面为薄壳，承载标题与吸顶测量；数据与交互全部在 CoverageTab（含草稿批次批量激活）。
 */
export default function TransactionsCoveragePage() {
  const { headerRef, headerHeight } = useStickyHeader()

  return (
    <PageContainer
      title="导入覆盖"
      description="公司 × 期间 × 六大往来类型导入完整性矩阵，草稿批次可在此直接激活"
      stickyHeader
      headerRef={headerRef}
    >
      <SubPageTabs items={TRANSACTION_TABS} />
      <CoverageTab stickyTop={headerHeight} />
    </PageContainer>
  )
}
