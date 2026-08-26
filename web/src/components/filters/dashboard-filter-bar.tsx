import { CompanySelect } from '@/components/filters/company-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FILTER_WIDTH } from '@/components/layout/filter-width'

interface DashboardFilterBarProps {
  dimFilter: string
  onDimChange: (v: string) => void
  selectedPeriod: string
  onPeriodChange: (v: string) => void
  periodOptions: string[]
}

/**
 * 看板筛选块（首页看板与经营分析子页共用）：主体 + 期间。
 * 口径与 useDashboardFilters 一致；统一 h-9 控件高与语义宽度。
 */
export function DashboardFilterBar({ dimFilter, onDimChange, selectedPeriod, onPeriodChange, periodOptions }: DashboardFilterBarProps) {
  return (
    <>
      <CompanySelect
        value={dimFilter}
        onChange={onDimChange}
        valueFormat="prefixed"
        allLabel="全部主体"
        ariaLabel="选择主体维度（汇总主体自动展开为成员合并口径）"
        title="选择主体维度（汇总主体自动展开为成员合并口径）"
        className={`h-9 ${FILTER_WIDTH.subject} border-input/60 bg-page hover:bg-muted/60`}
      />
      {periodOptions.length > 0 && (
        <div className="flex items-center gap-2">
          <Select
            value={selectedPeriod || periodOptions[periodOptions.length - 1] || 'latest'}
            onValueChange={(v) => onPeriodChange(v === 'latest' ? '' : v)}
          >
            {/* 未选时直接回显最新期间实际值（YYYY-MM），而非占位符文本；'latest' 项仍保留「跟随最新」语义 */}
            <SelectTrigger className={`h-9 ${FILTER_WIDTH.period} border-input/60 bg-page hover:bg-muted/60`} title="选择预览期间">
              <SelectValue placeholder="最新期间" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">最新期间</SelectItem>
              {[...periodOptions].reverse().map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  )
}
