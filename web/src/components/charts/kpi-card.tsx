import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { KpiSparkline } from './kpi-sparkline'
import { formatMoney, formatPercent, getChangePrefix } from '@/lib/utils'
import { 
  TrendingUp, 
  DollarSign, 
  Receipt, 
  Target,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react'
import type { KpiData } from '@/types'

interface KpiCardProps {
  data: KpiData
  /** 列表中的序号，用于交错淡入动画（借鉴 demo-3 的 animation-delay 级联） */
  index?: number
}

const iconMap: Record<string, React.ElementType> = {
  TrendingUp,
  DollarSign,
  Receipt,
  Target,
}

export function KpiCard({ data, index = 0 }: KpiCardProps) {
  const Icon = iconMap[data.icon] || TrendingUp
  const changePrefix = getChangePrefix(data.change)
  const isPositive = data.change > 0

  return (
    <Card
      className="animate-fade-in group overflow-hidden border-0 bg-white shadow-[0_1px_3px_0_rgba(0,0,0,0.06)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.08)]"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-5 px-5">
        <CardTitle className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
          {data.title}
        </CardTitle>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/5 transition-colors group-hover:bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-3xl font-bold tracking-tight text-foreground" style={{ fontFamily: "'Inter', 'Noto Sans SC', sans-serif" }}>
            {data.unit === '%' ? formatPercent(data.value / 100) : formatMoney(data.value)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <Badge 
            variant={isPositive ? 'success' : 'destructive'} 
            className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full"
          >
            {isPositive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            <span>{changePrefix}{(Math.abs(data.change) * 100).toFixed(1)}%</span>
          </Badge>
          <span className="text-[10px] text-muted-foreground">同比</span>
        </div>
        <div className="mt-3 pt-3 border-t border-border/50">
          <KpiSparkline data={data.trend} />
        </div>
      </CardContent>
    </Card>
  )
}
