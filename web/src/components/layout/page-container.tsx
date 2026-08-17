import * as React from "react"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface PageContainerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 支持传含返回按钮等节点的自定义标题 */
  title?: React.ReactNode
  description?: string
  actions?: React.ReactNode
  /** 启用后页头（标题/描述/筛选器）随滚动固定在可视区顶部（用于筛选器较多的页面，如看板） */
  stickyHeader?: boolean
  /** stickyHeader 区块的 ref：供页面测量吸顶区高度，用于其下表格表头吸顶对齐 */
  headerRef?: React.Ref<HTMLDivElement>
  /** actions 强制独占一行（标题下方），用于筛选条较宽需整行展示的页面 */
  actionsFullWidth?: boolean
}

const PageContainer = React.forwardRef<HTMLDivElement, PageContainerProps>(
  ({ className, title, description, actions, stickyHeader, headerRef, actionsFullWidth, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-4", className)}
      {...props}
    >
      {(title || description || actions) && (
        <div
          ref={headerRef}
          className={cn(
            "animate-slide-in flex flex-wrap items-center justify-between gap-3",
            stickyHeader &&
              // -mt-6 使标题区 border box 顶部恒等于 sticky top-0 钉住位置（自加载即吸顶，零临界切换）：背景条贴 Header 底部（bg-page 与页面同色，视觉不可见，仅起遮挡作用）；pt-6 保证吸顶时文字距 Header 恒 24px（未吸顶 = 背景顶部 0 + pt-6 = 24px，吸顶 = 24px）
              "sticky top-0 z-20 -mx-4 -mt-6 bg-page px-4 pt-6 pb-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
          )}
        >
          <div className="space-y-2">
            {title && (
              <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight">
                {title}
                {/* 页面描述悬浮化：不常驻占位，hover Info 图标查看（有信息增量的描述才传入） */}
                {description && (
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="页面说明"
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Info className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs">
                        {description}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </h1>
            )}
          </div>
          {actions && (
            <div className={cn('flex min-w-0 flex-wrap items-center gap-2', actionsFullWidth && 'basis-full')}>
              {actions}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  )
)
PageContainer.displayName = "PageContainer"

export { PageContainer }
