import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SheetShellProps {
  /** 关闭回调：遮罩点击 / 关闭按钮 / Escape 均触发（父组件负责未保存修改确认） */
  onClose: () => void
  /** 标题区图标（可选） */
  icon?: ReactNode
  /** 抽屉标题 */
  title: string
  /** 标题区副标题（可选） */
  description?: ReactNode
  /** 中间内容区（flex-1 内部滚动） */
  children: ReactNode
  /** 底部操作栏（可选，border-t 分隔） */
  footer?: ReactNode
  /** 容器宽度等覆盖类名 */
  className?: string
}

/**
 * 右侧抽屉共享外壳：遮罩 + 容器 + 头部 + 关闭按钮 + 焦点/Escape 管理。
 * 统一全站抽屉视觉：bg-black/40 遮罩（与 Dialog 的 bg-black/80 区分层级）、
 * max-w-xl、border-l、shadow-lg（对齐设计规范 §3.4 抽屉阴影档位）。
 * 无 Radix 依赖（保持轻量），聚焦/Escape 行为与 Dialog 对齐。
 */
export function SheetShell({ onClose, icon, title, description, children, footer, className }: SheetShellProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // 初始焦点移到关闭按钮，键盘用户可直接 Escape 关闭
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // Escape 关闭（与 Dialog 行为一致）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex h-full w-full max-w-xl flex-col border-l bg-background shadow-lg animate-in slide-in-from-right duration-200',
          className,
        )}
      >
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div className="flex min-w-0 items-start gap-2">
            {icon}
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground">{title}</h3>
              {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
            </div>
          </div>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
        {footer && (
          <div className="flex items-center justify-between border-t px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
