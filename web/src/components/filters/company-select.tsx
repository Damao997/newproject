import { useMemo } from 'react'
import { Select as AntdSelect, Tag } from 'antd'
import { ChevronDown } from 'lucide-react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from '@/components/ui/select'
import { antdSizeFromClassName } from '@/components/ui/antd-size'
import { FILTER_WIDTH } from '@/components/layout/filter-width'
import { useCompanies } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { cn } from '@/lib/utils'

interface CompanySelectProps {
  /** 'all' 表示全部公司，否则为公司编码（prefixed 模式为 'company:X' | 'summary:X'） */
  value: string
  onChange: (value: string) => void
  /** 仅列出单体公司（type === 'entity'），缺省列出全部公司 */
  entitiesOnly?: boolean
  /** 无值时的占位文案 */
  placeholder?: string
  className?: string
  /** 触发器 id（配合 Label htmlFor 无障碍关联） */
  id?: string
  /** value 格式：'code' = 公司编码（默认）；'prefixed' = 'company:X' | 'summary:X'（主体维度场景） */
  valueFormat?: 'code' | 'prefixed'
  /** "全部"选项文案（prefixed 场景常用「全部主体」） */
  allLabel?: string
  /** 是否渲染「全部」选项（必选场景传 false） */
  allowAll?: boolean
  /** 触发器 aria-label（无障碍） */
  ariaLabel?: string
  /** 触发器悬停提示 */
  title?: string
}

/**
 * 公司单选筛选器（共享实现）：内置"全部公司"项，名称跟随全局"显示简称"开关。
 * 选项按 单体公司/汇总主体 分组显示（前缀标识），选中后触发器仅显示名称（无前缀）。
 */
export function CompanySelect({
  value,
  onChange,
  entitiesOnly = false,
  placeholder = '选择公司',
  className,
  id,
  valueFormat = 'code',
  allLabel = '全部公司',
  allowAll = true,
  ariaLabel,
  title,
}: CompanySelectProps) {
  const { data: companies } = useCompanies()
  const { displayNameMap } = useCompanyDisplayName()
  const entityOptions = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  // entitiesOnly 时隐藏汇总主体组
  const summaryOptions = useMemo(() => (companies ?? []).filter((c) => c.type === 'summary' && !entitiesOnly), [companies, entitiesOnly])

  // 触发器仅显示名称（无前缀）：'all' → allLabel；空值 → placeholder；已选 → 简称/全名
  const selectedLabel = useMemo(() => {
    if (value === 'all') return allLabel
    if (!value) return placeholder
    const code = valueFormat === 'prefixed' && value.includes(':') ? value.slice(value.indexOf(':') + 1) : value
    return displayNameMap.get(code) ?? code
  }, [value, allLabel, placeholder, displayNameMap, valueFormat])

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('w-[200px] max-w-full shrink-0', className)} id={id} aria-label={ariaLabel} title={title} placeholder={placeholder}>
        <span className={cn('truncate', !value && 'text-muted-foreground')}>{selectedLabel}</span>
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value="all">{allLabel}</SelectItem>}
        {entityOptions.length > 0 && (
          <SelectGroup>
            {entityOptions.map((c) => (
              <SelectItem key={c.code} value={valueFormat === 'prefixed' ? `company:${c.code}` : c.code}>
                单体公司-{displayNameMap.get(c.code) ?? c.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {summaryOptions.length > 0 && (
          <SelectGroup>
            {summaryOptions.map((c) => (
              <SelectItem key={c.code} value={valueFormat === 'prefixed' ? `summary:${c.code}` : c.code}>
                汇总主体-{displayNameMap.get(c.code) ?? c.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}

interface CompanyMultiSelectProps {
  /** 已选公司编码；空数组语义为"全部公司" */
  value: string[]
  onChange: (value: string[]) => void
  /** 仅列出单体公司（type === 'entity'），缺省列出全部公司 */
  entitiesOnly?: boolean
  /** "全选"范围：默认全选全部公司；'entity' 时仅全选单体公司（主体互斥场景避免全选带入汇总主体） */
  selectAllType?: 'all' | 'entity'
  className?: string
}

/**
 * 公司多选筛选器（共享实现）：antd Select multiple（与全站单选下拉同视觉），
 * 内置"全选/清空（全部公司）"操作行（popupRender 顶部注入），支持输入搜索公司名。
 * 触发器空数组显示"全部公司"，勾选后显示"名称 tag / 等 N 家"；名称跟随全局"显示简称"开关。
 * 选项按 单体公司/汇总主体 前缀标识平铺；触发器仅显示名称（无前缀）。
 */
export function CompanyMultiSelect({ value, onChange, entitiesOnly = false, selectAllType = 'all', className }: CompanyMultiSelectProps) {
  const { data: companies } = useCompanies()
  const { displayNameMap } = useCompanyDisplayName()
  const entityOptions = useMemo(
    () => (companies ?? []).filter((c) => c.type === 'entity'),
    [companies],
  )
  const summaryOptions = useMemo(() => (companies ?? []).filter((c) => c.type === 'summary' && !entitiesOnly), [companies, entitiesOnly])

  const options = useMemo(
    () => [
      ...entityOptions.map((c) => ({ value: c.code, label: `单体公司-${displayNameMap.get(c.code) ?? c.name}` })),
      ...summaryOptions.map((c) => ({ value: c.code, label: `汇总主体-${displayNameMap.get(c.code) ?? c.name}` })),
    ],
    [entityOptions, summaryOptions, displayNameMap],
  )

  const triggerLabel = useMemo(() => {
    if (value.length === 0) return '全部公司'
    const firstName = displayNameMap.get(value[0]) ?? value[0]
    return value.length === 1 ? firstName : `${firstName} 等 ${value.length} 家`
  }, [value, displayNameMap])

  const selectAll = () =>
    onChange(
      [...entityOptions, ...summaryOptions]
        .filter((c) => selectAllType === 'all' || c.type === selectAllType)
        .map((c) => c.code),
    )

  return (
    <AntdSelect
      mode="multiple"
      value={value}
      onChange={(next) => onChange(next)}
      options={options}
      placeholder="全部公司"
      aria-label={`公司筛选：${triggerLabel}`}
      size={antdSizeFromClassName(className, 'middle')}
      className={cn(`h-9 ${FILTER_WIDTH.subject}`, className)}
      maxTagCount={1}
      maxTagPlaceholder={(omittedValues) => `等 ${omittedValues.length + 1} 家`}
      tagRender={({ label, value: code, closable, onClose }) => (
        <Tag
          closable={closable}
          onClose={onClose}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          className="mr-1"
        >
          {displayNameMap.get(code as string) ?? label}
        </Tag>
      )}
      suffixIcon={<ChevronDown className="h-4 w-4 opacity-50" />}
      popupMatchSelectWidth={false}
      popupRender={(menu) => (
        <div>
          <div className="flex items-center gap-4 border-b border-border/60 px-3 py-1.5">
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={selectAll}>
              全选
            </button>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange([])}>
              清空（全部公司）
            </button>
          </div>
          {menu}
        </div>
      )}
    />
  )
}
