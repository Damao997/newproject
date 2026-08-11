import * as React from "react"
import { cn } from "@/lib/utils"

interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
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
              "sticky top-0 z-20 -mx-4 bg-page px-4 py-3 shadow-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
          )}
        >
          <div className="space-y-1">
            {title && (
              <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            )}
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
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
