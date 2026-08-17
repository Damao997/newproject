import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { AccountFilterTab } from './account-filter-tab'

/**
 * 往来分析 · 科目过滤：配置哪些往来科目纳入/排除分析。
 * 排除（inactive）的科目在账龄分析中自动剔除。
 */

export default function TransactionsAccountFilterPage() {
  const { headerRef } = useStickyHeader()
  return (
    <PageContainer title="科目过滤" stickyHeader headerRef={headerRef}>
      <AccountFilterTab />
    </PageContainer>
  )
}
