import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 仅计算视觉尺度，不负责金额、百分比或空值的业务格式化。 */
export function magnitudeMaximum(values: readonly (number | null | undefined)[]): number {
  return values.reduce<number>((max, value) => value != null && Number.isFinite(value) ? Math.max(max, Math.abs(value)) : max, 0)
}

/** 同一数值列按绝对值显示浅色底面；符号、精度和空值仍由调用方提供。 */
export function MagnitudeValue({ value, maximum, children, className }: {
  value: number | null | undefined; maximum: number; children: ReactNode; className?: string
}) {
  const alpha = value != null && Number.isFinite(value) && value !== 0 && maximum > 0
    ? .04 + Math.min(1, Math.abs(value) / maximum) * .14 : 0
  return <span className={cn('magnitude-value', className)}
    style={{ '--aging-cell-alpha': alpha } as CSSProperties}>{children}</span>
}
