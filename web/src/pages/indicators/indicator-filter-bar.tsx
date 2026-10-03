import { useRef } from 'react'
import type { InputRef } from 'antd'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Download, ChevronsDownUp, ChevronsUpDown, Eye, Sparkles, Loader2, Search, X, MoreHorizontal, SlidersHorizontal } from 'lucide-react'
import { buildColumnsFor, type IndicatorSubjectType } from './indicators-adapters'

interface IndicatorFilterBarProps {
  subjectType: IndicatorSubjectType
  excludeReclassify: boolean
  onExcludeReclassifyChange: (v: boolean) => void
  subjectKeyword: string
  onSubjectKeywordChange: (v: string) => void
  isAllExpanded: boolean
  onToggleExpandAll: () => void
  density: 'default' | 'dense' | 'compact'
  onDensityChange: (v: 'default' | 'dense' | 'compact') => void
  hiddenColumns: string[]
  onHiddenColumnsChange: (cols: string[]) => void
  canCreateReports: boolean
  canViewReports: boolean
  canExport: boolean
  aiPreparing: boolean
  aiDisabled: boolean
  onAiPreAnalyze: () => void
  onViewAnalyses: () => void
  exporting: boolean
  exportDisabled: boolean
  onExport: () => void
}

/** 常用筛选与导出常驻；展开、密度和列归入视图设置，分析归入更多。 */
export function IndicatorFilterBar({
  subjectType, excludeReclassify, onExcludeReclassifyChange, subjectKeyword, onSubjectKeywordChange,
  isAllExpanded, onToggleExpandAll, density, onDensityChange, hiddenColumns, onHiddenColumnsChange,
  canCreateReports, canViewReports, canExport, aiPreparing, aiDisabled, onAiPreAnalyze, onViewAnalyses,
  exporting, exportDisabled, onExport,
}: IndicatorFilterBarProps) {
  const inputRef = useRef<InputRef>(null)
  const columnMeta = buildColumnsFor(subjectType)
  const subjectFiltering = !!subjectKeyword.trim()
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
      <div className="relative min-w-[150px] flex-1 sm:max-w-[260px]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input ref={inputRef} value={subjectKeyword} onChange={(e) => onSubjectKeywordChange(e.target.value)} placeholder="搜索科目" aria-label="搜索科目" className="h-8 w-full pl-8 pr-8" />
        {subjectKeyword && <button type="button" onClick={() => { onSubjectKeywordChange(''); inputRef.current?.focus() }} aria-label="清空科目搜索" className="absolute right-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>}
      </div>
      <div className="flex shrink-0 items-center gap-2" title="按重分类日志快照展示调整前口径，仅用于对比，不修改数据">
        <Switch id="exclude-reclassify" aria-label="去除重分类影响" checked={excludeReclassify} onCheckedChange={onExcludeReclassifyChange} />
        <Label htmlFor="exclude-reclassify" className="cursor-pointer whitespace-nowrap text-xs">去除重分类影响</Label>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><SlidersHorizontal className="mr-1 h-3.5 w-3.5" />视图设置{hiddenColumns.length > 0 && <span className="ml-1 text-muted-foreground">· {hiddenColumns.length} 列隐藏</span>}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={onToggleExpandAll} disabled={subjectFiltering}>
              {isAllExpanded ? <ChevronsDownUp className="mr-2 h-4 w-4" /> : <ChevronsUpDown className="mr-2 h-4 w-4" />}
              {isAllExpanded ? '全部折叠' : '全部展开'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">表格密度</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={density} onValueChange={(v) => onDensityChange(v as 'default' | 'dense' | 'compact')}>
              {([['default', '标准'], ['dense', '紧凑'], ['compact', '极简']] as const).map(([v, label]) => <DropdownMenuRadioItem key={v} value={v} onSelect={(e) => e.preventDefault()}>{label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">显示列</DropdownMenuLabel>
            {columnMeta.map((col) => <DropdownMenuCheckboxItem key={col.key} checked={!hiddenColumns.includes(col.key)} onSelect={(e) => e.preventDefault()} onCheckedChange={(checked) => onHiddenColumnsChange(checked ? hiddenColumns.filter((k) => k !== col.key) : [...hiddenColumns, col.key])}>{col.header}</DropdownMenuCheckboxItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        {(canCreateReports || canViewReports) && <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm" loading={aiPreparing}><MoreHorizontal className="mr-1 h-4 w-4" />更多</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {canCreateReports && <DropdownMenuItem onClick={onAiPreAnalyze} disabled={aiDisabled}>{aiPreparing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{aiPreparing ? '数据准备中…' : 'AI 预分析'}</DropdownMenuItem>}
            {canViewReports && <DropdownMenuItem onClick={onViewAnalyses}><Eye className="mr-2 h-4 w-4" />查看分析</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>}
        {canExport && <Button variant="outline" size="sm" onClick={onExport} disabled={exportDisabled} loading={exporting}><Download className="mr-1 h-3.5 w-3.5" />{exporting ? '导出中…' : '导出 Excel'}</Button>}
      </div>
    </div>
  )
}
