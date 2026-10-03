import { createContext, forwardRef, useContext, useState, type Dispatch, type ReactNode, type SetStateAction, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Popover } from 'antd'
import { CircleHelp } from 'lucide-react'
import { cn } from '@/lib/utils'

const TitleHostContext = createContext<HTMLDivElement | null>(null)
const SetTitleHostContext = createContext<Dispatch<SetStateAction<HTMLDivElement | null>> | undefined>(undefined)

/** 顶栏提供唯一标题位置；页面节点仍由原页面拥有，返回与帮助操作不会复制状态。 */
export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  return <SetTitleHostContext.Provider value={setHost}>
    <TitleHostContext.Provider value={host}>{children}</TitleHostContext.Provider>
  </SetTitleHostContext.Provider>
}

export function HeaderTitleHost() {
  const setHost = useContext(SetTitleHostContext)
  return <div ref={setHost} className="header-title-host min-w-0" />
}

export function usePageTitleHost() { return useContext(TitleHostContext) }

/** 独立页面没有应用顶栏时保留本地标题，弹窗标题不使用这个入口。 */
export const PageHeading = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement> & { description?: ReactNode; meta?: ReactNode }>(
  ({ className, description, meta, children, ...props }, ref) => {
    const host = usePageTitleHost()
    const heading = <div className="page-heading flex min-w-0 items-center gap-2">
      <h1 ref={ref} className={cn('page-title min-w-0 font-semibold leading-tight tracking-tight', className)} {...props}>{children}</h1>
      {meta && <span className="page-heading-meta text-xs text-muted-foreground">{meta}</span>}
      {description && <Popover content={<span className="whitespace-pre-line">{description}</span>} trigger="click" placement="bottomLeft">
        <button type="button" aria-label="查看口径说明" className="page-title-help inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
          <CircleHelp className="h-4 w-4" aria-hidden />
        </button>
      </Popover>}
    </div>
    return host ? createPortal(heading, host) : heading
  },
)
PageHeading.displayName = 'PageHeading'
