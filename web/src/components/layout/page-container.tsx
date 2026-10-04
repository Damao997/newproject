import * as React from "react"
import { PageHeading, usePageTitleHost } from "./page-heading"
import { cn } from "@/lib/utils"
import { useViewportPanelHeight } from "@/hooks/use-viewport-panel-height"

interface PageContainerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 支持传含返回按钮等节点的自定义标题 */
  title?: React.ReactNode
  /** 必要口径说明通过可点击、可聚焦的帮助浮层展示。 */
  description?: React.ReactNode
  /** 单位等必须直接可见的信息，不进入帮助浮层或浏览器标签标题。 */
  headingMeta?: React.ReactNode
  /** 模块导航先于页面筛选与操作，保持视觉顺序与键盘顺序一致。 */
  navigation?: React.ReactNode
  actions?: React.ReactNode
  /** 启用后页头（标题/筛选器）随滚动固定在可视区顶部（用于筛选器较多的页面，如看板） */
  stickyHeader?: boolean
  /** stickyHeader 区块的 ref：供页面测量吸顶区高度，用于其下表格表头吸顶对齐 */
  headerRef?: React.Ref<HTMLDivElement>
  /** actions 强制独占一行，用于筛选条较宽需整行展示的页面 */
  actionsFullWidth?: boolean
  /** 纯列表页填满主内容区，标题/工具栏/分页不压缩，表格内部滚动。 */
  viewportBound?: boolean
}

const PageContainer = React.forwardRef<HTMLDivElement, PageContainerProps>(
  ({ className, title, description, headingMeta, navigation, actions, stickyHeader, headerRef, actionsFullWidth, viewportBound = false, children, style, ...props }, ref) => {
    const titleHost = usePageTitleHost()
    const panelRef = React.useRef<HTMLDivElement>(null)
    const height = useViewportPanelHeight(panelRef, viewportBound)
    const setRef = React.useCallback((node: HTMLDivElement | null) => {
      panelRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    }, [ref])
    return (
      <div
        ref={setRef}
        className={cn("page-container flex min-w-0 flex-col", viewportBound ? "min-h-0 gap-2" : navigation ? "gap-3" : "space-y-4", className)}
        style={{ ...style, ...(height === undefined ? {} : { height }) }}
        {...props}
      >
        {title && (titleHost || navigation) && <PageHeading description={description} meta={headingMeta}>{title}</PageHeading>}
        {navigation}
        {(title || actions) && (
          <div
            ref={headerRef}
            hidden={!!(titleHost || navigation) && !actions}
            className={cn(
              // shrink-0：视口撑满布局（如财务指标页 h-[calc(100dvh-…)]）下标题区不参与压缩，表格区 flex-1 自适应剩余空间
              "page-head animate-slide-in flex shrink-0 flex-wrap items-center justify-between gap-3",
              stickyHeader &&
                // 与主区 16px 顶部留白一致，只让页面工具栏吸顶。
                "sticky top-0 z-20 -mx-4 bg-page px-4 pt-4 pb-3 md:-mx-6 md:px-6",
              stickyHeader && !navigation && "-mt-4",
            )}
          >
            {title && !titleHost && !navigation && <PageHeading description={description} meta={headingMeta}>{title}</PageHeading>}
            {actions && (
              <div data-filter-bar className={cn('flex min-w-0 flex-wrap items-center gap-2', actionsFullWidth && 'basis-full')}>
                {actions}
              </div>
            )}
          </div>
        )}
        {children}
      </div>
    )
  }
)
PageContainer.displayName = "PageContainer"

export { PageContainer }
