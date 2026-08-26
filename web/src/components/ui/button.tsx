import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Button as AntdButton } from "antd"
import { cn } from "@/lib/utils"
import { antdSizeFromClassName } from "./antd-size"

/**
 * asChild 路径专用样式（antd Button 不支持 Slot 嵌套任意元素）：
 * 仅 asChild 时走 cva 渲染，样式与 antd 同 token 体系（bg-primary 即品牌主色 HSL 变量）。
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-page hover:border-primary hover:bg-accent hover:text-accent-foreground focus-visible:border-input",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // 融合风格：基础态与页面底色（bg-page）同色 + 灰色描边，悬停/激活时描边变品牌色（antd default 按钮 hover 语义一致）
        fused:
          "border border-input bg-page text-foreground hover:border-primary hover:bg-primary/10 hover:text-primary active:border-primary focus-visible:border-input",
      },
      size: {
        default: "h-8 px-4 py-2",
        sm: "h-8 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/** variant → antd type/danger 映射 */
function toAntdType(variant?: string | null): { type?: 'primary' | 'default' | 'text' | 'link'; danger?: boolean; className?: string } {
  switch (variant) {
    case 'destructive':
      return { type: 'primary', danger: true }
    case 'outline':
    case 'secondary':
    case 'fused':
      // secondary 附加浅色底（antd default 为白底）；fused hover 主色边框语义与 antd default hover 天然一致
      return {
        type: 'default',
        className: variant === 'secondary' ? 'bg-secondary text-secondary-foreground hover:text-secondary-foreground' : variant === 'fused' ? 'bg-page hover:bg-primary/10 hover:text-primary' : undefined,
      }
    case 'ghost':
      return { type: 'text' }
    case 'link':
      return { type: 'link' }
    default:
      // default（缺省）→ antd 主按钮
      return { type: 'primary' }
  }
}

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** antd 加载态（门面透传，非 shadcn 原生能力） */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, ...props }, ref) => {
    if (asChild) {
      const Comp = Slot
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          {...props}
        >
          {children}
        </Comp>
      )
    }

    const { type: visualType, danger, className: variantClass } = toAntdType(variant)
    // 原生 button type（submit/reset）经 antd htmlType 透传，避免与其视觉 type prop 冲突
    const { type: htmlType, ...rest } = props

    // size 映射：shadcn default/sm/icon 均 h-8（32px=antd small）、lg→large；
    // className 显式 h-9/h-10/h-11 时按调用方意图升级 middle/large
    const antdSize =
      size === 'lg' ? ('large' as const) : antdSizeFromClassName(className, 'small')

    return (
      <AntdButton
        ref={ref}
        type={visualType}
        htmlType={htmlType}
        danger={danger}
        size={antdSize}
        loading={loading}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap active:scale-[0.97]',
          size === 'icon' && 'h-8 w-8 p-0',
          variantClass,
          className,
        )}
        {...rest}
      >
        {children}
      </AntdButton>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
