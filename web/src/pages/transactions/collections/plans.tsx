import { PageContainer } from '@/components/layout/page-container'
import { CollectionsTab } from '../collections-tab'

/**
 * 往来分析 · 催收管理：催收计划台账（筛选/分页）、账龄逾期批量生成建议、
 * 状态机流转（pending→collecting→partial|full|bad_debt）、催收记录。
 */

export default function CollectionsPlansPage() {
  return (
    <PageContainer title="催收计划">
      <CollectionsTab />
    </PageContainer>
  )
}
