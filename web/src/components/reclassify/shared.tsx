import { forwardRef, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { AlertCircle, BookOpen, CheckCircle2, Search, X } from 'lucide-react'

/**
 * 重分类模块共享基础：标签常量、反馈提示条、预览统计卡、科目选择器（单选/多选）。
 * 控件外观与数据浏览模块的 MonthPicker 对齐（图标 + 值 + X 清除的弹层触发按钮），全平台统一。
 */

export const TEMPLATE_LABEL: Record<string, string> = {
  operating: '经营数据',
  static: '静态数据',
  budget: '年度预算',
}

export const TEMPLATE_LABEL_SHORT: Record<string, string> = {
  operating: '经营',
  static: '静态',
  budget: '预算',
}

export const TYPE_LABEL: Record<string, string> = {
  company: '跨公司',
  subject: '科目归类',
  subject_adjust: '科目调整',
}

/** 统一成功/错误提示条 */
export function FeedbackAlert({ kind, children }: { kind: 'success' | 'error'; children: ReactNode }) {
  const Icon = kind === 'success' ? CheckCircle2 : AlertCircle
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3 text-sm',
        kind === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export interface PreviewStatItem {
  label: string
  value: ReactNode
  /** warning 用于净变动等需要醒目的项 */
  tone?: 'default' | 'primary' | 'warning'
}

/** 预览统计卡：grid 小卡片展示预览影响，warning 提供琥珀色警示条 */
export function PreviewStats({ items, warning, empty }: { items: PreviewStatItem[]; warning?: ReactNode; empty?: boolean }) {
  if (empty) {
    return (
      <div className="rounded-lg border border-muted bg-muted/30 p-3 text-sm text-muted-foreground">
        当前筛选条件下没有匹配的数据。
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-md border bg-muted/20 px-3 py-2">
            <p className="text-xs text-muted-foreground">{it.label}</p>
            <p
              className={cn(
                'mt-0.5 truncate font-num text-sm font-semibold',
                it.tone === 'primary' && 'text-blue-700',
                it.tone === 'warning' && 'text-amber-700',
              )}
              title={typeof it.value === 'string' ? it.value : undefined}
            >
              {it.value}
            </p>
          </div>
        ))}
      </div>
      {warning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{warning}</div>
        </div>
      )}
    </div>
  )
}

export interface SubjectOption { code: string; name: string; valueType?: string }

/** 弹层触发按钮（外观对齐 MonthPicker：图标 + 值 + X 清除）；转发 ref/props 以兼容 Radix asChild */
interface PickerTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  display: ReactNode | null
  placeholder: string
  onClear?: () => void
}

const PickerTrigger = forwardRef<HTMLButtonElement, PickerTriggerProps>(
  ({ icon, display, placeholder, onClear, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-ring',
        !display && 'text-muted-foreground',
        className,
      )}
      {...props}
    >
      <span className="shrink-0 opacity-50">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{display ?? placeholder}</span>
      {display && onClear && (
        <X
          className="h-3.5 w-3.5 shrink-0 opacity-50 transition-opacity hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
        />
      )}
    </button>
  ),
)
PickerTrigger.displayName = 'PickerTrigger'

/** 弹层内的科目搜索列表（单/多选共用） */
function SubjectSearchList({ options, keyword, onKeyword, renderItem }: {
  options: SubjectOption[]
  keyword: string
  onKeyword: (v: string) => void
  renderItem: (s: SubjectOption) => ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="搜索科目名称或编码..." value={keyword} onChange={(e) => onKeyword(e.target.value)} className="h-8 pl-8" />
      </div>
      <div className="max-h-[220px] space-y-0.5 overflow-y-auto">
        {options.map(renderItem)}
        {options.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">无匹配科目</p>}
      </div>
    </div>
  )
}

function filterSubjects(options: SubjectOption[], keyword: string, excludeCode?: string): SubjectOption[] {
  const kw = keyword.trim().toLowerCase()
  const items = excludeCode ? options.filter((s) => s.code !== excludeCode) : options
  return kw ? items.filter((s) => s.name.toLowerCase().includes(kw) || s.code.toLowerCase().includes(kw)) : items
}

/** 科目单选弹层选择器 */
export function SubjectPicker({ options, value, onChange, excludeCode, placeholder = '选择科目', className }: {
  options: SubjectOption[]
  value: string
  onChange: (code: string) => void
  excludeCode?: string
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const filtered = useMemo(() => filterSubjects(options, keyword, excludeCode), [options, keyword, excludeCode])
  const selected = options.find((s) => s.code === value)

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setKeyword('') }}>
      <PopoverTrigger asChild>
        <PickerTrigger
          icon={<BookOpen className="h-4 w-4" />}
          display={selected ? <><span className="font-mono text-xs text-muted-foreground">{selected.code}</span> {selected.name}</> : null}
          placeholder={placeholder}
          onClear={() => onChange('')}
          className={className}
        />
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-2">
        <SubjectSearchList
          options={filtered}
          keyword={keyword}
          onKeyword={setKeyword}
          renderItem={(s) => (
            <button
              key={s.code}
              type="button"
              className={cn('flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-muted', value === s.code && 'bg-muted font-medium')}
              onClick={() => { onChange(s.code); setOpen(false) }}
            >
              <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
              <span className="truncate">{s.name}</span>
            </button>
          )}
        />
      </PopoverContent>
    </Popover>
  )
}

/** 科目多选弹层选择器（触发按钮显示已选数量 Badge） */
export function SubjectMultiPicker({ options, selected, onToggle, onClear, placeholder = '全部科目', className }: {
  options: SubjectOption[]
  selected: Set<string>
  onToggle: (code: string) => void
  onClear: () => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const filtered = useMemo(() => filterSubjects(options, keyword), [options, keyword])

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setKeyword('') }}>
      <PopoverTrigger asChild>
        <PickerTrigger
          icon={<BookOpen className="h-4 w-4" />}
          display={selected.size > 0 ? <span className="flex items-center gap-1.5">按科目筛选<Badge variant="secondary" className="px-1.5 py-0">{selected.size}</Badge></span> : null}
          placeholder={placeholder}
          onClear={onClear}
          className={className}
        />
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-2">
        <SubjectSearchList
          options={filtered}
          keyword={keyword}
          onKeyword={setKeyword}
          renderItem={(s) => (
            <label key={s.code} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
              <input type="checkbox" checked={selected.has(s.code)} onChange={() => onToggle(s.code)} />
              <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
              <span className="truncate">{s.name}</span>
            </label>
          )}
        />
        {selected.size > 0 && (
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs">
            <span className="text-muted-foreground">已选 {selected.size} 个科目</span>
            <button type="button" className="rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={onClear}>
              清除全部
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** 区块小标题：分区化表单布局用 */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h4>
}
