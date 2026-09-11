import { KpiGridSkeleton, ListSkeleton } from '@/components/ui/skeleton-blocks'

/**
 * 路由级懒加载骨架：页头占位条 + KPI/列表骨架。
 * 复用页内骨架块（skeleton-blocks），与页面加载态视觉连续，替代纯文本"加载中…"。
 * 通用形态（不感知具体路由）：渲染在 main 内容容器内（MainLayout 已就位），登录页懒加载时同样可用。
 */
export function RouteFallback() {
  return (
    <div className="animate-fade-in space-y-4" role="status" aria-label="页面加载中">
      <div className="flex items-center justify-between">
        <div className="skeleton h-7 w-44 rounded" />
        <div className="skeleton h-9 w-72 rounded" />
      </div>
      <KpiGridSkeleton count={4} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ListSkeleton rows={4} />
        <ListSkeleton rows={4} />
      </div>
    </div>
  )
}
