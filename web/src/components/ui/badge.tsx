import * as React from "react"
import { Tag } from "antd"
import { cn } from "@/lib/utils"

export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'info'

/** variant → antd Tag 预设色（色值由 ConfigProvider token 决定：colorInfo=品牌主色等） */
function toTagColor(variant?: BadgeVariant | null): string | undefined {
  switch (variant) {
    case 'destructive':
      return 'error'
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    case 'info':
      return 'processing'
    case 'default':
      // 品牌主色（colorInfo 跟随侧边栏风格）
      return 'processing'
    case 'outline':
      return undefined
    default:
      // secondary → antd 默认灰
      return undefined
  }
}

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant
}

/**
 * 徽标门面：antd Tag。
 * 语义变体经 antd 预设色映射（success/error/warning/processing），
 * 色值全部来自 ConfigProvider token（主色跟随侧边栏风格），不写死颜色。
 */
function Badge({ className, variant, children, ...props }: BadgeProps) {
  return (
    <Tag color={toTagColor(variant)} className={cn('inline-flex items-center', className)} {...(props as React.ComponentProps<typeof Tag>)}>
      {children}
    </Tag>
  )
}

export { Badge }
