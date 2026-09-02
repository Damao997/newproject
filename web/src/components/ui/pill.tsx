import { cn } from '@/lib/utils'

export type PillTone = 'orange' | 'blue' | 'green' | 'red' | 'gray'

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone
  /** 24 高 / 圆角胶囊；与 HTML .antd-pill 一致 */
  children: React.ReactNode
}

const TONE_CLASS: Record<PillTone, string> = {
  orange: 'bg-orange-50 text-orange-600 border border-orange-100',
  blue: 'bg-blue-1 text-blue-8 border border-blue-2',
  green: 'bg-success-50 text-success-500 border border-success-100',
  red: 'bg-destructive-50 text-destructive-500 border border-destructive-100',
  gray: 'bg-cool-3 text-cool-9',
}

/**
 * 圆角胶囊 24 高：HTML .antd-pill 的 React 实现。
 * 5 色覆盖全部业务语境（业务高亮 / 主信息 / 已达成 / 失败 / 中性）。
 */
export function Pill({ tone = 'gray', children, className, ...rest }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs',
        TONE_CLASS[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
