import * as React from "react"
import { Dropdown } from "antd"
import { Check, ChevronRight, Circle } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * DropdownMenu 门面：antd Dropdown（触发/定位/浮层动效与外壳）+ 自定义面板内容。
 *
 * 保留 Radix DropdownMenu 的组合 API 与交互语义（13 处调用点零改动）：
 * - Item 的 onSelect(e)：e.preventDefault() 则点击后不关闭（多选/清空等场景）；
 * - CheckboxItem/RadioItem 原生支持勾选/单选组，不随 antd Menu 的"点击即关"语义；
 * - Label/Separator/自定义内容块（header 用户信息头等）直接渲染在面板内。
 *
 * 面板由 antd Dropdown 的 dropdownRender 承载：.ant-dropdown 提供白底/阴影/圆角外壳
 * （token 驱动，跟随主题），内部条目样式沿用 Radix 版 Tailwind 类（已是 antd 菜单观感）。
 */

interface DropdownMenuContextValue {
  close: () => void
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null)

/** onSelect 合成事件：preventDefault → 不关闭菜单 */
interface SyntheticSelectEvent {
  preventDefault: () => void
  defaultPrevented: boolean
}

function makeSelectEvent(): SyntheticSelectEvent {
  const e: SyntheticSelectEvent = {
    defaultPrevented: false,
    preventDefault: () => {
      e.defaultPrevented = true
    },
  }
  return e
}

/** 触发 item 点击的统一收口：先 onClick，再 onSelect 语义（未阻止则关闭） */
function useItemActivate(onClick?: React.MouseEventHandler, onSelect?: (e: SyntheticSelectEvent) => void) {
  const ctx = React.useContext(DropdownMenuContext)
  return (e: React.MouseEvent) => {
    onClick?.(e)
    if (onSelect) {
      const ev = makeSelectEvent()
      onSelect(ev)
      if (ev.defaultPrevented) return
    }
    ctx?.close()
  }
}

interface DropdownMenuProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
  /** 无障碍：传给触发器 */
  'aria-label'?: string
}

const DropdownMenu = ({ open, defaultOpen, onOpenChange, children }: DropdownMenuProps) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const isOpen = open !== undefined ? open : internalOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next)
      if (open === undefined) setInternalOpen(next)
    },
    [onOpenChange, open],
  )

  // ---- 声明式子组件收集：Trigger（触发元素）+ Content（面板内容与对齐） ----
  const collected: {
    trigger?: React.ReactNode
    panelChildren?: React.ReactNode
    panelClassName?: string
    align: 'start' | 'center' | 'end'
    side: 'top' | 'bottom' | 'left' | 'right'
  } = { align: 'center', side: 'bottom' }

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === DropdownMenuTrigger) {
      collected.trigger = (child.props as { children?: React.ReactNode }).children
    } else if (child.type === DropdownMenuContent) {
      const p = child.props as { children?: React.ReactNode; className?: string; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'left' | 'right' }
      collected.panelChildren = p.children
      collected.panelClassName = p.className
      if (p.align) collected.align = p.align
      if (p.side) collected.side = p.side
    }
  })

  const { align, side } = collected
  // antd Dropdown 支持 6 个方位（无 left/right）；side 仅 top/bottom 生效
  const placement: 'topLeft' | 'top' | 'topRight' | 'bottomLeft' | 'bottom' | 'bottomRight' =
    side === 'top'
      ? align === 'start' ? 'topLeft' : align === 'end' ? 'topRight' : 'top'
      : align === 'start' ? 'bottomLeft' : align === 'end' ? 'bottomRight' : 'bottom'

  const ctx = React.useMemo(() => ({ close: () => setOpen(false) }), [setOpen])

  return (
    <DropdownMenuContext.Provider value={ctx}>
      <Dropdown
        open={isOpen}
        onOpenChange={setOpen}
        trigger={['click']}
        placement={placement}
        dropdownRender={() => (
          <div
            role="menu"
            className={cn('min-w-[8rem] p-1', collected.panelClassName)}
          >
            {collected.panelChildren}
          </div>
        )}
      >
        {collected.trigger as React.ReactNode}
      </Dropdown>
    </DropdownMenuContext.Provider>
  )
}
DropdownMenu.displayName = "DropdownMenu"

interface DropdownMenuTriggerProps {
  children?: React.ReactNode
  asChild?: boolean
}

const DropdownMenuTrigger = (_props: DropdownMenuTriggerProps) => null
DropdownMenuTrigger.displayName = "DropdownMenuTrigger"

