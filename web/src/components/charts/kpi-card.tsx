import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KpiSparkline } from './kpi-sparkline'
import { formatMoneyWan, formatPercent, getChangePrefix } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { 
  TrendingUp, 
  DollarSign, 
  Receipt, 
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Minus
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

/** 四色活泼体系：橙 / 蓝 / 绿 / 淡紫，按卡片序号轮换 */
const ACCENTS = [
  { icon: 'bg-orange-500/10 text-orange-500', spark: '#F97316' },
  { icon: 'bg-blue-500/10 text-blue-500', spark: '#3B82F6' },
  { icon: 'bg-emerald-500/10 text-emerald-500', spark: '#10B981' },
  { icon: 'bg-violet-500/10 text-violet-500', spark: '#8B5CF6' },
]

export function KpiCard({ data, index = 0 }: KpiCardProps) {
  const Icon = iconMap[data.icon] || TrendingUp
  const changePrefix = getChangePrefix(data.change)
  // 红涨绿跌（A 股/国内财报习惯）：正数红 #FF3B30 / 负数绿 #34C759 / 持平灰
  const isPositive = data.change > 0
  const isFlat = data.change === 0
  const accent = ACCENTS[index % ACCENTS.length]

  return (
    <Card
      className="animate-fade-in group overflow-hidden border border-border bg-white shadow-sm transition-shadow duration-200 hover:shadow-md"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-5 pb-1 pt-5">
        <CardTitle className="text-xs font-medium tracking-wide text-[#64748B]">
          {data.title}
        </CardTitle>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', accent.icon)}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div className="mb-3 flex items-baseline gap-2">
          <span className="font-num text-[28px] font-bold leading-tight tracking-tight text-foreground">
            {data.unit === '%' ? formatPercent(data.value / 100) : formatMoneyWan(data.value)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              isFlat
                ? 'bg-[#F1F5F9] text-[#64748B]'
                : isPositive
                  ? 'bg-[#FEF2F2] text-[#FF3B30]'
                  : 'bg-[#F0FDF4] text-[#34C759]'
            )}
          >
            {isFlat ? (
              <Minus className="h-3 w-3" />
            ) : isPositive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            <span className="font-num">{changePrefix}{(Math.abs(data.change) * 100).toFixed(1)}%</span>
          </span>
          <span className="text-[10px] text-[#64748B]">同比</span>
        </div>
        <div className="mt-3 border-t border-border pt-3">
          <KpiSparkline data={data.trend} color={accent.spark} />
        </div>
      </CardContent>
    </Card>
  )
}
