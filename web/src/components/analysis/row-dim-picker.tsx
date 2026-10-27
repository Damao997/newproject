import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { AnalysisQuerySpec } from '@/types'
import { ANALYSIS_ROW_DIMS } from '@/types'

/**
 * 行维度选择器（即席分析 `rowDim` 入参，技术方案 §6 的 5 个适配器）。
 *
 * `emptyDims` 是「本次查询返回 0 行」的维度（由上层根据上一次查询结果推导），
 * 只作提示徽标、**不禁用** —— 维度是否可用取决于配置与期间数据，禁用会误导用户
 * （同一维度换个主体/期间可能就有数据）。
 */
export function RowDimPicker({
  value,
  onChange,
  emptyDims = [],
  className,
}: {
  value: AnalysisQuerySpec['rowDim']
  onChange: (next: AnalysisQuerySpec['rowDim']) => void
  emptyDims?: string[]
  className?: string
}) {
  const active = ANALYSIS_ROW_DIMS.find((d) => d.value === value) ?? ANALYSIS_ROW_DIMS[0]
  return (
    <div className={className}>
      <Select value={value} onValueChange={(next) => onChange(next as AnalysisQuerySpec['rowDim'])}>
        <SelectTrigger className="h-9 w-[220px]" aria-label="选择行维度">
          <SelectValue>
            <span className="flex items-center gap-2">
              行维度：<strong>{active.label}</strong>
              {emptyDims.includes(value) && <Badge variant="secondary" className="h-5 px-1 text-[10px]">本次无数据</Badge>}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ANALYSIS_ROW_DIMS.map((dim) => (
            <SelectItem key={dim.value} value={dim.value}>
              <div className="flex flex-col gap-0.5 py-0.5">
                <span className="flex items-center gap-2">
                  {dim.label}
                  {emptyDims.includes(dim.value) && <Badge variant="secondary" className="h-5 px-1 text-[10px]">无数据</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">{dim.hint}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