interface DropdownMenuContentProps {
  children?: React.ReactNode
  className?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  sideOffset?: number
  forceMount?: boolean
}

const DropdownMenuContent = (_props: DropdownMenuContentProps) => null
DropdownMenuContent.displayName = "DropdownMenuContent"

interface DropdownMenuItemProps extends React.HTMLAttributes<HTMLDivElement> {
  inset?: boolean
  disabled?: boolean
  onSelect?: (e: SyntheticSelectEvent) => void
}

const DropdownMenuItem = React.forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  ({ className, inset, disabled, onClick, onSelect, ...props }, ref) => {
    const activate = useItemActivate(onClick, onSelect)
    return (
      <div
        ref={ref}
        role="menuitem"
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className={cn(
          "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50",
          inset && "pl-8",
          className
        )}
        onClick={disabled ? undefined : activate}
        {...props}
      />
    )
  }
)
DropdownMenuItem.displayName = "DropdownMenuItem"

interface DropdownMenuCheckboxItemProps {
  children?: React.ReactNode
  className?: string
  checked?: boolean
  disabled?: boolean
  onCheckedChange?: (checked: boolean) => void
  onSelect?: (e: SyntheticSelectEvent) => void
}

const DropdownMenuCheckboxItem = ({
  className,
  children,
  checked,
  disabled,
  onCheckedChange,
  onSelect,
}: DropdownMenuCheckboxItemProps) => {
  const activate = useItemActivate(undefined, onSelect)
  return (
    <div
      role="menuitemcheckbox"
      aria-checked={checked}
      aria-disabled={disabled}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent aria-disabled:pointer-events-none aria-disabled:opacity-50",
        className
      )}
      onClick={disabled ? undefined : () => {
        onCheckedChange?.(!checked)
        activate({} as React.MouseEvent)
      }}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        {checked && <Check className="h-4 w-4" />}
      </span>
      {children}
    </div>
  )
}
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem"

/** RadioGroup 上下文：value + onValueChange */
const RadioGroupContext = React.createContext<{ value?: string; onValueChange?: (v: string) => void } | null>(null)

interface DropdownMenuRadioGroupProps {
  value?: string
  onValueChange?: (value: string) => void
  children?: React.ReactNode
}

const DropdownMenuRadioGroup = ({ value, onValueChange, children }: DropdownMenuRadioGroupProps) => (
  <RadioGroupContext.Provider value={{ value, onValueChange }}>{children}</RadioGroupContext.Provider>
)
DropdownMenuRadioGroup.displayName = "DropdownMenuRadioGroup"

interface DropdownMenuRadioItemProps {
  children?: React.ReactNode
  className?: string
  value: string
  disabled?: boolean
  onSelect?: (e: SyntheticSelectEvent) => void
}

const DropdownMenuRadioItem = ({ className, children, value, disabled, onSelect }: DropdownMenuRadioItemProps) => {
  const group = React.useContext(RadioGroupContext)
  const checked = group?.value === value
  const activate = useItemActivate(undefined, onSelect)
  return (
    <div
      role="menuitemradio"
      aria-checked={checked}
      aria-disabled={disabled}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent aria-disabled:pointer-events-none aria-disabled:opacity-50",
        className
      )}
      onClick={disabled ? undefined : () => {
        group?.onValueChange?.(value)
        activate({} as React.MouseEvent)
      }}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        {checked && <Circle className="h-2 w-2 fill-current" />}
      </span>
      {children}
    </div>
  )
}
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem"

const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = "DropdownMenuLabel"

const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
))
DropdownMenuSeparator.displayName = "DropdownMenuSeparator"

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props}
    />
  )
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

/** Radix 兼容占位（现无外部使用） */
const DropdownMenuGroup = ({ children }: { children?: React.ReactNode }) => <>{children}</>
DropdownMenuGroup.displayName = "DropdownMenuGroup"

const DropdownMenuPortal = ({ children }: { children?: React.ReactNode }) => <>{children}</>
DropdownMenuPortal.displayName = "DropdownMenuPortal"

const DropdownMenuSub = ({ children }: { children?: React.ReactNode }) => <>{children}</>
DropdownMenuSub.displayName = "DropdownMenuSub"

const DropdownMenuSubTrigger = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }
>(({ className, inset, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </div>
))
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger"

const DropdownMenuSubContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg", className)}
    {...props}
  />
))
DropdownMenuSubContent.displayName = "DropdownMenuSubContent"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}
