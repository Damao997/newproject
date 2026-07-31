import * as React from "react"
import { cn } from "@/lib/utils"

interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
  description?: string
  actions?: React.ReactNode
}

const PageContainer = React.forwardRef<HTMLDivElement, PageContainerProps>(
  ({ className, title, description, actions, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-4", className)}
      {...props}
    >
      {(title || description || actions) && (
        <div className="flex animate-slide-in flex-wrap items-center justify-between gap-3">
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
