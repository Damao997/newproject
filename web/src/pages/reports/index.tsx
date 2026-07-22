import { Card, CardContent } from '@/components/ui/card'
import { PageContainer } from '@/components/layout/page-container'
import { FileText, Clock, Lock } from 'lucide-react'

export default function ReportsPage() {
  return (
    <PageContainer
      title="分析报告"
      description="报告模板、录入、数据自动填充、AI润色、组装导出"
    >
      <Card className="animate-fade-in">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium">分析报告模块</h3>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">
              该模块将在 P2 阶段实现，包含以下功能：
            </p>
            <ul className="mb-6 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                报告模板管理
              </li>
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                报告录入与编辑
              </li>
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                数据自动填充
              </li>
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                AI 润色与追加分析
              </li>
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                组装导出（Word/PDF）
              </li>
              <li className="flex items-center">
                <Lock className="mr-2 h-4 w-4" />
                分享链接（UUID v4 安全机制）
              </li>
            </ul>
            <div className="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
              预计上线时间：P2 阶段
            </div>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
