import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { IMPORT_TABS } from '@/components/layout/module-tabs'
import { ImportPanel } from './import-panel'

/**
 * 数据导入页（薄壳路由页）：渲染完整导入链 ImportPanel。
 *
 * 权限门禁在 ImportPanel 内部完成（usePermission）：
 * - 上传/预览/激活/模板下载 = data:import:upload；
 * - 回滚/归档/清除 = 高危权限码（data:import:rollback/archive/purge，仅 superadmin 持有）；
 * - 往来导入覆盖 = transactions:view。
 */
export default function DataImportPage() {
  return (
    <PageContainer
      title="数据导入"
      description="支持经营/静态/现金流/预算/往来等模板批量导入，上传后预览校验（dry-run），批次在质量概览中激活管理"
    >
      <SubPageTabs items={IMPORT_TABS} />
      <ImportPanel />
    </PageContainer>
  )
}
