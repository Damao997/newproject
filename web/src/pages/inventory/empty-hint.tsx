import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 存货页内空态提示：图标 + 标题 + 引导文案。
 * 仅供 inventory 目录内卡片复用，不做全局共享组件。
 */
export function EmptyHint({ icon: Icon, title, hint, className }: {
  icon: LucideIcon
  title: string
  hint?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-[300px] text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
