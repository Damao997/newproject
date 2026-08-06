import { cn } from '@/lib/utils'
import { formatPercent } from '@/lib/utils'

/**
 * 达成率/使用率进度条：固定宽度圆角条，橙色填充（品牌橙），条内黑色加粗文字显示百分比。
 * rate 为 null（无预算）显示 "–" 空条；超过 100% 时填充截断 100%，文字显示实际值。
 */
export function RateBar({ rate }: { rate: number | null }) {
  const pct = rate === null ? null : Math.min(Math.max(rate, 0), 100)
  return (
    <span className="inline-flex h-5 w-24 items-center justify-center overflow-hidden rounded bg-muted align-middle">
      {pct === null ? (
        <span className="text-xs text-muted-foreground">–</span>
      ) : (
        <span className="relative flex h-full w-full items-center justify-center">
          <span className={cn('absolute inset-y-0 left-0 bg-primary')} style={{ width: `${pct}%` }} />
          <span className="relative font-num text-xs font-bold text-black">{formatPercent(rate! / 100)}</span>
        </span>
      )}
    </span>
  )
}
