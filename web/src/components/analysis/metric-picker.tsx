import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { analysisMetricKeys, analysisMetricMenu } from '@/lib/analysis-metrics'

/**
 * 指标列选择器（即席分析 `metrics` 入参）。
 *
 * 注意：指标目录来自 `@/lib/analysis-metrics`，它只是「列的标签与分组」来源，供用户勾选；
 * 真正决定「选中后返回哪些列、用什么口径」的是服务端响应的 `columns`（技术方案 D2：
 * 列定义由后端下发）。因此新增指标只需后端加定义，前端补一行标签即可。
 */

export function MetricPicker({
  rowDim,
  value,
  onChange,
  className,
}: {
  rowDim: string
  value: string[]
  onChange: (next: string[]) => void
  className?: string
}) {
  const available = analysisMetricKeys(rowDim)
  const menu = analysisMetricMenu(rowDim)
  const selected = value.filter((k) => available.includes(k))
  const allSelected = available.length > 0 && selected.length === available.length
  const toggle = (key: string): void => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]
    // 保持与可选顺序一致，避免勾选顺序影响 values 的列序
    onChange(available.filter((k) => next.includes(k)))
  }
  const toggleGroup = (group: string): void => {
    const groupKeys = menu.find((g) => g.group === group)?.items.map((i) => i.key) ?? []
    const full = groupKeys.every((k) => selected.includes(k))
    const next = full ? selected.filter((k) => !groupKeys.includes(k)) : [...new Set([...selected, ...groupKeys])]
    onChange(available.filter((k) => next.includes(k)))
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('h-9 gap-2', className)} aria-label="选择指标列">
          指标列
          <span className="text-muted-foreground">({selected.length}/{available.length})</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">选择指标列</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={allSelected}
              onClick={() => onChange(available)}>全选</Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={selected.length === 0}
              onClick={() => onChange([])}>清空</Button>
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {menu.map((section) => (
            <div key={section.group} className="px-1 py-1">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-medium text-muted-foreground">{section.group}</span>
                <Button variant="link" size="sm" className="h-6 px-1 text-xs"
                  onClick={() => toggleGroup(section.group)}>
                  {section.items.every((i) => selected.includes(i.key)) ? '全不选' : '全选'}
                </Button>
              </div>
              {section.items.map((item) => (
                <label key={item.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox checked={selected.includes(item.key)} onCheckedChange={() => toggle(item.key)} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        {selected.length === 0 && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">未选择任何指标列，将使用该维度的默认列集。</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
