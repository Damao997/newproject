import { useState } from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { RECLASSIFY_TABS } from '@/components/layout/module-tabs'
import { Button } from '@/components/ui/button'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { usePermission } from '@/hooks/usePermission'
import { ConsolidationAdjustmentsPanel } from '@/components/reclassify/consolidation-adjustments-panel'
import { ConsolidationAdjustDialog } from '@/components/reclassify/consolidation-adjust-dialog'
import { Plus } from 'lucide-react'

/**
 * 数据管理 · 汇总重分类：两个单体公司共同汇总主体的抵消调整。
 * - 「新建汇总调整」打开抵消对话框（解析两单体共同汇总主体 → 按科目/单月叠加抵消金额）；
 * - 面板分页展示抵消调整历史，行点击展开原因，删除即撤销（软删除，聚合查询立即恢复原口径）；
 * - 写权限：data:reclassify:company（创建/撤销抵消，与后端 requirePermission 一致）。
 */
export default function DataReclassifyConsolidationPage() {
  const { headerRef } = useStickyHeader()
  const { can } = usePermission()
  const canManage = can('data:reclassify', 'company')
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <PageContainer
      title="汇总重分类"
      description="在汇总主体口径上抵消两个单体公司间的内部交易，单体报表不受影响"
      stickyHeader
      headerRef={headerRef}
      actions={
        canManage ? (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新建汇总调整
          </Button>
        ) : undefined
      }
    >
      <SubPageTabs items={RECLASSIFY_TABS} />

      <ConsolidationAdjustmentsPanel />

      {/* key 随 open 变化重挂载：每次打开均为全新表单（无残留草稿/成功提示） */}
      <ConsolidationAdjustDialog key={String(dialogOpen)} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </PageContainer>
  )
}
