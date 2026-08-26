import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  /** 图标（缺省 Inbox） */
  icon?: LucideIcon
  title: string
  description?: string
  /** 动作区（按钮/链接） */
  action?: ReactNode
  className?: string
  /** 紧凑模式：小图标小间距（表格/卡片内空态），缺省常规（页面级空态） */
  compact?: boolean
}

/**
 * 统一空态：图标 + 标题 + 描述 + 可选动作。
 * 三轨合一的唯一实现：页面空态卡 / 卡片内 EmptyHint / DataTable emptyText / 占位页。
 */
export function EmptyState({ icon: Icon = Inbox, title, description, action, className, compact = false }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'gap-1.5 py-2' : 'gap-3 py-16', className)}>
      <div className={cn('flex items-center justify-center rounded-xl bg-muted', compact ? 'h-8 w-8' : 'h-12 w-12')}>
        <Icon className={cn('text-muted-foreground', compact ? 'h-4 w-4' : 'h-6 w-6')} />
      </div>
      <p className={cn('font-medium text-foreground', compact ? 'text-xs' : 'text-sm')}>{title}</p>
      {description && <p className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-xs max-w-md')}>{description}</p>}
      {action}
    </div>
  )
}
