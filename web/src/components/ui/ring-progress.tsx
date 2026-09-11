import { cn } from '@/lib/utils'

export type RingTone = 'blue' | 'orange' | 'green'

export interface RingProgressProps {
  /** 0~100 */
  value: number
  /** 主色，默认 orange；blue/green 来自 antd-state-success / color-primary */
  tone?: RingTone
  /** 直径（px），默认 64 */
  size?: number
  /** 环厚（px），默认 6 */
  thickness?: number
  /** 中间显示文案（如百分比）；不传则不渲染 */
  label?: React.ReactNode
  className?: string
  /** ARIA：进度条无障碍标签 */
  ariaLabel?: string
}

const TONE_BG: Record<RingTone, string> = {
  blue: 'bg-blue-8',
  orange: 'bg-orange-500',
  green: 'bg-success-500',
}

/**
 * 环形进度：基于 conic-gradient 的轻量环（无 ECharts 依赖）。
 * HTML .antd-ring-progress 的 React 实现：外环着色 + 内圆挖空 + 居中数字。
 * 颜色随 tone 切换；尺寸/厚度/百分比均可控。
 */
export function RingProgress({
  value,
  tone = 'orange',
  size = 64,
  thickness = 6,
  label,
  className,
  ariaLabel,
}: RingProgressProps) {
  const pct = Math.max(0, Math.min(100, value))
  const sizeStyle = { width: size, height: size, '--thickness': `${thickness}px` } as React.CSSProperties
  const labelColorClass =
    tone === 'blue' ? 'text-blue-8' : tone === 'green' ? 'text-success-500' : 'text-orange-500'

  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex items-center justify-center rounded-full',
        TONE_BG[tone],
        className,
      )}
      style={{
        ...sizeStyle,
        background: `conic-gradient(currentColor ${pct * 3.6}deg, hsl(var(--muted)) 0)`,
      }}
    >
      <span
        className="absolute rounded-full bg-card"
        style={{ inset: thickness }}
        aria-hidden
      />
      {label !== undefined && (
        <span className={cn('relative z-[1] font-num text-[13px] font-semibold', labelColorClass)}>
          {label}
        </span>
      )}
    </div>
  )
}
