import { Card, CardContent } from '@/components/ui/card'
import { PageContainer } from '@/components/layout/page-container'
import { ArrowLeftRight, Clock } from 'lucide-react'

export default function TransactionsPage() {
  return (
    <PageContainer
      title="往来分析"
      description="六大往来总览、客商明细、账龄分析、催收计划"
    >
      <Card className="animate-fade-in">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <ArrowLeftRight className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium">往来分析模块</h3>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">
              该模块将在 P1 阶段实现，包含以下功能：
            </p>
            <ul className="mb-6 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                六大往来总览
              </li>
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                客商明细查询
              </li>
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                账龄分析矩阵
              </li>
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                催收计划管理
              </li>
            </ul>
            <div className="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
              预计上线时间：P1 阶段
            </div>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
