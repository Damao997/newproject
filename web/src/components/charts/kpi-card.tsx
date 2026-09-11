import { Card as AntdCard, Statistic } from 'antd'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  HandCoins,
  Minus,
  Percent,
  PiggyBank,
  TrendingUp,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { KpiSparkline } from './kpi-sparkline'
import { SummaryBreakdownPopover } from '@/components/summary/summary-breakdown'
import { ACHIEVEMENT_RATE_THRESHOLDS } from '@/lib/constants'
import { formatMoneyWan, formatPercent } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { MemberBreakdown } from '@/hooks/use-summary-member-values'
import type { KpiData } from '@/types'

interface KpiCardProps {
  data: KpiData
  /** 列表中的序号，用于交错淡入动画（借鉴 demo-3 的 animation-delay 级联） */
  index?: number
  /** 钻取回调：有值时卡片整体可点击（跳转指标分析等） */
  onClick?: () => void
  /**
   * 汇总主体成员明细（仅看板汇总口径传入，可选）：按 KPI 标题定位成员树根类目取各成员值，
   * hover 大数字区展示成员公司明细；缺省时渲染路径不变（单体/全部口径零行为变化）。
   */
  breakdown?: {
    getMemberValues: (kpiTitle: string) => MemberBreakdown | undefined
  } | null
}

/**
 * KPI 标题 → 成员树类目定位（复刻后端 DashboardService.metricNodes 匹配口径：
 * 收入/毛利/回款按 level0 类目；净利润=「经营成果」类目 + 子树内名称关键字 DFS，
 * 命中一级子科目「壹品慧净利润」（"净利润"不是 level0 段名）。
 * 顺序敏感：净利润含"利润"须在"毛利"前判定（"毛利"不含"净"无冲突，兜底归收入）。
 */
export function kpiRootMatcher(title: string): { category: string; name?: string } {
  if (/毛利/.test(title)) return { category: '壹品慧毛利' }
  if (/净利|利润/.test(title)) return { category: '经营成果', name: '净利润' }
  if (/回款|收款/.test(title)) return { category: '壹品慧回款' }
  return { category: '壹品慧收入' }
}

/** 达成率展示：null（无预算）显示 "–" */
function rateText(rate: number | null): string {
  return rate === null ? '–' : formatPercent(rate / 100)
}

/** 达成率红绿灯三档：≥75 达标绿 / 60-75 预警黄 / <60 未达标红；无预算灰（阈值见 ACHIEVEMENT_RATE_THRESHOLDS）。
 * 导出供其他达成率文本（如主体预算内容页大数字）复用，保证全站红绿灯分档一致 */
export function rateColorClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground'
  if (rate >= ACHIEVEMENT_RATE_THRESHOLDS.PASS) return 'text-success-strong'
  if (rate >= ACHIEVEMENT_RATE_THRESHOLDS.WARN) return 'text-warning-strong'
  return 'text-destructive'
}

/** 标题 → 图标映射（按业务关键词匹配，不侵入 KpiData 数据流） */
const TITLE_ICON_MAP: Array<[RegExp, LucideIcon]> = [
  [/收入|营收/, TrendingUp],
  [/毛利/, Percent],
  [/净利|利润/, PiggyBank],
  [/回款|收款/, HandCoins],
]

function iconForTitle(title: string): LucideIcon {
  return TITLE_ICON_MAP.find(([re]) => re.test(title))?.[1] ?? Activity
}

/**
 * 核心 KPI 卡（收入/毛利/净利润/回款）：antd Card + Statistic。
 * 布局：图标色块 + 标题（hover 淡入钻取箭头）→ 大数字区（本月合计 + 月度达成率分级色）
 * → 财年内月度趋势迷你图（KpiSparkline）→ 分隔线 → 小字区（累计/同比/累计达成率）。
 */
export function KpiCard({ data, index = 0, onClick, breakdown }: KpiCardProps) {
  // 红涨绿跌（A 股/国内财报习惯）：正数红 finance.red / 负数绿 finance.green / 持平灰；方向由箭头图标表达，数值不再重复加 "+" 前缀
  const isPositive = data.yoy > 0
  const isFlat = data.yoy === 0
  const Icon = iconForTitle(data.title)
  const hasTrend = data.trend.length > 1
  // 汇总主体成员明细：hover 大数字区展示各成员公司 本月实际/本年累计（数据由看板页预取注入）
  const memberBreakdown = breakdown?.getMemberValues(data.title)

  return (
    <AntdCard
      className={cn(
        'animate-fade-in group relative overflow-hidden transition-all duration-200',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md',
      )}
      styles={{ body: { padding: 0 } }}
      style={{ animationDelay: `${index * 80}ms` }}
      onClick={onClick}
      title={undefined}
      aria-label={onClick ? `${data.title}：点击查看财务指标明细` : undefined}
    >
      <div className="px-5 pb-4 pt-5">
        {/* 头部：图标色块 + 标题 + hover 钻取箭头（可点击性可见暗示） */}
        <div className="relative mb-3 flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">{data.title}</span>
          {onClick && (
            <ArrowUpRight
              className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          )}
        </div>

        {/* 大数字区：本月合计 + 月度达成率（分级色）；汇总口径时大数字悬浮展示成员公司明细 */}
        <div className="mb-3 flex items-end justify-between gap-2">
          {memberBreakdown ? (
            <SummaryBreakdownPopover
              title={data.title}
              columns={[
                { label: '本月实际', pick: (v) => v.actual, summaryValue: data.monthActual },
                { label: '本年累计', pick: (v) => v.ytd, summaryValue: data.ytdActual },
              ]}
              rows={memberBreakdown.rows}
              loading={memberBreakdown.loading}
              failedCount={memberBreakdown.failedCount}
            >
              <div className="min-w-0">
                <Statistic
                  value={formatMoneyWan(data.monthActual)}
                  valueStyle={{
                    fontSize: 24,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    letterSpacing: '-0.01em',
                    color: 'var(--foreground)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                />
                <span className="text-micro text-muted-foreground/70">本月合计（万元）</span>
              </div>
            </SummaryBreakdownPopover>
          ) : (
            <div className="min-w-0">
              <Statistic
                value={formatMoneyWan(data.monthActual)}
                valueStyle={{
                  fontSize: 24,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  letterSpacing: '-0.01em',
                  color: 'var(--foreground)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
              <span className="text-micro text-muted-foreground/70">本月合计（万元）</span>
            </div>
          )}
          <div className="shrink-0 text-right">
            <span
              className={cn('font-num block text-lg font-bold leading-tight tracking-tight', rateColorClass(data.monthRate))}
              title="月度预算达成率"
            >
              {rateText(data.monthRate)}
            </span>
            <span className="text-micro text-muted-foreground/70">月度达成率</span>
          </div>
        </div>

        {/* 财年内月度趋势迷你图（数据不足 2 点时不渲染） */}
        {hasTrend && (
          <div className="mb-3 -mx-1 h-10" aria-hidden>
            <KpiSparkline data={data.trend} height={40} />
          </div>
        )}

        <div className="mb-3 h-px bg-border/60" aria-hidden />

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
      </div>
    </AntdCard>
  )
}
