import * as React from "react"
import { cn } from "@/lib/utils"

interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
  description?: string
  actions?: React.ReactNode
  /** 启用后页头（标题/描述/筛选器）随滚动固定在可视区顶部（用于筛选器较多的页面，如看板） */
  stickyHeader?: boolean
}

const PageContainer = React.forwardRef<HTMLDivElement, PageContainerProps>(
  ({ className, title, description, actions, stickyHeader, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-4", className)}
      {...props}
    >
      {(title || description || actions) && (
        <div
          className={cn(
            "animate-slide-in flex flex-wrap items-center justify-between gap-3",
            stickyHeader &&
              "sticky top-0 z-20 -mx-4 border-b border-border/60 bg-background/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
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
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
)
PageContainer.displayName = "PageContainer"

export { PageContainer }
