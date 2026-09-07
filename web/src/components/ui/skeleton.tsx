import { cn } from "@/lib/utils"

/**
 * 骨架屏基础组件：统一走 globals.css 的 .skeleton（transform shimmer，合成器动画），
 * 与 skeleton-blocks / data-table 骨架行动画一致（此前为 animate-pulse，透明度脉冲，视觉不统一）。
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
