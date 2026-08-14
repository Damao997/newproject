import { cn } from '@/lib/utils'
import { formatPercent } from '@/lib/utils'

/**
 * 达成率/使用率进度条：固定宽度圆角条，填充色跟随图表主色（--chart-1，随侧边栏风格切换：橙/亮紫/中性蓝灰）。
 * rate 语义：default 变体传 0-100 百分比数值（dashboard 传 monthRate 96.5 等）；above 变体传 0-1 小数（与 calcAchievement 返回值一致）。
 * variant="default"：条内黑色加粗文字显示百分比（dashboard 卡牌使用）；
 * variant="above"：百分比文字浮于色条上方（财务指标表格达成率单元格使用）。
 * rate 为 null（无预算）显示 "–" 空条；超过 100% 时填充截断 100%，文字显示实际值。
 */
export function RateBar({ rate, variant = 'default' }: { rate: number | null; variant?: 'default' | 'above' }) {
  const pct = rate === null ? null : Math.min(Math.max(rate, 0), variant === 'above' ? 1 : 100)
  if (variant === 'above') {
    return (
      <span className="inline-flex flex-col items-center gap-0.5">
        <span className="font-num text-xs font-bold leading-none text-foreground">
          {rate === null ? '–' : formatPercent(rate)}
        </span>
        <span className="inline-block h-2 w-24 overflow-hidden rounded bg-muted">
          {pct !== null && <span className="block h-full bg-chart-1" style={{ width: `${pct * 100}%` }} />}
        </span>
      </span>
    )
  }
  return (
    <span className="inline-flex h-5 w-24 items-center justify-center overflow-hidden rounded bg-muted align-middle">
      {pct === null ? (
        <span className="text-xs text-muted-foreground">–</span>
      ) : (
        <span className="relative flex h-full w-full items-center justify-center">
          <span className={cn('absolute inset-y-0 left-0 bg-chart-1')} style={{ width: `${pct}%` }} />
          <span className="relative font-num text-xs font-bold text-foreground">{formatPercent(rate! / 100)}</span>
        </span>
      )}
    </span>
  )
}
