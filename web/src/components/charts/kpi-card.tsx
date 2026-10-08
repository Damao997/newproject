import { Statistic } from 'antd'
import { Card } from '@/components/ui/card'
import {
  ArrowDown,
  ArrowUp,
  CircleHelp,
  Minus,
} from 'lucide-react'
import { KpiSparkline } from './kpi-sparkline'
import { SummaryBreakdownPopover } from '@/components/summary/summary-breakdown'
import { ACHIEVEMENT_RATE_THRESHOLDS } from '@/lib/constants'
import { formatMoneyWan } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { MemberBreakdown } from '@/hooks/use-summary-member-values'
import type { KpiData } from '@/types'
import { getAppTheme } from '@/lib/app-theme'
import { useThemeStore } from '@/stores/themeStore'
import type { PersonalPreferences } from '@/lib/personal-settings'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface KpiCardProps {
  data: KpiData
  mode?: PersonalPreferences['dashboardKpiMode']
  /** 兼容原有列表调用；指标颜色由标题身份决定。 */
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

/** 卡片百分比统一两位小数；无预算不混同于完成率为零。 */
function rateText(rate: number | null): string {
  return rate === null ? '—' : `${rate.toFixed(2)}%`
}

/** 达成率红绿灯三档：≥75 达标绿 / 60-75 预警黄 / <60 未达标红；无预算灰（阈值见 ACHIEVEMENT_RATE_THRESHOLDS）。
 * 导出供其他达成率文本（如主体预算内容页大数字）复用，保证全站红绿灯分档一致 */
export function rateColorClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground'
  if (rate >= ACHIEVEMENT_RATE_THRESHOLDS.PASS) return 'text-success-strong'
  if (rate >= ACHIEVEMENT_RATE_THRESHOLDS.WARN) return 'text-warning-strong'
  return 'text-destructive'
}

/** 涨跌只用颜色和尾部竖直箭头表达，持平仍保留完整读数。 */
function KpiChange({ value }: { value: number }) {
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus
  const direction = value > 0 ? '上升' : value < 0 ? '下降' : '持平'
  return <span className={cn('kpi-change', value > 0 ? 'text-finance-red' : value < 0 ? 'text-finance-green' : 'text-muted-foreground')}>
    <span className="font-num">{`${(Math.abs(value) * 100).toFixed(2)}%`}</span>
    <Icon className="kpi-change-icon" aria-hidden />
    <span className="sr-only">{direction}</span>
  </span>
}

function KpiMonthChange({ data }: { data: KpiData }) {
  if (data.monthMom != null) return <KpiChange value={data.monthMom} />
  const reason = data.monthMomReason === 'zero-base' ? '上月金额为 0，无法计算环比' : '上月无数据，无法计算环比'
  return <Popover trigger={['click', 'hover', 'focus']}>
    <PopoverTrigger asChild>
      <button type="button" className="kpi-comparison-help" aria-label={`月度环比：${reason}`} onClick={event => event.stopPropagation()}>
        <span>—</span><CircleHelp aria-hidden />
      </button>
    </PopoverTrigger>
    <PopoverContent className="max-w-[260px] rounded-control border border-border bg-popover p-3 text-xs text-popover-foreground" side="top">
      {reason}
    </PopoverContent>
  </Popover>
}

