import { useMemo, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface MonthPickerProps {
  /** 当前值，'YYYY-MM' 或 ''（表示未选/全部） */
  value: string
  onChange: (value: string) => void
  /** 有数据的期间列表（'YYYY-MM'），用于圆点标识与「最新期间」快捷键 */
  availablePeriods?: string[]
  /** 允许选择的期间列表（如当前财年内的月份）；传入后集合外的月份禁用不可点 */
  allowedPeriods?: string[]
  placeholder?: string
  /** 触发器 id（配合 Label htmlFor 无障碍关联） */
  id?: string
  className?: string
}

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

/** 组装 'YYYY-MM' 期间编码 */
function toPeriod(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`
}

/**
 * 月份选择弹层：年份翻页 + 12 月宫格 + 有数据月份圆点标识 + 本月/最新期间/清除快捷操作。
 *
 * 受控组件，空值语义为「全部月份」；选中月份后自动关闭弹层。
 */
export function MonthPicker({
  value,
  onChange,
  availablePeriods = [],
  allowedPeriods,
  placeholder = '全部月份',
  id,
  className,
}: MonthPickerProps) {
  const [open, setOpen] = useState(false)
  const now = new Date()
  const currentPeriod = toPeriod(now.getFullYear(), now.getMonth())
  // 弹层展示的年份：优先跟随已选值，其次最新有数据期间，最后当前年
  const latestPeriod = useMemo(
    () => (availablePeriods.length > 0 ? [...availablePeriods].sort().at(-1)! : ''),
    [availablePeriods],
  )
  const defaultYear = Number((value || latestPeriod || currentPeriod).slice(0, 4))
  const [viewYear, setViewYear] = useState(defaultYear)
  const availableSet = useMemo(() => new Set(availablePeriods), [availablePeriods])
  // 未传 allowedPeriods 时不限制；传入后集合外月份禁用（适配财年非自然年的期间口径）
  const allowedSet = useMemo(() => (allowedPeriods ? new Set(allowedPeriods) : null), [allowedPeriods])
  const isAllowed = (period: string) => !allowedSet || allowedSet.has(period)

  const pick = (period: string) => {
    if (period && !isAllowed(period)) return
    onChange(period)
    setOpen(false)
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    // 每次打开重新对齐年份，避免翻页残留
    if (next) setViewYear(Number((value || latestPeriod || currentPeriod).slice(0, 4)))
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          className={cn(
            'flex h-8 w-[150px] items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm transition-colors hover:border-primary hover:bg-muted/50 focus:border-input focus:outline-none focus:ring-1 focus:ring-ring',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <Calendar className="h-4 w-4 shrink-0 opacity-50" />
          <span className="flex-1 text-left">{value || placeholder}</span>
          {value && (
            <X
              className="h-3.5 w-3.5 shrink-0 opacity-50 transition-opacity hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                onChange('')
              }}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[248px] p-3">
        {/* 年份导航 */}
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setViewYear((y) => y - 1)}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="上一年"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium">{viewYear} 年</span>
          <button
            type="button"
            onClick={() => setViewYear((y) => y + 1)}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="下一年"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {/* 12 月宫格 */}
        <div className="grid grid-cols-4 gap-1">
          {MONTH_LABELS.map((label, i) => {
            const period = toPeriod(viewYear, i)
            const isSelected = value === period
            const hasData = availableSet.has(period)
            const disabled = !isAllowed(period)
            return (
              <button
                key={period}
                type="button"
                disabled={disabled}
                onClick={() => pick(period)}
                className={cn(
                  'relative h-9 rounded-md text-body text-foreground transition-colors',
                  isSelected
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'hover:bg-muted',
                  period === currentPeriod && !isSelected && 'font-medium text-primary',
                  disabled && 'cursor-not-allowed text-muted-foreground/50 hover:bg-transparent',
                )}
              >
                {label}
                {hasData && (
                  <span
                    className={cn(
                      'absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full',
                      isSelected ? 'bg-primary-foreground' : 'bg-primary/70',
                    )}
                  />
                )}
              </button>
            )
          })}
        </div>
        {/* 快捷操作 */}
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs">
          <button
            type="button"
            onClick={() => pick(currentPeriod)}
            disabled={!isAllowed(currentPeriod)}
            className="rounded px-2 py-1 text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent"
          >
            本月
          </button>
          {latestPeriod && (
            <button
              type="button"
              onClick={() => pick(latestPeriod)}
              className="rounded px-2 py-1 text-primary transition-colors hover:bg-primary/10"
              title={latestPeriod}
            >
              最新期间
            </button>
          )}
          <button
            type="button"
            onClick={() => pick('')}
            className="rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            清除
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
