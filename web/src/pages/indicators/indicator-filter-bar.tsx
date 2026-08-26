import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompanySelect } from '@/components/filters/company-select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Download, ChevronsDownUp, ChevronsUpDown, Eye, Sparkles, Loader2, Search, X, MoreHorizontal, Rows3, Columns3 } from 'lucide-react'
import { buildColumnsFor, type IndicatorSubjectType } from './indicators-adapters'

interface IndicatorFilterBarProps {
  subjectType: IndicatorSubjectType
  // 主体/期间/去重分类/科目搜索（状态与 handler 由主文件经 props 传入）
  dimFilter: string
  onDimFilterChange: (v: string) => void
  periodFilter: string
  onPeriodFilterChange: (v: string) => void
  periods: string[]
  excludeReclassify: boolean
  onExcludeReclassifyChange: (v: boolean) => void
  subjectKeyword: string
  onSubjectKeywordChange: (v: string) => void
  // 展开/折叠（过滤态下禁用，展开由主文件 effectiveExpanded 托管）
  isAllExpanded: boolean
  onToggleExpandAll: () => void
  // 视图设置：密度 + 隐藏列（持久化到 pageStateStore）
  density: 'default' | 'dense' | 'compact'
  onDensityChange: (v: 'default' | 'dense' | 'compact') => void
  hiddenColumns: string[]
  onHiddenColumnsChange: (cols: string[]) => void
  // 更多操作下拉 / 大屏独立按钮：AI 预分析、查看分析、导出（onClick 经 props 传入）
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

/** 指标页筛选与视图设置区：主体/期间/去重分类/科目搜索 + 列设置 + 密度切换 + 更多操作（AI 预分析/查看分析/导出） */
export function IndicatorFilterBar({
  subjectType,
  dimFilter, onDimFilterChange,
  periodFilter, onPeriodFilterChange, periods,
  excludeReclassify, onExcludeReclassifyChange,
  subjectKeyword, onSubjectKeywordChange,
  isAllExpanded, onToggleExpandAll,
  density, onDensityChange,
  hiddenColumns, onHiddenColumnsChange,
  canCreateReports, canViewReports, canExport,
  aiPreparing, aiDisabled, onAiPreAnalyze, onViewAnalyses,
  exporting, exportDisabled, onExport,
}: IndicatorFilterBarProps) {
  // 小屏（<lg）搜索框浮层展开态（图标按钮点击切换）
  const [searchOpen, setSearchOpen] = useState(false)
  // 过滤态：科目关键字非空时展开/折叠按钮禁用（展开由 effectiveExpanded 托管，避免污染持久化展开态）
  const subjectFiltering = !!subjectKeyword.trim()
  const isCashflow = subjectType === 'cashflow'
  // 列设置面板元数据（按 tab 分区，key/header）
  const columnMeta = buildColumnsFor(subjectType)

  return (
    // 筛选条流体自适应：主体/搜索按剩余空间弹性伸缩（min-w-0 可收缩 + max-w 限幅 + 内部截断），
    // 固定项（期间/开关/按钮组）恒完整；中等分辨率单行不换行，仅极端窄屏 wrap 兜底；
    // 极小屏搜索缩为图标浮层
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {/* 左侧：主体维度选择（弹性伸缩，保证公司名称完整显示；选项前缀+简称跟随全局开关，触发器仅显名称） */}
      <CompanySelect
        value={dimFilter}
        onChange={onDimFilterChange}
        valueFormat="prefixed"
        allLabel="全部主体"
        ariaLabel="主体维度"
        className="h-8 w-auto shrink min-w-0 flex-1 max-w-[260px] border-input/60 bg-page hover:bg-muted/60"
      />

      {/* 科目列关键字筛选：实时过滤科目树（命中节点保留整棵子树与祖先链）；>=600px 弹性伸缩，<600px 缩为图标浮层 */}
      <div className="relative shrink-0 min-[600px]:min-w-0 min-[600px]:flex-1 min-[600px]:max-w-[220px]">
        {/* >=600px：完整输入框（flex-1 弹性填充，min-w-0 可收缩截断） */}
        <div className="hidden min-[600px]:flex min-[600px]:min-w-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={subjectKeyword}
            onChange={(e) => onSubjectKeywordChange(e.target.value)}
            placeholder="搜索科目"
            aria-label="搜索科目"
            className="h-8 w-auto min-w-0 flex-1 max-w-[220px] border-input/60 bg-page pl-8 pr-7 text-[13px]"
          />
          {subjectKeyword && (
            <button
              type="button"
              onClick={() => onSubjectKeywordChange('')}
              aria-label="清空科目搜索"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {/* <600px：仅图标按钮，点击展开 Popover 浮层输入框（Portal 渲染，不受侧边栏/吸顶层级遮挡） */}
        <div className="min-[600px]:hidden">
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="fused"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label={searchOpen ? '收起科目搜索' : '搜索科目'}
                title="搜索科目"
              >
                <Search className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-64 p-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={subjectKeyword}
                  onChange={(e) => onSubjectKeywordChange(e.target.value)}
                  placeholder="搜索科目"
                  aria-label="搜索科目"
                  className="h-8 w-full border-input/60 bg-page pl-8 pr-7 text-[13px]"
                />
                {subjectKeyword && (
                  <button
                    type="button"
                    onClick={() => {
                      onSubjectKeywordChange('')
                      setSearchOpen(false)
                    }}
                    aria-label="清空科目搜索"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* 右侧：期间 + 重分类 + 操作按钮组（lg 以上靠右对齐） */}
      <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
        <Select value={periodFilter} onValueChange={onPeriodFilterChange}>
          <SelectTrigger className="h-8 w-[100px] shrink-0 border-input/60 bg-page hover:bg-muted/60" aria-label="期间">
            <SelectValue placeholder="选择期间" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部期间</SelectItem>
            {periods.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!isCashflow && (
          <div
            className="flex shrink-0 items-center gap-1.5"
            title="按重分类日志快照回溯展示调整前口径，仅供对比查看，不修改数据"
          >
            <Switch id="exclude-reclassify" aria-label="去除重分类影响" checked={excludeReclassify} onCheckedChange={onExcludeReclassifyChange} />
            <Label htmlFor="exclude-reclassify" className="hidden cursor-pointer whitespace-nowrap text-[13px] min-[1300px]:inline">去除重分类影响</Label>
          </div>
        )}

        <div className="mx-1 h-5 w-px shrink-0 bg-border/60" aria-hidden="true" />

        {/* 展开/折叠：800px+ 独立显示（<800px 时在下拉内）；过滤态下禁用（展开由 effectiveExpanded 托管，避免污染持久化展开态） */}
        <Button variant="fused" size="sm" onClick={onToggleExpandAll} disabled={subjectFiltering} className="hidden shrink-0 min-[800px]:inline-flex">
          {isAllExpanded ? <ChevronsDownUp className="mr-1 h-3.5 w-3.5" /> : <ChevronsUpDown className="mr-1 h-3.5 w-3.5" />}
          {isAllExpanded ? '全部折叠' : '全部展开'}
        </Button>

        {/* 小屏与中屏（<1300px）：AI 预分析 / 查看分析 / 导出 合并为「更多操作」下拉；<800px 时展开/折叠也在下拉内 */}
        <div className="shrink-0 min-[1300px]:hidden">
          <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="fused" size="sm">
                  <MoreHorizontal className="mr-1 h-3.5 w-3.5" /> 更多操作
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {/* 展开/折叠全部（仅 <800px 在下拉内，800px+ 已独立显示）；过滤态下禁用 */}
                <DropdownMenuItem onClick={onToggleExpandAll} disabled={subjectFiltering} className="min-[800px]:hidden">
                  {isAllExpanded ? <ChevronsDownUp className="mr-2 h-3.5 w-3.5" /> : <ChevronsUpDown className="mr-2 h-3.5 w-3.5" />}
                  {isAllExpanded ? '全部折叠' : '全部展开'}
                </DropdownMenuItem>
                {canCreateReports && (
                  <DropdownMenuItem onClick={onAiPreAnalyze} disabled={aiDisabled}>
                    {aiPreparing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
                    {aiPreparing ? '数据准备中…' : 'AI 预分析'}
                  </DropdownMenuItem>
                )}
                {canViewReports && (
                  <DropdownMenuItem onClick={onViewAnalyses}>
                    <Eye className="mr-2 h-3.5 w-3.5" /> 查看分析
                  </DropdownMenuItem>
                )}
                {canExport && (
                  <DropdownMenuItem onClick={onExport} disabled={exportDisabled}>
                    {exporting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                    {exporting ? '导出中…' : '导出 Excel'}
                  </DropdownMenuItem>
                )}
                {/* 视图设置：密度 + 列设置（小屏收纳于下拉，大屏独立显示于右侧按钮组） */}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">密度</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={density} onValueChange={(v) => onDensityChange(v as 'default' | 'dense' | 'compact')}>
                  {(
                    [
                      ['default', '标准'],
                      ['dense', '紧凑'],
                      ['compact', '极简'],
                    ] as const
                  ).map(([v, label]) => (
                    <DropdownMenuRadioItem key={v} value={v}>
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">列设置</DropdownMenuLabel>
                {columnMeta.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={!hiddenColumns.includes(col.key)}
                    onCheckedChange={(checked) => {
                      const next = checked
                        ? hiddenColumns.filter((k) => k !== col.key)
                        : [...hiddenColumns, col.key]
                      onHiddenColumnsChange(next)
                    }}
                  >
                    {col.header}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

        {/* 大屏（>=1300px）：AI 预分析 / 查看分析 / 导出 独立显示（展开/折叠已独立于上方） */}
        <div className="hidden shrink-0 min-[1300px]:flex min-[1300px]:items-center min-[1300px]:gap-2">
          {canCreateReports ? (
            <Button
              variant="fused"
              size="sm"
              onClick={onAiPreAnalyze}
              disabled={aiDisabled}
            >
              {aiPreparing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {aiPreparing ? '数据准备中…' : 'AI 预分析'}
            </Button>
          ) : null}
          {canViewReports ? (
            <Button variant="fused" size="sm" onClick={onViewAnalyses}>
              <Eye className="mr-1 h-3.5 w-3.5" /> 查看分析
            </Button>
          ) : null}
          {canExport ? (
            <Button variant="fused" size="sm" onClick={onExport} disabled={exportDisabled}>
              {exporting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
              {exporting ? '导出中…' : '导出 Excel'}
            </Button>
          ) : null}
          {/* 视图设置：密度切换 + 列设置（大屏独立显示，状态持久化） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="fused" size="sm">
                <Rows3 className="mr-1 h-3.5 w-3.5" /> 密度
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuRadioGroup value={density} onValueChange={(v) => onDensityChange(v as 'default' | 'dense' | 'compact')}>
                {(
                  [
                    ['default', '标准'],
                    ['dense', '紧凑'],
                    ['compact', '极简'],
                  ] as const
                ).map(([v, label]) => (
                  <DropdownMenuRadioItem key={v} value={v}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="fused" size="sm">
                <Columns3 className="mr-1 h-3.5 w-3.5" /> 列设置
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {columnMeta.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={!hiddenColumns.includes(col.key)}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? hiddenColumns.filter((k) => k !== col.key)
                      : [...hiddenColumns, col.key]
                    onHiddenColumnsChange(next)
                  }}
                >
                  {col.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
