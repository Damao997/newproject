import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { TRANSACTION_TABS } from '@/components/layout/module-tabs'
import { AccountFilterTab } from './account-filter-tab'

/**
 * 往来分析 · 科目过滤：配置往来科目纳入/排除分析范围（实时影响账龄/明细查询）。
 * 页面为薄壳，数据与交互全部在 AccountFilterTab。
 */
export default function TransactionsAccountFilterPage() {
  return (
    <PageContainer
      title="科目过滤"
      description="配置纳入往来分析的会计科目，排除后账龄分析自动剔除其数据"
    >
      <SubPageTabs items={TRANSACTION_TABS} />
      <AccountFilterTab />
    </PageContainer>
  )
}
