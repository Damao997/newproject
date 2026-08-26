import * as React from "react"
import { Popover as AntdPopover } from "antd"
import { cn } from "@/lib/utils"

/**
 * Popover 门面：antd Popover。
 *
 * 保持 Radix Popover 的组合 API（Popover/PopoverTrigger/PopoverContent），
 * MonthPicker（数据圆点宫格）、CompanyMultiSelect、侧边栏 desktop-dropdown 等自动受益。
 *
 * 关键映射：
 * - 受控 open/onOpenChange 透传（antd 同签名）；
 * - trigger 固定 "click"（Radix 默认点击开合；antd 默认 hover，必须显式覆盖）；
 * - PopoverContent 的 align/side → antd placement；className 由内容 wrapper div 承载
 *   （antd 内层 padding 置零，调用方的宽度与内边距类完全生效）；
 * - 无箭头（对齐 Radix 默认）。
 */

interface PopoverContentProps {
  children?: React.ReactNode
  className?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  sideOffset?: number
}

interface PopoverProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function toPlacement(side: 'top' | 'bottom' | 'left' | 'right', align: 'start' | 'center' | 'end') {
  if (side === 'bottom') return align === 'start' ? 'bottomLeft' : align === 'end' ? 'bottomRight' : 'bottom'
  if (side === 'top') return align === 'start' ? 'topLeft' : align === 'end' ? 'topRight' : 'top'
  if (side === 'left') return align === 'start' ? 'leftTop' : align === 'end' ? 'leftBottom' : 'left'
  return align === 'start' ? 'rightTop' : align === 'end' ? 'rightBottom' : 'right'
}

const Popover = ({ open, defaultOpen, onOpenChange, children }: PopoverProps) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const isOpen = open !== undefined ? open : internalOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next)
      if (open === undefined) setInternalOpen(next)
    },
    [onOpenChange, open],
  )

  // ---- 声明式子组件收集 ----
  let trigger: React.ReactNode
  let contentChildren: React.ReactNode
  let contentClassName: string | undefined
  let align: 'start' | 'center' | 'end' = 'center'
  let side: 'top' | 'bottom' | 'left' | 'right' = 'bottom'

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === PopoverTrigger) {
      trigger = (child.props as { children?: React.ReactNode }).children
    } else if (child.type === PopoverContent) {
      const p = child.props as PopoverContentProps
      contentChildren = p.children
      contentClassName = p.className
      if (p.align) align = p.align
      if (p.side) side = p.side
    }
  })

  return (
    <AntdPopover
      open={isOpen}
      onOpenChange={setOpen}
      trigger="click"
      placement={toPlacement(side, align)}
      arrow={false}
      // 内层 padding 置零：调用方 className 的宽度与内边距类完全生效（原 Radix 语义）
      overlayInnerStyle={{ padding: 0 }}
      content={<div className={cn(contentClassName)}>{contentChildren}</div>}
    >
      {trigger as React.ReactNode}
    </AntdPopover>
  )
}
Popover.displayName = "Popover"

interface PopoverTriggerProps {
  children?: React.ReactNode
  asChild?: boolean
}

const PopoverTrigger = (_props: PopoverTriggerProps) => null
PopoverTrigger.displayName = "PopoverTrigger"

/** Radix 兼容占位：锚点由 antd 触发元素自身承担 */
const PopoverAnchor = (_props: { children?: React.ReactNode }) => null
PopoverAnchor.displayName = "PopoverAnchor"

const PopoverContent = (_props: PopoverContentProps) => null
PopoverContent.displayName = "PopoverContent"

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
