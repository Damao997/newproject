import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 轻量折叠容器（零依赖，替代未安装的 @radix-ui/react-collapsible）。
 *
 * 受控（传 open + onOpenChange）或非受控（defaultOpen）两用；
 * 触发区为整行可点击按钮（render-prop 拿到当前展开态自定义指示器），
 * 内容区收起时以 hidden 隐藏并通过 aria-expanded / aria-controls 关联。
 */
interface CollapsibleProps {
  /** 受控展开状态；不传时由内部管理（配合 defaultOpen） */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 非受控初始状态，默认展开 */
  defaultOpen?: boolean
  /** 触发区内容（整行可点击），入参为当前展开态 */
  trigger: (open: boolean) => ReactNode
  children: ReactNode
  className?: string
}

export function Collapsible({ open, onOpenChange, defaultOpen = true, trigger, children, className }: CollapsibleProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isControlled = open !== undefined
  const actualOpen = isControlled ? open : internalOpen
  const panelId = useId()

  const handleToggle = () => {
    const next = !actualOpen
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={actualOpen}
        aria-controls={panelId}
        onClick={handleToggle}
        className={cn('w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ring')}
      >
        {trigger(actualOpen)}
      </button>
      <div id={panelId} hidden={!actualOpen}>
        {children}
      </div>
    </div>
  )
}
