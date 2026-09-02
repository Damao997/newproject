import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 顶栏全局刷新按钮（参考 AntD ProLayout 风格）：
 * 点击触发 React Query 缓存 invalidate（invalidateQueries 全量 refetch，不只 refetch 内存），
 * 旋转图标 1s 反馈进度。期间内再次点击禁用，避免与进行中的 refetch 抢锁。
 */
export function RefreshButton() {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="刷新"
      title="刷新全部数据"
      disabled={pending}
      onClick={async () => {
        if (pending) return
        setPending(true)
        try {
          await queryClient.invalidateQueries()
        } finally {
          // 至少 600ms 旋转反馈，避免极快完成时一闪而过
          setTimeout(() => setPending(false), 600)
        }
      }}
      className="h-9 w-9"
    >
      <RefreshCw className={cn('h-4 w-4 transition-transform', pending && 'animate-spin')} />
    </Button>
  )
}
