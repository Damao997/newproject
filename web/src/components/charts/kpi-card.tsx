import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoneyWan, formatPercent } from '@/lib/utils'
import { cn } from '@/lib/utils'
import {
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

/** 达成率展示：null（无预算）显示 "–" */
function rateText(rate: number | null): string {
  return rate === null ? '–' : formatPercent(rate / 100)
}

/** 达成率红绿灯三档：≥75 达标绿（持续关注）/ 60-75 预警黄（需改善计划）/ <60 未达标红（须根因分析+专项整改）；无预算灰 */
function rateColorClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground'
  if (rate >= 75) return 'text-success-strong'
  if (rate >= 60) return 'text-warning-strong'
  return 'text-destructive'
}

/**
 * 核心 KPI 卡（收入/毛利/净利润/回款）：
 * 大字体 = 本月合计 + 月度预算达成率（分级色）；小字体 = 累计实际 / 同比 / 累计达成率。
 */
export function KpiCard({ data, index = 0, onClick }: KpiCardProps) {
  // 红涨绿跌（A 股/国内财报习惯）：正数红 finance.red / 负数绿 finance.green / 持平灰；方向由箭头图标表达，数值不再重复加 "+" 前缀
  const isPositive = data.yoy > 0
  const isFlat = data.yoy === 0

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
      <CardHeader className="px-5 pb-1 pt-5">
        <CardTitle className="text-sm font-semibold tracking-tight text-foreground">
          {data.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        {/* 大字体区：本月合计 + 月度达成率（分级色） */}
        <div className="mb-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <span className="font-num block truncate text-2xl font-bold leading-tight tracking-tight text-foreground" title="本月合计（万元）">
              {formatMoneyWan(data.monthActual)}
            </span>
            <span className="text-micro text-muted-foreground/70">本月合计（万元）</span>
          </div>
          <div className="shrink-0 text-right">
            <span className={cn('font-num block text-lg font-bold leading-tight tracking-tight', rateColorClass(data.monthRate))} title="月度预算达成率">
              {rateText(data.monthRate)}
            </span>
            <span className="text-micro text-muted-foreground/70">月度达成率</span>
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
                'inline-flex items-center gap-0.5 text-xs font-medium',
                isFlat
                  ? 'text-muted-foreground'
                  : isPositive
                    ? 'text-finance-red'
                    : 'text-finance-green'
              )}
            >
              {isFlat ? (
                <Minus className="h-3 w-3" />
              ) : isPositive ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              <span className="font-num">{data.yoy === 0 ? '-' : `${(Math.abs(data.yoy) * 100).toFixed(1)}%`}</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">累计达成率</span>
            <span className={cn('font-num font-medium', rateColorClass(data.ytdRate))}>{rateText(data.ytdRate)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
