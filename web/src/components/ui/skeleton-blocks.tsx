import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

/**
 * 骨架屏组件块（借鉴 demo-3 性能优先的加载体验）。
 *
 * 统一使用 globals.css 中的 `.skeleton` shimmer 工具类，
 * 在数据就绪前占位，避免布局抖动（降低 CLS），提升感知性能。
 */

/** 单个 KPI 卡片骨架 */
export function KpiCardSkeleton() {
  return (
    <Card className="border-0 bg-white shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-5 px-5">
        <div className="skeleton h-3 w-16 rounded" />
        <div className="skeleton h-8 w-8 rounded-lg" />
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div className="skeleton mb-3 h-8 w-24 rounded" />
        <div className="flex items-center justify-between">
          <div className="skeleton h-5 w-16 rounded-full" />
          <div className="skeleton h-3 w-8 rounded" />
        </div>
        <div className="mt-3 border-t border-border/50 pt-3">
          <div className="skeleton h-12 w-full rounded" />
        </div>
      </CardContent>
    </Card>
  )
}

/** KPI 卡片网格骨架 */
export function KpiGridSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <KpiCardSkeleton key={i} />
      ))}
    </div>
  )
}

/** 图表卡片骨架 */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('border-0 bg-white shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]', className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-6 px-6">
        <div className="space-y-2">
          <div className="skeleton h-5 w-32 rounded" />
          <div className="skeleton h-3 w-48 rounded" />
        </div>
        <div className="skeleton h-8 w-24 rounded" />
      </CardHeader>
      <CardContent className="px-6 pb-6">
        <div className="skeleton h-64 w-full rounded-lg" />
      </CardContent>
    </Card>
  )
}

/** 列表面板骨架（标题 + 若干行） */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <Card className={cn('border-0 bg-white shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]', className)}>
      <CardHeader className="pb-2 pt-6 px-6">
        <div className="skeleton h-5 w-28 rounded" />
      </CardHeader>
      <CardContent className="space-y-4 px-6 pb-6">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton h-9 w-9 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3 w-3/4 rounded" />
              <div className="skeleton h-3 w-1/2 rounded" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** 表格骨架（表头 + 数据行） */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-lg border">
      <div className="flex gap-4 border-b bg-muted/50 p-4">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="skeleton h-4 flex-1 rounded" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b p-4 last:border-b-0">
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} className="skeleton h-4 flex-1 rounded" />
          ))}
        </div>
      ))}
    </div>
  )
}
