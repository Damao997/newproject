import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { CoverageTab } from './coverage-tab'

/**
 * 往来分析 · 导入覆盖：公司 × 期间 × 六大往来类型的导入完整性矩阵。
 */

export default function TransactionsCoveragePage() {
  const { headerRef, headerHeight } = useStickyHeader()
  return (
    <PageContainer title="导入覆盖" stickyHeader headerRef={headerRef}>
      <CoverageTab stickyTop={headerHeight} />
    </PageContainer>
  )
}
