import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/layout/page-container'
import { usePermission } from '@/hooks/usePermission'
import { ConsolidationAdjustmentsPanel } from '@/components/reclassify/consolidation-adjustments-panel'
import { ConsolidationAdjustDialog } from '@/components/reclassify/consolidation-adjust-dialog'
import { ArrowLeftRight } from 'lucide-react'

/**
 * 数据管理 · 重分类管理 → 汇总主体调整：汇总抵消调整记录
 * （仅作用于汇总主体口径，单体报表不受影响）。「汇总抵消」操作入口在本页。
 */
export default function DataReclassifyConsolidationPage() {
  const { can } = usePermission()
  const canReclassifyCompany = can('data:reclassify', 'company')
  // 汇总抵消调整（仅作用于汇总主体口径，单体报表不受影响）
  const [consolidationOpen, setConsolidationOpen] = useState(false)

  return (
    <PageContainer title="汇总主体调整">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canReclassifyCompany && (
          <Button variant="outline" size="sm" aria-label="汇总抵消" onClick={() => setConsolidationOpen(true)}>
            <ArrowLeftRight className="mr-2 h-4 w-4" />
            汇总抵消
          </Button>
        )}
      </div>
      <div className="mt-3">
        <ConsolidationAdjustmentsPanel />
      </div>
      <ConsolidationAdjustDialog
        open={consolidationOpen}
        onClose={() => setConsolidationOpen(false)}
      />
    </PageContainer>
  )
}
