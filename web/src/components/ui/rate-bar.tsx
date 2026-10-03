import { formatPercent } from '@/lib/utils'

/** default 接收百分数，above 接收比例；轨道截断到 100%，读数保留实际值与空值。 */
export function RateBar({ rate, variant = 'default' }: { rate: number | null; variant?: 'default' | 'above' }) {
  const percentage = rate === null ? 0 : (variant === 'above' ? rate * 100 : rate)
  const width = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0
  return <span className="rate-bar" data-rate-variant={variant}>
    <span className="rate-bar-track" aria-hidden><span className="rate-bar-fill" style={{ width: `${width}%` }} /></span>
    <span className="rate-bar-value font-num">{rate === null ? '–' : formatPercent(variant === 'above' ? rate : rate / 100)}</span>
  </span>
}
