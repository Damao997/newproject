import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KpiSparkline } from './kpi-sparkline'
import { formatMoneyWan, formatPercent, getChangePrefix } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { 
  TrendingUp, 
  DollarSign, 
  Wallet,
  Banknote,
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
  Wallet,
  Banknote,
}

/** 四色活泼体系：橙 / 蓝 / 绿 / 淡紫，按卡片序号轮换 */
const ACCENTS = [
  { icon: 'bg-orange-500/10 text-orange-500', spark: '#F97316' },
  { icon: 'bg-blue-500/10 text-blue-500', spark: '#3B82F6' },
  { icon: 'bg-emerald-500/10 text-emerald-500', spark: '#10B981' },
  { icon: 'bg-violet-500/10 text-violet-500', spark: '#8B5CF6' },
]

/** 达成率展示：null（无预算）显示 "–" */
function rateText(rate: number | null): string {
  return rate === null ? '–' : formatPercent(rate / 100)
}

/**
 * 核心 KPI 卡（收入/毛利/净利润/回款）：
 * 大字体 = 本月合计 + 月度预算达成率；小字体 = 累计实际 / 同比 / 累计达成率；底部迷你趋势图。
 */
export function KpiCard({ data, index = 0 }: KpiCardProps) {
  const Icon = iconMap[data.icon] || TrendingUp
  const changePrefix = getChangePrefix(data.yoy)
  // 红涨绿跌（A 股/国内财报习惯）：正数红 #FF3B30 / 负数绿 #34C759 / 持平灰
  const isPositive = data.yoy > 0
  const isFlat = data.yoy === 0
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
        {/* 大字体区：本月合计 + 月度达成率 */}
        <div className="mb-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <span className="font-num block truncate text-[26px] font-bold leading-tight tracking-tight text-foreground" title={`本月合计（万元）`}>
              {formatMoneyWan(data.monthActual)}
            </span>
            <span className="text-[10px] text-[#94A3B8]">本月合计（万元）</span>
          </div>
          <div className="shrink-0 text-right">
            <span className="font-num block text-[22px] font-bold leading-tight tracking-tight text-primary" title="月度预算达成率">
              {rateText(data.monthRate)}
            </span>
            <span className="text-[10px] text-[#94A3B8]">月度达成率</span>
          </div>
        </div>
        {/* 小字体区：累计实际 / 同比 / 累计达成率 */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[#64748B]">累计实际</span>
            <span className="font-num font-medium text-foreground">{formatMoneyWan(data.ytdActual)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#64748B]">同比</span>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
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
              <span className="font-num">{changePrefix}{(Math.abs(data.yoy) * 100).toFixed(1)}%</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#64748B]">累计达成率</span>
            <span className="font-num font-medium text-foreground">{rateText(data.ytdRate)}</span>
          </div>
        </div>
        <div className="mt-3 border-t border-border pt-3">
          <KpiSparkline data={data.trend} color={accent.spark} />
        </div>
      </CardContent>
    </Card>
  )
}
