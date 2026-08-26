import * as React from "react"
import { Avatar as AntdAvatar } from "antd"
import { cn } from "@/lib/utils"

/**
 * 头像门面：antd Avatar。
 * 保持 Radix 的 Avatar/AvatarImage/AvatarFallback 组合 API：
 * - AvatarImage 的 src 收集到 antd Avatar 的 src；
 * - AvatarFallback 的 children 作为兜底内容（src 缺失/失效时显示，antd 原生行为）。
 * AvatarImage/AvatarFallback 为声明式占位组件，自身不渲染 DOM。
 */
type AvatarImageProps = React.ImgHTMLAttributes<HTMLImageElement>

const Avatar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }>(
  ({ className, children, ...props }, ref) => {
    // 声明式子元素收集：AvatarImage → src；AvatarFallback → 兜底内容
    let collectedSrc: string | undefined
    let collectedFallback: React.ReactNode
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return
      if (child.type === AvatarImage) {
        collectedSrc = (child.props as AvatarImageProps).src
      } else if (child.type === AvatarFallback) {
        collectedFallback = (child.props as { children?: React.ReactNode }).children
      }
    })

    // 尺寸：默认 40px；className 含 h-8 → 32
    const size = className && /(^|\s|\])h-8(?=\s|$)/.test(className) ? 32 : 40

    return (
      <AntdAvatar
        ref={ref}
        src={collectedSrc}
        size={size}
        className={cn('bg-muted text-foreground', className)}
        {...(props as React.ComponentProps<typeof AntdAvatar>)}
      >
        {collectedFallback}
      </AntdAvatar>
    )
  }
)
Avatar.displayName = "Avatar"

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  (_props, _ref) => {
    // 声明式占位：由 Avatar 父级收集 props，自身不渲染 DOM
    void _ref
    return null
  }
)
AvatarImage.displayName = "AvatarImage"

const AvatarFallback = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (_props, _ref) => {
    // 声明式占位：由 Avatar 父级收集 children，自身不渲染 DOM
    void _ref
    return null
  }
)
AvatarFallback.displayName = "AvatarFallback"

export { Avatar, AvatarImage, AvatarFallback }
