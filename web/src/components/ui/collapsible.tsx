import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 轻量折叠容器（零依赖，替代未安装的 @radix-ui/react-collapsible）。
 *
 * 受控（传 open + onOpenChange）或非受控（defaultOpen）两用；
 * 触发区为整行可点击按钮（render-prop 拿到当前展开态自定义指示器），
 * 内容区收起时以 grid-rows 0fr + visibility:hidden 平滑过渡（200ms，
 * prefers-reduced-motion 由全局 transition 降级兜底），并通过 aria-expanded / aria-controls 关联。
 */
interface CollapsibleProps {
  /** 受控展开状态；不传时由内部管理（配合 defaultOpen） */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 非受控初始状态，默认展开 */
  defaultOpen?: boolean
  /** 触发区内容（整行可点击），入参为当前展开态；缺省时不渲染触发按钮（控制权交由外部受控） */
  trigger?: (open: boolean) => ReactNode
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
      {trigger && (
        <button
          type="button"
          aria-expanded={actualOpen}
          aria-controls={panelId}
          onClick={handleToggle}
          className={cn('block w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ring')}
        >
          {trigger(actualOpen)}
        </button>
      )}
      {/* grid-rows 过渡：0fr 收起到 1fr 展开；invisible 在收起动画结束后隐藏内容，防止键盘聚焦到隐藏区域 */}
      <div
        id={panelId}
        className={cn(
          'grid transition-[grid-template-rows,visibility] duration-200 ease-brand',
          actualOpen ? 'grid-rows-[1fr] visible' : 'grid-rows-[0fr] invisible'
        )}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
