import { PageContainer } from '@/components/layout/page-container'
import { ConsolidationAdjustmentsPanel } from '@/components/reclassify/consolidation-adjustments-panel'

/**
 * 数据管理 · 重分类管理 → 汇总抵消调整：汇总抵消调整记录
 * （仅作用于汇总主体口径，单体报表不受影响）。调整操作入口在重分类记录页「数据调整」。
 */
export default function DataReclassifyConsolidationPage() {
  return (
    <PageContainer title="汇总抵消调整">
      <ConsolidationAdjustmentsPanel />
    </PageContainer>
  )
}
