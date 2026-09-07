import { cn } from '@/lib/utils'

export interface DeltaTagProps {
  /** 涨跌比率（小数形式，0.125 = 12.5%；|value| < 0.05% 或非有限值视为持平） */
  value: number
  /** 单位后缀，默认 '%' */
  unit?: string
  /** 追加类名（如 ml-1 外边距） */
  className?: string
}

/**
 * 涨跌胶囊标识（红涨绿跌，A 股/国内财报习惯）：浅底深字胶囊 + 符号前缀 +x.x% / -x.x%，
 * 持平显示 0.0% 灰胶囊。涨跌语义为「数值变化方向」：费用/占用类指标同比上升同样红涨（越警示）。
 * 输入为小数比率；库存等接口返回百分数（×100）时需先除以 100。
 */
export function DeltaTag({ value, unit = '%', className }: DeltaTagProps) {
  const isFlat = !Number.isFinite(value) || Math.abs(value) < 0.0005
  const tone = isFlat
    ? 'bg-muted text-muted-foreground border-transparent'
    : value > 0
      ? 'bg-finance-red/10 text-finance-red border-finance-red/20'
      : 'bg-finance-green/10 text-finance-green border-finance-green/20'
  const text = isFlat
    ? `0.0${unit}`
    : `${value > 0 ? '+' : '-'}${(Math.abs(value) * 100).toFixed(1)}${unit}`
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full border px-2 py-0.5 font-num text-xs tabular-nums whitespace-nowrap',
        tone,
        className,
      )}
    >
      {text}
    </span>
  )
}
