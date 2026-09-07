import { cn } from '@/lib/utils'
import { formatPercent } from '@/lib/utils'

/**
 * 收入类达成率预警圆点（品类/主体预算达成卡用）：达成率 <60 红 / 60-75 黄 / ≥75 绿；
 * 无预算（null）灰灯；悬浮显示达成率数值。
 */
export function AlertLight({ rate }: { rate: number | null }) {
  const cls = rate === null ? 'bg-muted-foreground/40'
    : rate < 60 ? 'bg-destructive'
    : rate < 75 ? 'bg-warning'
    : 'bg-success-strong'
  return <span className={cn('inline-block h-2.5 w-2.5 rounded-full', cls)} title={rate === null ? '无预算' : `达成率 ${formatPercent(rate / 100)}`} />
}

/**
 * 费用类使用率预警圆点（反向规则，超支才警示）：使用率 <75 绿 / 75-100 黄 / >100 红；
 * 无预算（null）灰灯；悬浮显示使用率数值。收入/利润类请用 AlertLight。
 */
export function ExpenseAlertLight({ rate }: { rate: number | null }) {
  const cls = rate === null ? 'bg-muted-foreground/40'
    : rate < 75 ? 'bg-success-strong'
    : rate <= 100 ? 'bg-warning'
    : 'bg-destructive'
  return <span className={cn('inline-block h-2.5 w-2.5 rounded-full', cls)} title={rate === null ? '无预算' : `使用率 ${formatPercent(rate / 100)}`} />
}