export function KpiCard({ data, mode = 'month', onClick, breakdown }: KpiCardProps) {
  const style = useThemeStore((state) => state.printing ? 'light' : state.sidebarStyle)
  const metricIndex = /毛利/.test(data.title) ? 1 : /净利|利润/.test(data.title) ? 2 : /回款|收款/.test(data.title) ? 3 : 0
  const metricColor = getAppTheme(style).metricInks[metricIndex]
  const monthly = mode === 'month'
  const mainActual = monthly ? data.monthActual : data.ytdActual
  const mainRate = monthly ? data.monthRate : data.ytdRate
  const otherRate = monthly ? data.ytdRate : data.monthRate
  const hasTrend = monthly && data.trend.length > 1
  // 汇总主体成员明细：hover 大数字区展示各成员公司 本月实际/本年累计（数据由看板页预取注入）
  const memberBreakdown = breakdown?.getMemberValues(data.title)
  const mainValue = <div className="kpi-main-value">
    <Statistic value={formatMoneyWan(mainActual)} />
    <span className="kpi-amount-caption">{monthly ? '本月实际' : '财年累计实际'} · 万元</span>
  </div>

  return (
    <Card variant="metric"
      className={cn(
        'kpi-card group relative overflow-hidden transition-colors duration-200',
        onClick && 'cursor-pointer hover:border-primary/40',
      )}
      data-metric-tone={metricIndex + 1}
      data-kpi-mode={mode}
      data-value-size={formatMoneyWan(mainActual).length > 10 ? 'long' : 'normal'}
      onClick={event => {
        // 帮助浮层和内部按钮不触发卡片钻取，浮层门户也不冒泡为卡片导航。
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
        if (event.target instanceof Element && event.target.closest('button, a, [role="button"]')) return
        onClick?.()
      }}
      role={onClick ? 'link' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onClick?.()
        }
      }}
      aria-label={onClick ? `${data.title}：点击查看财务指标明细` : undefined}
    >
      <div className="kpi-content">
        {/* 指标身份决定底面与曲线颜色，排序和过滤不改变含义。 */}
        <div className="kpi-card-heading">
          <span className="text-sm font-semibold tracking-tight text-foreground">{data.title}</span>
          <span className="kpi-mode-tag">{monthly ? '月度' : '财年累计'}</span>
        </div>

        {/* 大数字区：本月合计 + 月度达成率（分级色）；汇总口径时大数字悬浮展示成员公司明细 */}
        <div className="kpi-value-row">
          {memberBreakdown ? (
            <SummaryBreakdownPopover
              title={data.title}
              columns={[
                ...(monthly ? [
                  { label: '本月实际', pick: (v: MemberBreakdown['rows'][number]['value']) => v.actual, summaryValue: data.monthActual },
                  { label: '财年累计', pick: (v: MemberBreakdown['rows'][number]['value']) => v.ytd, summaryValue: data.ytdActual },
                ] : [
                  { label: '财年累计', pick: (v: MemberBreakdown['rows'][number]['value']) => v.ytd, summaryValue: data.ytdActual },
                  { label: '本月实际', pick: (v: MemberBreakdown['rows'][number]['value']) => v.actual, summaryValue: data.monthActual },
                ]),
              ]}
              rows={memberBreakdown.rows}
              loading={memberBreakdown.loading}
              failedCount={memberBreakdown.failedCount}
            >
              {mainValue}
            </SummaryBreakdownPopover>
          ) : (
            mainValue
          )}
        </div>

        <dl className="kpi-indicators" data-count={monthly ? 3 : 2}>
          <div className="kpi-indicator"><dt>{monthly ? '预算达成' : '年度预算完成'}</dt><dd className={cn('font-num', rateColorClass(mainRate))}>{rateText(mainRate)}</dd></div>
          <div className="kpi-indicator"><dt>{monthly ? '月度同比' : '累计同比'}</dt><dd><KpiChange value={monthly ? data.yoy : data.ytdYoy} /></dd></div>
          {monthly && <div className="kpi-indicator"><dt>月度环比</dt><dd><KpiMonthChange data={data} /></dd></div>}
        </dl>

        {/* 财年内月度趋势迷你图（数据不足 2 点时不渲染） */}
        {hasTrend && (
          <div className="kpi-trend" aria-hidden>
            <KpiSparkline data={data.trend} height={40} color={metricColor} />
          </div>
        )}

        {/* 另一口径保留金额与预算摘要；累计模式不保留趋势空位。 */}
        <dl className="kpi-details">
          <div><dt>{monthly ? '财年累计' : '本月实际'}</dt><dd className="font-num text-foreground">{formatMoneyWan(monthly ? data.ytdActual : data.monthActual)}</dd></div>
          <div><dt>{monthly ? '年度预算完成率' : '月度预算达成率'}</dt><dd className={cn('font-num', rateColorClass(otherRate))}>{rateText(otherRate)}</dd></div>
        </dl>
      </div>
    </Card>
  )
}
