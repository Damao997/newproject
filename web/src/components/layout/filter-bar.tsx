import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FilterBarProps {
  /** 吸顶：传入顶部偏移（px）时启用 sticky（与 useStickyHeader 的 headerHeight 联动） */
  stickyTop?: number
  /** 单行不换行（账龄筛选行 1 等密集布局专用，勿滥用） */
  nowrap?: boolean
  className?: string
  children: ReactNode
}

/**
 * 筛选区容器：统一控件间距（gap-3）与排列（可换行/吸顶）。
 * 控件自身高度由各控件 className 保证（统一 h-9），宽度优先引用 FILTER_WIDTH 语义常量（见 ./filter-width）。
 */
export function FilterBar({ stickyTop, nowrap, className, children }: FilterBarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3',
        nowrap && 'flex-nowrap',
        stickyTop !== undefined && 'sticky z-10',
        className,
      )}
      style={stickyTop !== undefined ? { top: stickyTop } : undefined}
    >
      {children}
    </div>
  )
}
