import { PageContainer } from '@/components/layout/page-container'
import { AnalysisManager } from './analysis-list'

/**
 * 分析报告 · 单项分析：单项分析集中管理
 * （列表筛选/搜索/分页 + 引用情况 + 快速编辑/删除/恢复）。
 * 新建入口维持在指标分析页 AnalysisDrawer（公司×科目×期间 上下文）。
 */

export default function ReportsAnalysesPage() {
  return (
    <PageContainer title="单项分析管理">
      <AnalysisManager />
    </PageContainer>
  )
}
