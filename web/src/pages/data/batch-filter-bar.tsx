import { useMemo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { batchStatusLabel, templateTypeLabel } from './use-import-flow'
import { Filter, RotateCcw } from 'lucide-react'

/** 批次筛选状态（'all' 哨兵表示不过滤，由调用方转换为 undefined 请求参数） */
export interface BatchFilterValue {
  /** 模块（批次 dataType）：'all' 或 operating/static/cashflow/budget/transaction/inventory */
  module: string
  /** 生命周期状态：'all' 或 draft/active/archived/purged */
  status: string
  /** 导入时间范围起（YYYY-MM-DD，空串表示不限） */
  startDate: string
  /** 导入时间范围止（YYYY-MM-DD，空串表示不限） */
  endDate: string
}

interface BatchFilterBarProps {
  value: BatchFilterValue
  onChange: (patch: Partial<BatchFilterValue>) => void
  /** 生效筛选项数量（模块/状态/起止日期），用于状态展示与重置按钮禁用 */
  activeCount: number
  onReset: () => void
}

const ALL = 'all'

/** 模块选项：templateTypeLabel 排除 merged（仅上传选项，非批次 dataType）后的 6 个模块 */
const MODULE_OPTIONS = Object.entries(templateTypeLabel).filter(([key]) => key !== 'merged')
/** 状态选项：与后端 LifecycleStatus 枚举一致 */
const STATUS_OPTIONS = Object.entries(batchStatusLabel)

/**
 * 批次管理筛选条：模块单选下拉 + 生命周期状态 + 导入时间范围。
 * 受控组件，选择即实时筛选（由 React Query 参数变化驱动重新请求）；
 * flex-wrap 响应式，右侧展示生效筛选数并提供一键重置。
 */
export function BatchFilterBar({ value, onChange, activeCount, onReset }: BatchFilterBarProps) {
  const hasActive = useMemo(() => activeCount > 0, [activeCount])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />

      <span className="text-[13px] text-muted-foreground">模块</span>
      <Select value={value.module} onValueChange={(v) => onChange({ module: v })}>
        <SelectTrigger className="h-8 w-[130px]" aria-label="按模块筛选批次">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部模块</SelectItem>
          {MODULE_OPTIONS.map(([key, label]) => (
            <SelectItem key={key} value={key}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-[13px] text-muted-foreground">状态</span>
      <Select value={value.status} onValueChange={(v) => onChange({ status: v })}>
        <SelectTrigger className="h-8 w-[110px]" aria-label="按批次状态筛选">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部状态</SelectItem>
          {STATUS_OPTIONS.map(([key, label]) => (
            <SelectItem key={key} value={key}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-[13px] text-muted-foreground">时间</span>
      <DateRangePicker
        startDate={value.startDate}
        endDate={value.endDate}
        onChange={(r) => onChange(r)}
        startPlaceholder="导入时间起"
        endPlaceholder="导入时间止"
      />

      <div className="ml-auto flex items-center gap-2">
        {hasActive && (
          <Badge variant="secondary" className="shrink-0">
            已启用 {activeCount} 项筛选
          </Badge>
        )}
        <Button variant="outline" size="sm" disabled={!hasActive} onClick={onReset}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          重置
        </Button>
      </div>
    </div>
  )
}
