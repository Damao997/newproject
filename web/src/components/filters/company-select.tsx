import { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCompanies } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { cn } from '@/lib/utils'

interface CompanySelectProps {
  /** 'all' 表示全部公司，否则为公司编码 */
  value: string
  onChange: (value: string) => void
  /** 仅列出单体公司（type === 'entity'），缺省列出全部公司 */
  entitiesOnly?: boolean
  /** 无值时的占位文案 */
  placeholder?: string
  className?: string
}

/**
 * 公司单选筛选器（共享实现）：内置"全部公司"项，名称跟随全局"显示简称"开关。
 * 替代各页面内联的 Select + useCompanies 重复写法。
 */
export function CompanySelect({ value, onChange, entitiesOnly = false, placeholder = '选择公司', className }: CompanySelectProps) {
  const { data: companies } = useCompanies()
  const { displayNameMap } = useCompanyDisplayName()
  const options = useMemo(
    () => (companies ?? []).filter((c) => !entitiesOnly || c.type === 'entity'),
    [companies, entitiesOnly],
  )

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('w-[200px] max-w-full shrink-0', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">全部公司</SelectItem>
        {options.map((c) => (
          <SelectItem key={c.code} value={c.code}>{displayNameMap.get(c.code) ?? c.name}</SelectItem>
        ))}
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
 * 公司多选筛选器（共享实现）：DropdownMenu 复选框式，内置"全选/清空（全部公司）"，
 * 触发器文案"全部公司 / 首选名称 / 首选名称 等 N 家"，名称跟随全局"显示简称"开关。
 */
export function CompanyMultiSelect({ value, onChange, entitiesOnly = false, selectAllType = 'all', className }: CompanyMultiSelectProps) {
  const { data: companies } = useCompanies()
  const { displayNameMap } = useCompanyDisplayName()
  const options = useMemo(
    () => (companies ?? []).filter((c) => !entitiesOnly || c.type === 'entity'),
    [companies, entitiesOnly],
  )

  const triggerLabel = useMemo(() => {
    if (value.length === 0) return '全部公司'
    const firstName = displayNameMap.get(value[0]) ?? value[0]
    return value.length === 1 ? firstName : `${firstName} 等 ${value.length} 家`
  }, [value, displayNameMap])

  const toggle = (code: string, checked: boolean) =>
    onChange(checked ? [...value, code] : value.filter((c) => c !== code))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label={`公司筛选：${triggerLabel}`}
          className={cn('h-9 w-[220px] max-w-full shrink-0 justify-between px-3 font-normal', className)}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[320px] w-[240px] overflow-y-auto">
        <DropdownMenuItem
          className="text-xs text-muted-foreground"
          onSelect={(e) => { e.preventDefault(); onChange(options.filter((c) => selectAllType === 'all' || c.type === selectAllType).map((c) => c.code)) }}
        >
          全选
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-xs text-muted-foreground"
          onSelect={(e) => { e.preventDefault(); onChange([]) }}
        >
          清空（全部公司）
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map((company) => (
          <DropdownMenuCheckboxItem
            key={company.code}
            checked={value.includes(company.code)}
            onCheckedChange={(checked) => toggle(company.code, checked === true)}
            onSelect={(e) => e.preventDefault()}
          >
            {displayNameMap.get(company.code) ?? company.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
