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

/** 分页槽位：页码 / 省略号 / 占位（占位用于总页数少时补齐宽度，保持分页栏宽度稳定） */
type Slot =
  | { kind: 'page'; page: number }
  | { kind: 'ellipsis' }
  | { kind: 'placeholder' }

/** 固定槽位数：首页 + 省略号 + 中间窗口 + 省略号 + 末页，恒为 7，避免 total 变化时分页栏宽度抖动 */
const SLOT_COUNT = 7

/** 生成恒定数量（SLOT_COUNT）的分页槽位 */
function buildSlots(current: number, totalPages: number): Slot[] {
  if (totalPages <= SLOT_COUNT) {
    const slots: Slot[] = []
    for (let i = 1; i <= totalPages; i++) slots.push({ kind: 'page', page: i })
    while (slots.length < SLOT_COUNT) slots.push({ kind: 'placeholder' })
    return slots
  }
  const page = (p: number): Slot => ({ kind: 'page', page: p })
  const ellipsis: Slot = { kind: 'ellipsis' }
  if (current <= 4) {
    return [page(1), page(2), page(3), page(4), page(5), ellipsis, page(totalPages)]
  }
  if (current >= totalPages - 3) {
    return [
      page(1),
      ellipsis,
      page(totalPages - 4),
      page(totalPages - 3),
      page(totalPages - 2),
      page(totalPages - 1),
      page(totalPages),
    ]
  }
  return [page(1), ellipsis, page(current - 1), page(current), page(current + 1), ellipsis, page(totalPages)]
}

/**
 * 受控分页组件。
 *
 * 根据 total / pageSize 计算总页数，展示上一页/页码/下一页，
 * 样式对齐《前端设计方案》§5.4。页码区渲染固定数量槽位，使 total 变化时分页栏宽度稳定。
 */
export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), totalPages)

  const slots = buildSlots(current, totalPages)

  const rangeStart = total === 0 ? 0 : (current - 1) * pageSize + 1
  const rangeEnd = Math.min(current * pageSize, total)

  return (
    <div className={cn('flex items-center justify-between', className)}>
      <p className="text-sm text-muted-foreground tabular-nums">
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
        {slots.map((slot, index) => {
          if (slot.kind === 'placeholder') {
            return <span key={`ph-${index}`} aria-hidden className="inline-block h-9 min-w-9" />
          }
          if (slot.kind === 'ellipsis') {
            return (
              <span
                key={`ell-${index}`}
                className="inline-flex h-9 min-w-9 items-center justify-center text-sm text-muted-foreground"
              >
                …
              </span>
            )
          }
          return (
            <Button
              key={slot.page}
              variant={slot.page === current ? 'default' : 'outline'}
              size="sm"
              className="min-w-9 tabular-nums"
              onClick={() => onPageChange(slot.page)}
            >
              {slot.page}
            </Button>
          )
        })}
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
