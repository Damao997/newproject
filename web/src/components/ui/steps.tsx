import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StepStatus = 'wait' | 'current' | 'done'

export interface StepItem {
  title: React.ReactNode
  description?: React.ReactNode
  status?: StepStatus
}

export interface StepsProps {
  items: StepItem[]
  /** 当前步骤下标（0-based）；未传则按 item.status 推断 */
  current?: number
  className?: string
}

function statusOf(idx: number, item: StepItem, current?: number): StepStatus {
  if (item.status) return item.status
  if (current === undefined) return 'wait'
  if (idx < current) return 'done'
  if (idx === current) return 'current'
  return 'wait'
}

/**
 * 步骤条：HTML .antd-steps 的 React 实现。
 * 圆 + 序号（done 显示对勾）/ 标题 + 描述 / 步骤间连线（done 用主色）。
 */
export function Steps({ items, current, className }: StepsProps) {
  return (
    <ol className={cn('flex items-start gap-0', className)}>
      {items.map((item, idx) => {
        const status = statusOf(idx, item, current)
        const isDone = status === 'done'
        const isCurrent = status === 'current'
        return (
          <li
            key={idx}
            className={cn(
              'relative flex flex-1 items-start',
              idx < items.length - 1 &&
                "after:absolute after:left-8 after:right-0 after:top-4 after:h-px after:bg-border after:content-['']",
              idx < items.length - 1 && isDone && "after:bg-primary",
            )}
          >
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-card text-sm font-medium text-muted-foreground',
                isCurrent && 'border-primary text-primary shadow-[0_0_0_2px_rgba(22,119,255,0.10)]',
                isDone && 'border-primary bg-primary text-white',
              )}
            >
              {isDone ? <Check className="h-4 w-4" /> : idx + 1}
            </div>
            <div className="ml-3 flex-1 pb-2">
              <div className="text-sm font-medium text-foreground">{item.title}</div>
              {item.description && (
                <div className="mt-1 text-xs text-muted-foreground">{item.description}</div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
