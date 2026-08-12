import { PageContainer } from '@/components/layout/page-container'
import { CoverageTab } from './coverage-tab'

/**
 * 往来分析 · 导入覆盖：公司 × 期间 × 六大往来类型的导入完整性矩阵。
 */

export default function TransactionsCoveragePage() {
  return (
    <PageContainer title="导入覆盖">
      <CoverageTab />
    </PageContainer>
  )
}
