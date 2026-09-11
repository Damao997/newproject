import { cn } from '@/lib/utils'

/** 数据时效/告警条：橙底渐变 + 脉冲点 + 标题 + 可选次级文案（右对齐） */
export interface StaleBarProps {
  /** 主文案（橙 700） */
  children: React.ReactNode
  /** 右侧次级灰字（自动 margin-left: auto） */
  meta?: React.ReactNode
  className?: string
}

/**
 * 数据时效/风险告警条：HTML .antd-stale-bar 的 React 实现。
 * 视觉：8 14 padding / 橙 50→透明横向渐变背景 / 橙 100 边框 / 6px 橙圆点带 4px 光晕脉冲。
 */
export function StaleBar({ children, meta, className }: StaleBarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-antd-md border border-orange-100 bg-gradient-to-r from-orange-50 to-transparent px-[14px] py-2 text-xs text-orange-700',
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500 shadow-[0_0_0_4px_rgba(250,140,22,0.12)] animate-pulse"
        aria-hidden
      />
      <span className="truncate">{children}</span>
      {meta && <span className="ml-auto text-muted-foreground">{meta}</span>}
    </div>
  )
}
