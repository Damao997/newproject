import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { TRANSACTION_DETAIL_TABS } from '@/components/layout/module-tabs'
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
      {/* 页内 Tab：账龄分析 / 科目过滤 / 催收计划 */}
      <SubPageTabs items={TRANSACTION_DETAIL_TABS} />
      <AccountFilterTab />
    </PageContainer>
  )
}
