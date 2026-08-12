import { PageContainer } from '@/components/layout/page-container'
import { AccountFilterTab } from './account-filter-tab'

/**
 * 往来分析 · 科目过滤：配置哪些往来科目纳入/排除分析。
 * 排除（inactive）的科目在账龄分析中自动剔除。
 */

export default function TransactionsAccountFilterPage() {
  return (
    <PageContainer title="科目过滤">
      <AccountFilterTab />
    </PageContainer>
  )
}
