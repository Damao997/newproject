import { useState } from 'react'
import { ArrowRight, Sparkles, X } from 'lucide-react'

const DISMISS_KEY = 'next-ui-entry-dismissed'

/**
 * 首页新版工作台入口：只做试点导流，不改变旧版默认首页与权限。
 * 关闭状态仅保留在当前标签页，刷新后重新提示。
 */
export function NextUiEntry() {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1')

  if (dismissed) return null

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <section
      aria-label="新版工作台试点"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">新版工作台试点</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            关键指标与品类配置已迁移到新版；其余功能继续使用旧版，可随时返回。
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <a
          href="/next/home"
          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          体验新版
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
        <button
          type="button"
          onClick={dismiss}
          aria-label="关闭新版提示"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  )
}
