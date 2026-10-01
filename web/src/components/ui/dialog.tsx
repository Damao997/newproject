import * as React from "react"
import { Modal } from "antd"
import { cn } from "@/lib/utils"

/**
 * Dialog 门面：antd Modal。
 *
 * 保持 Radix Dialog 的组合 API（Dialog/DialogContent/DialogHeader/DialogTitle/
 * DialogDescription/DialogFooter/DialogTrigger/DialogClose）；正文统一使用 DialogBody。
 *
 * 关键映射：
 * - 受控 open/onOpenChange（全站统一用法，DialogTrigger 实际未使用，仍保留兜底实现）
 * - DialogContent 的 className 中 max-w-{md..4xl} 解析为 Modal width；max-h-[XXvh] 限制整个弹窗高度
 * - 内层 flex 三段布局固定标题和按钮，仅 DialogBody 滚动；Tailwind 类完全可控，
 *   不与 antd 样式产生优先级冲突；调用方传 p-0/flex 等类由 twMerge 正常覆盖
 * - ESC/点击遮罩/右上角关闭 → onOpenChange(false)；遮罩色与圆角走 AntdProvider token
 */

interface DialogContextValue {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

const Dialog = ({ open, defaultOpen, onOpenChange, children }: DialogProps) => {
  // 受控优先；未传 open 时退化为非受控（defaultOpen 兜底，现全站均为受控用法）
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const isOpen = open !== undefined ? open : internalOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next)
      if (open === undefined) setInternalOpen(next)
    },
    [onOpenChange, open],
  )
  const value = React.useMemo(() => ({ open: isOpen, onOpenChange: setOpen }), [isOpen, setOpen])
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>
}
Dialog.displayName = "Dialog"

const DialogTrigger = ({
  children,
  asChild,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
  const ctx = React.useContext(DialogContext)
  const handleClick = () => ctx?.onOpenChange(true)
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: (...args: never[]) => void }>
    return React.cloneElement(child, {
      onClick: (...args: never[]) => {
        child.props.onClick?.(...args)
        handleClick()
      },
    })
  }
  return (
    <button type="button" {...props} onClick={(e) => { props.onClick?.(e); handleClick() }}>
      {children}
    </button>
  )
}
DialogTrigger.displayName = "DialogTrigger"

/** Radix 兼容占位（现无外部使用） */
const DialogPortal = ({ children }: { children?: React.ReactNode }) => <>{children}</>
DialogPortal.displayName = "DialogPortal"

/** Radix 兼容占位：遮罩由 antd Modal 提供 */
const DialogOverlay = () => null
DialogOverlay.displayName = "DialogOverlay"

const DialogClose = ({
  children,
  asChild,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
  const ctx = React.useContext(DialogContext)
  const handleClick = () => ctx?.onOpenChange(false)
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: (...args: never[]) => void }>
    return React.cloneElement(child, {
      onClick: (...args: never[]) => {
        child.props.onClick?.(...args)
        handleClick()
      },
    })
  }
  return (
    <button type="button" {...props} onClick={(e) => { props.onClick?.(e); handleClick() }}>
      {children}
    </button>
  )
}
DialogClose.displayName = "DialogClose"

/** className 中 max-w-* → Modal width（px）；sm:/lg: 前缀取最大断言档位 */
const MAX_WIDTH_MAP: Record<string, number> = {
  md: 448,
  lg: 512,
  xl: 576,
  '2xl': 672,
  '3xl': 768,
  '4xl': 896,
}

function parseWidth(className: string): number | undefined {
  // 按档位从大到小检查，取命中的最大档（兼容同时存在 sm:max-w-2xl lg:max-w-4xl 的响应式写法）
  for (const key of ['4xl', '3xl', '2xl', 'xl', 'lg', 'md']) {
    if (new RegExp(`(?:^|\\s)(?:sm:|lg:)?max-w-${key}(?=\\s|$)`).test(className)) {
      return MAX_WIDTH_MAP[key]
    }
  }
  return undefined
}

/** className 中 max-h-[XXvh] → 整个弹窗限高 */
function parseMaxHeight(className: string): string | undefined {
  const m = /max-h-\[(\d+)vh\]/.exec(className)
  return m ? `${m[1]}vh` : undefined
}

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, style, ...props }, ref) => {
    const ctx = React.useContext(DialogContext)
    const width = className ? parseWidth(className) : undefined
    const maxHeight = className ? parseMaxHeight(className) : undefined

    return (
      <Modal
        open={ctx?.open ?? false}
        onCancel={() => ctx?.onOpenChange(false)}
        footer={null}
        title={null}
        centered
        destroyOnHidden
        width={width}
        styles={{
          content: { padding: 0, overflow: 'hidden' },
          body: { padding: 0, display: 'flex', minHeight: 0 },
        }}
      >
        {/* 内容 wrapper：固定头尾与可滚动正文的 flex 布局；
            调用方 className（p-0/flex/max-h 等）经 twMerge 正常覆盖 */}
        <div
          ref={ref}
          data-dialog-content
          className={cn("flex min-h-0 w-full flex-col gap-4 p-6", className, "overflow-hidden")}
          style={{ ...style, boxSizing: 'border-box', maxHeight: maxHeight ? `min(${maxHeight}, calc(100dvh - 32px))` : 'calc(100dvh - 32px)' }}
          {...props}
        >
          {children}
        </div>
      </Modal>
    )
  }
)
DialogContent.displayName = "DialogContent"

/** 正文是弹窗唯一的纵向滚动区域；标题和底部按钮作为同级节点固定。 */
const DialogBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-dialog-body
      className={cn("min-h-0 min-w-0 flex-auto overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  ),
)
DialogBody.displayName = "DialogBody"

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex shrink-0 flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end", className)}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
DialogTitle.displayName = "DialogTitle"

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
))
DialogDescription.displayName = "DialogDescription"

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
