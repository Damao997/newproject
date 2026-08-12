import { PageContainer } from '@/components/layout/page-container'
import { ImportPanel } from './import-panel'

/**
 * 数据管理 · 导入：Excel 导入（经营/静态/预算/往来/存货）+ 导入批次生命周期
 * （预览/激活/归档/清除）+ 导入质量概览。数据浏览在 /data/browse 独立页面。
 */
export default function DataImportPage() {
  return (
    <PageContainer title="导入管理">
      <ImportPanel />
    </PageContainer>
  )
}
