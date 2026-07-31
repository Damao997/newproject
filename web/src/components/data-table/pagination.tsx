import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PAGINATION } from '@/lib/constants'
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
  /** 每页条数变更回调；传入即显示每页条数下拉 */
  onPageSizeChange?: (pageSize: number) => void
  /** 每页条数候选，默认 PAGINATION.PAGE_SIZE_OPTIONS */
  pageSizeOptions?: number[]
  /** 是否显示页码跳转框，默认 true（仅总页数 > 1 时渲染） */
  showJumper?: boolean
  /** 覆盖左侧统计文案，如「共 N 份报告」 */
  summary?: ReactNode
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
 * 传入 onPageSizeChange 时额外显示每页条数下拉；总页数 > 1 时显示页码跳转框。
 * 响应式：整体可换行，窄屏隐藏页码槽位，仅保留上一页/下一页与每页条数、跳转。
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions,
  showJumper = true,
  summary,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), totalPages)
  const [jumpValue, setJumpValue] = useState('')

  const slots = buildSlots(current, totalPages)

  const rangeStart = total === 0 ? 0 : (current - 1) * pageSize + 1
  const rangeEnd = Math.min(current * pageSize, total)

  const sizeOptions = pageSizeOptions ?? [...PAGINATION.PAGE_SIZE_OPTIONS]

  /** 跳转提交：非数字忽略，越界 clamp 到 [1, totalPages] */
  const submitJump = () => {
    const parsed = Number.parseInt(jumpValue.trim(), 10)
    if (!Number.isFinite(parsed)) return
    const target = Math.min(Math.max(1, parsed), totalPages)
    setJumpValue('')
    onPageChange(target)
  }

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2', className)}>
      <p className="text-sm text-muted-foreground font-num">
        {summary ?? `共 ${total} 条，第 ${rangeStart}-${rangeEnd} 条`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange && (
          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              // 每页条数变化后回到第 1 页，避免原页码越界
              onPageSizeChange(Number(v))
              onPageChange(1)
            }}
          >
            <SelectTrigger className="h-9 w-[110px]" aria-label="每页条数">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sizeOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>每页 {n} 条</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
        >
          上一页
        </Button>
        <div className="hidden items-center gap-2 sm:flex">
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
                className="min-w-9 font-num"
                onClick={() => onPageChange(slot.page)}
              >
                {slot.page}
              </Button>
            )
          })}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={current >= totalPages}
          onClick={() => onPageChange(current + 1)}
        >
          下一页
        </Button>
        {showJumper && totalPages > 1 && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <span className="whitespace-nowrap">跳至</span>
            <Input
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitJump() }}
              placeholder={String(current)}
              aria-label="跳转页码"
              className="h-9 w-14 text-center font-num"
            />
            <span className="whitespace-nowrap">/ {totalPages} 页</span>
            <Button variant="outline" size="sm" onClick={submitJump}>跳转</Button>
          </div>
        )}
      </div>
    </div>
  )
}
