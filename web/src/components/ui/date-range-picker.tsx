import { DatePicker } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { cn } from '@/lib/utils'

/** 日期字符串形态：'YYYY-MM-DD'，空串 = 不限 */
type DateStr = string

interface DateRangePickerProps {
  startDate: DateStr
  endDate: DateStr
  /** 任一端变化时回传完整起止对（清空回传空串） */
  onChange: (range: { startDate: DateStr; endDate: DateStr }) => void
  startPlaceholder?: string
  endPlaceholder?: string
  className?: string
}

const DATE_FORMAT = 'YYYY-MM-DD'

/** 'YYYY-MM-DD' 字符串 → dayjs（空串/非法值 → null 表示未选择） */
export function toDateDay(value: DateStr): Dayjs | null {
  if (!value) return null
  const d = dayjs(value, DATE_FORMAT, true)
  return d.isValid() ? d : null
}

/** dayjs → 'YYYY-MM-DD'（null → 空串） */
export function toDateStr(d: Dayjs | null): DateStr {
  return d ? d.format(DATE_FORMAT) : ''
}

/** 起始端禁用规则：晚于结束端的日期不可选（结束端未选时不限制） */
export function disableAfter(endDate: DateStr) {
  const end = toDateDay(endDate)
  return (d: Dayjs) => !!end && d.isAfter(end, 'day')
}

/** 结束端禁用规则：早于起始端的日期不可选（起始端未选时不限制） */
export function disableBefore(startDate: DateStr) {
  const start = toDateDay(startDate)
  return (d: Dayjs) => !!start && d.isBefore(start, 'day')
}

/**
 * 日期范围选择器（antd DatePicker 封装，全项目统一）：
 * 起始/结束两个 DatePicker + 「~」分隔，受控值为 YYYY-MM-DD 字符串对（空串 = 不限）。
 * size="small"（antd controlHeightSM=32，与筛选条 h-8 控件对齐）；起始/结束互为
 * disabledDate 约束（起始不得晚于结束，反之亦然）；全局 zhCN ConfigProvider 提供中文界面。
 */
export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  startPlaceholder = '开始日期',
  endPlaceholder = '结束日期',
  className,
}: DateRangePickerProps) {
  const start = toDateDay(startDate)
  const end = toDateDay(endDate)

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <DatePicker
        size="small"
        value={start}
        placeholder={startPlaceholder}
        aria-label={startPlaceholder}
        onChange={(d) => onChange({ startDate: toDateStr(d), endDate })}
        disabledDate={disableAfter(endDate)}
        allowClear
      />
      <span className="text-muted-foreground">~</span>
      <DatePicker
        size="small"
        value={end}
        placeholder={endPlaceholder}
        aria-label={endPlaceholder}
        onChange={(d) => onChange({ startDate, endDate: toDateStr(d) })}
        disabledDate={disableBefore(startDate)}
        allowClear
      />
    </div>
  )
}
