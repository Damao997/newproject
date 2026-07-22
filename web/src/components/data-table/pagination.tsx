import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PaginationProps {
  /** 当前页码（1 基） */
  page: number
  /** 每页条数 */
  pageSize: number
  /** 总条数 */
  total: number
  /** 页码变更回调 */
  onPageChange: (page: number) => void
  className?: string
}

/**
 * 受控分页组件。
 *
 * 根据 total / pageSize 计算总页数，展示上一页/页码/下一页，
 * 样式对齐《前端设计方案》§5.4。
 */
export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), totalPages)

  // 生成页码窗口：当前页前后各一页，首尾恒显示
  const pageNumbers: number[] = []
  const start = Math.max(1, current - 1)
  const end = Math.min(totalPages, current + 1)
  for (let i = start; i <= end; i++) pageNumbers.push(i)
  if (!pageNumbers.includes(1)) pageNumbers.unshift(1)
  if (!pageNumbers.includes(totalPages)) pageNumbers.push(totalPages)
  const uniquePages = Array.from(new Set(pageNumbers)).sort((a, b) => a - b)

  const rangeStart = total === 0 ? 0 : (current - 1) * pageSize + 1
  const rangeEnd = Math.min(current * pageSize, total)

  return (
    <div className={cn('flex items-center justify-between', className)}>
      <p className="text-sm text-muted-foreground">
        共 {total} 条，第 {rangeStart}-{rangeEnd} 条
      </p>
      <div className="flex items-center space-x-2">
        <Button
          variant="outline"
          size="sm"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
        >
          上一页
        </Button>
        {uniquePages.map((p) => (
          <Button
            key={p}
            variant={p === current ? 'default' : 'outline'}
            size="sm"
            onClick={() => onPageChange(p)}
          >
            {p}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={current >= totalPages}
          onClick={() => onPageChange(current + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}
