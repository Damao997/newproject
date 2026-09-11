import * as React from "react"
import { Tooltip as AntdTooltip } from "antd"
import { cn } from "@/lib/utils"

/**
 * Tooltip 门面：antd Tooltip（深色浮层，antd 原生观感）。
 *
 * 保持 Radix Tooltip 的组合 API（Tooltip/TooltipTrigger/TooltipContent/TooltipProvider）。
 * TooltipProvider 为透传容器（antd 无全局 Provider 需求，delayDuration 忽略——antd 默认 100ms）。
 * TooltipContent 的 side → antd placement；className 由 title 内 wrapper 承载。
 *
 * 外部注入的额外 props/ref（如被 antd Popover/Dropdown 作为触发子元素克隆时注入的 onClick）
 * 会透传到真实触发元素上，保证嵌套组合（侧边栏 desktop-dropdown）可用。
 */

interface TooltipContentProps {
  children?: React.ReactNode
  className?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}

interface TooltipProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** 忽略：antd 默认 100ms 延迟 */
  delayDuration?: number
  children?: React.ReactNode
}

/** 嵌套组合时外层 antd 组件（Popover/Dropdown）cloneElement 注入的 props */
interface TooltipInjectedProps {
  onClick?: React.MouseEventHandler
  onMouseEnter?: React.MouseEventHandler
  onMouseLeave?: React.MouseEventHandler
  onFocus?: React.FocusEventHandler
  onBlur?: React.FocusEventHandler
  className?: string
  style?: React.CSSProperties
}

const Tooltip = React.forwardRef<HTMLElement, TooltipProps & TooltipInjectedProps>(
  ({ open, onOpenChange, delayDuration, children, ...rest }, ref) => {
    void delayDuration
    // ---- 声明式子组件收集 ----
    const collected: {
      trigger?: React.ReactNode
      content?: React.ReactNode
      contentClassName?: string
      side: 'top' | 'bottom' | 'left' | 'right'
      align: 'start' | 'center' | 'end'
    } = { side: 'top', align: 'center' }

    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return
      if (child.type === TooltipTrigger) {
        collected.trigger = (child.props as { children?: React.ReactNode }).children
      } else if (child.type === TooltipContent) {
        const p = child.props as TooltipContentProps
        collected.content = p.children
        collected.contentClassName = p.className
        if (p.side) collected.side = p.side
        if (p.align) collected.align = p.align
      }
    })
    const { trigger, content, contentClassName, side, align } = collected

    // side + align → antd placement（12 方位）
    const placement =
      side === 'top'
        ? align === 'start' ? 'topLeft' : align === 'end' ? 'topRight' : 'top'
        : side === 'bottom'
          ? align === 'start' ? 'bottomLeft' : align === 'end' ? 'bottomRight' : 'bottom'
          : side === 'left'
            ? align === 'start' ? 'leftTop' : align === 'end' ? 'leftBottom' : 'left'
            : align === 'start' ? 'rightTop' : align === 'end' ? 'rightBottom' : 'right'

    // 透传注入 props/ref 到触发元素（供外层 antd Popover/Dropdown 克隆注入事件）
    const triggerEl = React.isValidElement(trigger)
      ? React.cloneElement(trigger as React.ReactElement<TooltipInjectedProps>, {
          ...rest,
          ref,
        } as Partial<TooltipInjectedProps> & { ref?: React.Ref<HTMLElement> })
      : trigger

    return (
      <AntdTooltip
        title={content === undefined ? content : <div className={cn(contentClassName)}>{content}</div>}
        open={open}
        onOpenChange={onOpenChange}
        placement={placement}
      >
        {triggerEl as React.ReactNode}
      </AntdTooltip>
    )
  }
)
Tooltip.displayName = "Tooltip"

interface TooltipTriggerProps {
  children?: React.ReactNode
  asChild?: boolean
}

const TooltipTrigger = (_props: TooltipTriggerProps) => null
TooltipTrigger.displayName = "TooltipTrigger"

const TooltipContent = (_props: TooltipContentProps) => null
TooltipContent.displayName = "TooltipContent"

/** Radix 兼容：透传容器（delayDuration 由 antd 默认值承担） */
const TooltipProvider = ({ children }: { children?: React.ReactNode; delayDuration?: number }) => (
  <>{children}</>
)
TooltipProvider.displayName = "TooltipProvider"

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
