import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KpiSparkline } from './kpi-sparkline'
import { CHART_SERIES } from '@/lib/chart-theme'
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
  /** 钻取回调：有值时卡片整体可点击（跳转指标分析等） */
  onClick?: () => void
}

const iconMap: Record<string, React.ElementType> = {
  TrendingUp,
  DollarSign,
  Wallet,
  Banknote,
}

/** 四色强调体系：橙 / 青蓝 / 翠绿 / 柔紫，取自图表序列色，按卡片序号轮换 */
const ACCENTS = [
  { icon: 'bg-chart-1/10 text-chart-1', spark: CHART_SERIES[0] },
  { icon: 'bg-chart-2/10 text-chart-2', spark: CHART_SERIES[1] },
  { icon: 'bg-chart-3/10 text-chart-3', spark: CHART_SERIES[2] },
  { icon: 'bg-chart-5/10 text-chart-5', spark: CHART_SERIES[4] },
]

/** 达成率展示：null（无预算）显示 "–" */
function rateText(rate: number | null): string {
  return rate === null ? '–' : formatPercent(rate / 100)
}

/** 达成率三级语义色（规范 §3.2）：≥95 达标绿 / 85-95 预警琥珀 / <85 严重偏离红；无预算灰 */
function rateColorClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground'
  if (rate >= 95) return 'text-success-strong'
  if (rate >= 85) return 'text-warning-strong'
  return 'text-destructive'
}

/**
 * 核心 KPI 卡（收入/毛利/净利润/回款）：
 * 大字体 = 本月合计 + 月度预算达成率（分级色）；小字体 = 累计实际 / 同比 / 累计达成率；底部迷你趋势图。
 */
export function KpiCard({ data, index = 0, onClick }: KpiCardProps) {
  const Icon = iconMap[data.icon] || TrendingUp
  const changePrefix = getChangePrefix(data.yoy)
  // 红涨绿跌（A 股/国内财报习惯）：正数红 finance.red / 负数绿 finance.green / 持平灰
  const isPositive = data.yoy > 0
  const isFlat = data.yoy === 0
  const accent = ACCENTS[index % ACCENTS.length]

  return (
    <Card
      className={cn(
        'animate-fade-in group overflow-hidden border border-border shadow-sm',
        onClick && 'cursor-pointer',
      )}
      style={{ animationDelay: `${index * 80}ms` }}
      onClick={onClick}
      title={onClick ? '点击查看财务指标明细' : undefined}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-5 pb-1 pt-5">
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground">
          {data.title}
        </CardTitle>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', accent.icon)}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        {/* 大字体区：本月合计 + 月度达成率（分级色） */}
        <div className="mb-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <span className="font-num block truncate text-2xl font-bold leading-tight tracking-tight text-foreground" title="本月合计（万元）">
              {formatMoneyWan(data.monthActual)}
            </span>
            <span className="text-[10px] text-muted-foreground/70">本月合计（万元）</span>
          </div>
          <div className="shrink-0 text-right">
            <span className={cn('font-num block text-lg font-bold leading-tight tracking-tight', rateColorClass(data.monthRate))} title="月度预算达成率">
              {rateText(data.monthRate)}
            </span>
            <span className="text-[10px] text-muted-foreground/70">月度达成率</span>
          </div>
        </div>
        {/* 小字体区：累计实际 / 同比 / 累计达成率 */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">累计实际</span>
            <span className="font-num font-medium text-foreground">{formatMoneyWan(data.ytdActual)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">同比</span>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
                isFlat
                  ? 'bg-muted text-muted-foreground'
                  : isPositive
                    ? 'bg-finance-red/10 text-finance-red'
                    : 'bg-finance-green/10 text-finance-green'
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
            <span className="text-muted-foreground">累计达成率</span>
            <span className={cn('font-num font-medium', rateColorClass(data.ytdRate))}>{rateText(data.ytdRate)}</span>
          </div>
        </div>
        <div className="mt-3 border-t border-border pt-3">
          <KpiSparkline data={data.trend} color={accent.spark} />
        </div>
      </CardContent>
    </Card>
  )
}
