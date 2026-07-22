import { Card, CardContent } from '@/components/ui/card'
import { PageContainer } from '@/components/layout/page-container'
import { Package, Clock } from 'lucide-react'

export default function InventoryPage() {
  return (
    <PageContainer
      title="存货管理"
      description="库存总览、库龄分布、周转指标、趋势分析"
    >
      <Card className="animate-fade-in">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium">存货管理模块</h3>
            <p className="mb-4 max-w-md text-sm text-muted-foreground">
              该模块将在 P1 阶段实现，包含以下功能：
            </p>
            <ul className="mb-6 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                库存总览
              </li>
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                库龄分布分析
              </li>
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                周转指标计算
              </li>
              <li className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                趋势图表展示
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
