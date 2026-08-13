import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FlashMessageProps {
  /** 语义：成功用 success-strong（绿），失败用 destructive（红），中性用 primary（品牌橙） */
  type?: 'success' | 'error' | 'info'
  children: ReactNode
  className?: string
  /** 自动消失毫秒数；0 表示常驻（如表单内联反馈），缺省 0 */
  autoHideMs?: number
  /** 自动消失回调（用于清空外部 state） */
  onAutoHide?: () => void
}

/**
 * 统一操作反馈消息：对齐设计规范 §3.2（成功 text-success-strong / 错误 text-destructive / 中性 text-primary）。
 * 替代各页面散落的 flash 段落与表单内联反馈，消除成功反馈色双轨（橙 vs 绿）。
 */
export function FlashMessage({ type = 'info', children, className, autoHideMs = 0, onAutoHide }: FlashMessageProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (!autoHideMs) return
    const timer = window.setTimeout(() => {
      setVisible(false)
      onAutoHide?.()
    }, autoHideMs)
    return () => window.clearTimeout(timer)
  }, [autoHideMs, onAutoHide])

  if (!visible) return null
  return (
    <p
      role="status"
      className={cn(
        'text-[13px]',
        type === 'success' ? 'text-success-strong' : type === 'error' ? 'text-destructive' : 'text-primary',
        className,
      )}
    >
      {children}
    </p>
  )
}
