import { cn } from '@/lib/utils'

export type StatusVariant = 'active' | 'idle' | 'error' | 'warning'

const dotColor: Record<StatusVariant, string> = {
  active: 'bg-success',
  idle: 'bg-muted-foreground',
  error: 'bg-destructive',
  warning: 'bg-warning',
}

const labelColor: Record<StatusVariant, string> = {
  active: 'text-success-strong',
  idle: 'text-muted-foreground',
  error: 'text-destructive',
  warning: 'text-warning-strong',
}

interface StatusIndicatorProps {
  /** 状态类型，决定圆点与文本颜色 */
  variant?: StatusVariant
  /** 状态文案 */
  label?: string
  /** 是否显示脉冲动画（仅 active 生效），借鉴 demo-2 的运行中指示 */
  pulse?: boolean
  /** 文案是否使用状态色，缺省用次要文本色 */
  colored?: boolean
  className?: string
}

/**
 * 状态指示器：脉冲圆点 + 文案。
 *
 * 借鉴 demo-2「微前端控制台」的模块运行状态指示（运行中/已停止），
 * 用于表达实时同步、系统健康等状态。
 */
export function StatusIndicator({
  variant = 'active',
  label,
  pulse = true,
  colored = false,
  className,
}: StatusIndicatorProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="relative flex h-2 w-2">
        {pulse && variant === 'active' && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
              dotColor[variant],
            )}
          />
        )}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', dotColor[variant])} />
      </span>
      {label && (
        <span className={cn('text-xs', colored ? labelColor[variant] : 'text-muted-foreground')}>
          {label}
        </span>
      )}
    </span>
  )
}
