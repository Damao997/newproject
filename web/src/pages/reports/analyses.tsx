import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { AnalysisManager } from './analysis-list'

/**
 * 单项分析报告：mock 设计稿已替换为 AnalysisManager 实现
 * （公司×科目×期间检索 / 关键词 / 含已删除 / 分页 / 编辑·删除·恢复 / AI 预分析插入报告；正文 RichTextEditor 内置 AI 润色 SSE 与链接编辑）。
 * 新建入口维持在指标分析页 AnalysisDrawer（公司×科目×期间 上下文）。
 */
export default function ReportsAnalysesPage() {
  const { headerRef, headerHeight } = useStickyHeader()

  return (
    <PageContainer
      title="单项分析报告"
      description="按公司 × 科目 × 期间撰写的单项分析集中管理，可被汇总报告实时引用"
      stickyHeader
      headerRef={headerRef}
    >
      <AnalysisManager stickyTop={headerHeight} />
    </PageContainer>
  )
}
