/* eslint-disable react/only-export-components -- OPERATING_COLUMNS/STATIC_COLUMNS 列配置导出供后续任务（排序/筛选/列设置）复用 */
import { Fragment, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, ChevronDown, Filter, MessageSquarePlus } from 'lucide-react'
import type { SortDirection } from '@/components/data-table/data-table'
import { cn, formatMetricValue, getChangeColor } from '@/lib/utils'
import { TABLE_HEAD_BASE } from '@/components/data-table/styles'
import { calcYoy, calcAchievement, calcYtdYoy, type MetricValue } from '@/lib/metric-values'
import type { SubjectNode } from '@/types'
import { RateBar } from '@/components/ui/rate-bar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'

export type MetricTreeVariant = 'operating' | 'static'

interface MetricTreeProps {
  nodes: SubjectNode[]
  /** 分类筛选候选集（Popover 列表与「全部勾选回退 null」判定的基准；缺省回退 nodes）：
   * 页面传搜索过滤后、分类过滤前的 level0 树，避免部分筛选态下候选集被截断 */
  categoryCandidates?: SubjectNode[]
  /** 科目编码 → 指标值映射 */
  valueMap: Map<string, MetricValue>
  /** 经营指标（期间维度多列）或静态指标（本期/同期/变动率） */
  variant: MetricTreeVariant
  /** 已展开的科目编码集合（受控） */
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  /** 是否将 level0 抽为最左侧「分类」列（同组跨行合并） */
  categoryColumn?: boolean
  /** 传入后在科目名旁悬停浮现「分析」入口，点击回调该科目节点 */
  onAnalyze?: (node: SubjectNode) => void
  /** 分析操作禁用（如未选择单一公司主体）；禁用时按钮置灰并展示 hint 提示 */
  analyzeDisabled?: boolean
  /** 分析操作禁用时的提示文案（title/tooltip） */
  analyzeHint?: string
  emptyText?: string
  /** 吸顶筛选区高度（px）：>0 时表格容器吸顶于该偏移并内部滚动，表头 th 固定在容器顶部（配合 PageContainer stickyHeader 使用） */
  stickyHeaderTop?: number
  /** 受控排序键（null 表示不排序；传 onSortChange 时建议同时传入） */
  sortKey?: string | null
  /** 受控排序方向 */
  sortDirection?: SortDirection | null
  /** 排序变更回调（方向循环：升序 → 降序 → 取消，取消时 direction 为 null） */
  onSortChange?: (key: string, direction: SortDirection | null) => void
  /** 分类列筛选（null = 全部；否则为勾选 level0 code 列表）；仅 categoryColumn 时生效 */
  categoryFilter?: string[] | null
  /** 分类筛选变更回调（null = 全部） */
  onCategoryFilterChange?: (codes: string[] | null) => void
  /** 表格密度（对齐 DataTable 三档；缺省 default） */
  density?: 'default' | 'dense' | 'compact'
  /** 隐藏的值列 key 列表 */
  hiddenColumns?: string[]
}

/** 涨跌彩色变化值（红涨绿跌、无箭头、等宽数字居中）：统一按相对增长率百分比显示；零值显示 '-' */
function ChangeText({ value }: { value: number }) {
  return (
    <span className={cn('font-num', getChangeColor(value))}>
      {value === 0 ? '-' : `${(value * 100).toFixed(1)}%`}
    </span>
  )
}

/** 分类列固定宽度（px）：sticky 偏移与列宽单一来源（用户要求 96px） */
const CATEGORY_COL_WIDTH = 96

/** 表头组名行高度（px）：与 h-11（44px）对应，明细行 sticky top 偏移的单一来源；修改表头行高需同步此值 */
const GROUP_HEAD_H = 44

/** 密度 → 数据行纵向内边距（对齐 DataTable 三档命名） */
const ROW_PAD: Record<'default' | 'dense' | 'compact', string> = {
  default: 'py-2',
  dense: 'py-1.5',
  compact: 'py-1',
}

/** 值列形态：amount 金额 / pct 红涨绿跌百分比 / achievement 达成率进度条 */
type MetricColKind = 'amount' | 'pct' | 'achievement'

interface MetricColumn {
  key: string
  header: string
  minWidth: number
  kind: MetricColKind
  /** 主列强调（font-medium） */
  primary?: boolean
  /** 次要列降权（text-muted-foreground） */
  secondary?: boolean
}

/** 经营指标值列（达成率归「本年累计」组尾：累计达成率 = 本年累计/全年预算） */
export const OPERATING_COLUMNS: MetricColumn[] = [
  { key: 'budget', header: '预算金额', minWidth: 112, kind: 'amount' },
  { key: 'actual', header: '本月实际', minWidth: 112, kind: 'amount', primary: true },
  { key: 'samePeriod', header: '同期实际', minWidth: 112, kind: 'amount', secondary: true },
  { key: 'yoy', header: '同比', minWidth: 80, kind: 'pct' },
  { key: 'ytd', header: '本年累计', minWidth: 112, kind: 'amount', primary: true },
  { key: 'samePeriodYtd', header: '同期累计', minWidth: 112, kind: 'amount', secondary: true },
  { key: 'ytdYoy', header: '累计同比', minWidth: 80, kind: 'pct' },
  { key: 'achievement', header: '达成率', minWidth: 152, kind: 'achievement' },
]

/** 经营指标分组表头：组名 → 明细列 keys */
const OPERATING_GROUPS: { label: string; keys: string[] }[] = [
  { label: '本月实际', keys: ['budget', 'actual', 'samePeriod', 'yoy'] },
  { label: '本年累计', keys: ['ytd', 'samePeriodYtd', 'ytdYoy', 'achievement'] },
]

/** 列 key → 列对象索引（消除表头渲染的 find 重复遍历；注意 OPERATING_GROUPS 与 OPERATING_COLUMNS 仍为双源，新增列需同步两处；下方 `!` 非空断言依赖 key 拼写与 OPERATING_COLUMNS 完全一致） */
const OPERATING_COL_BY_KEY = new Map(OPERATING_COLUMNS.map((c) => [c.key, c]))

/** 静态指标值列（单行表头，无分组） */
export const STATIC_COLUMNS: MetricColumn[] = [
  { key: 'actual', header: '本期金额', minWidth: 112, kind: 'amount', primary: true },
  { key: 'samePeriod', header: '同期金额', minWidth: 112, kind: 'amount', secondary: true },
  { key: 'yoy', header: '变动率', minWidth: 80, kind: 'pct' },
]

/** 数值单元格：按列配置渲染（金额/数量/比率分型格式化；同比红涨绿跌；达成率进度条 + 条内居中的百分比） */
function renderValueCells(
  mv: MetricValue | undefined,
  columns: MetricColumn[],
  valueType?: SubjectNode['valueType'],
  rowPad = ROW_PAD.default,
) {
  const fmt = (v: number) => formatMetricValue(v, valueType)
  const yoyOf = (key: string, value: MetricValue) => (key === 'ytdYoy' ? calcYtdYoy(value) : calcYoy(value))
  return columns.map((col) => {
    const cellBase = cn(
      'whitespace-nowrap border-b px-3 align-middle text-center font-num',
      rowPad,
      col.primary && 'font-medium',
      col.secondary && 'text-muted-foreground',
    )
    let content: ReactNode = '-'
    if (mv) {
      if (col.kind === 'amount') {
        content = fmt(mv[col.key as 'budget' | 'actual' | 'samePeriod' | 'ytd' | 'samePeriodYtd'])
      } else if (col.kind === 'pct') {
        content = <ChangeText value={yoyOf(col.key, mv)} />
      } else {
        // 达成率 = 累计达成率（本年累计/全年预算）；无预算时 RateBar 传 null 显示空条
        const rate = mv.budget === 0 ? null : calcAchievement(mv)
        content = <RateBar rate={rate} variant="above" />
      }
    }
    return (
      <td key={col.key} className={cellBase} style={{ minWidth: col.minWidth }}>
        {content}
      </td>
    )
  })
}

/** 科目名称单元格：缩进 + 展开折叠箭头 + 名称 + 悬停浮现分析图标；sticky 锁定首列（横向滚动时保持科目上下文） */
function SubjectCell({
  node,
  indentDepth,
  expandedCodes,
  onToggle,
  stickyLeftPx = 0,
  onAnalyze,
  analyzeDisabled,
  analyzeHint,
  rowPad = ROW_PAD.default,
}: {
  node: SubjectNode
  indentDepth: number
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  /** sticky 左偏移（px）：分类列存在时传 CATEGORY_COL_WIDTH，普通布局 0 */
  stickyLeftPx?: number
  onAnalyze?: (node: SubjectNode) => void
  analyzeDisabled?: boolean
  analyzeHint?: string
  /** 数据行纵向内边距（对齐密度三档；缺省 py-2） */
  rowPad?: string
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = expandedCodes.has(node.code)
  return (
    <td
      className={cn(
        'sticky z-[1] min-w-[160px] border-b border-r bg-background px-4 align-middle shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)] transition-colors group-hover:bg-muted',
        rowPad,
      )}
      style={{ left: stickyLeftPx }}
    >
      <div className="relative flex items-center" style={{ paddingLeft: indentDepth * 20 }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.code)}
            className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={isExpanded ? '折叠' : '展开'}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="mr-1 inline-block h-5 w-5 shrink-0" />
        )}
        <span className={cn(indentDepth === 0 && 'font-semibold', 'relative whitespace-nowrap text-foreground')}>
          {node.name}
          {/* 分析入口：行悬停/键盘聚焦时在科目名右侧浮现；absolute 锚定名称右缘（不随列宽/缩进漂移），且不占列宽 */}
          {onAnalyze && (
            <button
              type="button"
              onClick={() => onAnalyze(node)}
              disabled={analyzeDisabled}
              title={analyzeDisabled ? analyzeHint : '撰写单项分析'}
              aria-label="撰写单项分析"
              className={cn(
                'absolute -right-6 top-1/2 -translate-y-1/2 rounded p-0.5 text-primary opacity-0 transition-opacity hover:bg-primary/10 focus-visible:opacity-100 group-hover:opacity-100',
                analyzeDisabled && 'cursor-not-allowed opacity-0 hover:bg-transparent group-hover:opacity-40',
              )}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
    </td>
  )
}

/** 普通树形行（静态指标 / 非分类布局） */
function MetricRows({
  nodes,
  depth,
  valueMap,
  columns,
  expandedCodes,
  onToggle,
  onAnalyze,
  analyzeDisabled,
  analyzeHint,
  rowPad,
}: {
  nodes: SubjectNode[]
  depth: number
  valueMap: Map<string, MetricValue>
  columns: MetricColumn[]
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  onAnalyze?: (node: SubjectNode) => void
  analyzeDisabled?: boolean
  analyzeHint?: string
  rowPad: string
}) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0
        const isExpanded = expandedCodes.has(node.code)
        return (
          <Fragment key={node.code}>
            <tr className="group transition-colors hover:!bg-muted/50">
              <SubjectCell
                node={node}
                indentDepth={depth}
                expandedCodes={expandedCodes}
                onToggle={onToggle}
                onAnalyze={onAnalyze}
                analyzeDisabled={analyzeDisabled}
                analyzeHint={analyzeHint}
                rowPad={rowPad}
              />
              {renderValueCells(valueMap.get(node.code), columns, node.valueType, rowPad)}
            </tr>
            {hasChildren && isExpanded && (
              <MetricRows
                nodes={node.children}
                depth={depth + 1}
                valueMap={valueMap}
                columns={columns}
                expandedCodes={expandedCodes}
                onToggle={onToggle}
                onAnalyze={onAnalyze}
                analyzeDisabled={analyzeDisabled}
                analyzeHint={analyzeHint}
                rowPad={rowPad}
              />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

/** 按展开态前序收集 level1+ 可见节点 */
function collectVisibleRows(children: SubjectNode[], expandedCodes: Set<string>): SubjectNode[] {
  const rows: SubjectNode[] = []
  const walk = (nodes: SubjectNode[]) => {
    for (const n of nodes) {
      rows.push(n)
      if (n.children.length > 0 && expandedCodes.has(n.code)) walk(n.children)
    }
  }
  walk(children)
  return rows
}

/** 分类列布局行（经营指标）：level0 抽为最左侧跨行「分类」列（sticky 锁定，固定宽 96px） */
function CategoryRows({
  level0Nodes,
  valueMap,
  columns,
  expandedCodes,
  onToggle,
  onAnalyze,
  analyzeDisabled,
  analyzeHint,
  rowPad,
}: {
  level0Nodes: SubjectNode[]
  valueMap: Map<string, MetricValue>
  columns: MetricColumn[]
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  onAnalyze?: (node: SubjectNode) => void
  analyzeDisabled?: boolean
  analyzeHint?: string
  rowPad: string
}) {
  // 悬停高亮分类列：rowSpan 单元格 DOM 只属于组内首行，group-hover 无法响应其他行悬停，改为 JS 跟踪悬停行所属组
  const [hoverCat, setHoverCat] = useState<string | null>(null)
  return (
    <>
      {level0Nodes.map((cat) => {
        const rows = collectVisibleRows(cat.children, expandedCodes)
        if (rows.length === 0) return null
        const catHovered = hoverCat === cat.code
        return (
          <Fragment key={cat.code}>
            {rows.map((node, idx) => (
              <tr
                key={node.code}
                className="group transition-colors hover:!bg-muted/50"
                onMouseEnter={() => setHoverCat(cat.code)}
                onMouseLeave={() => setHoverCat((prev) => (prev === cat.code ? null : prev))}
              >
                {idx === 0 && (
                  <td
                    rowSpan={rows.length}
                    className={cn(
                      'sticky left-0 z-[1] overflow-hidden whitespace-normal border-b border-r bg-background px-2 text-center align-middle font-semibold text-foreground shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)]',
                      catHovered && 'bg-muted',
                    )}
                    style={{ width: CATEGORY_COL_WIDTH, minWidth: CATEGORY_COL_WIDTH, maxWidth: CATEGORY_COL_WIDTH }}
                  >
                    {cat.name}
                  </td>
                )}
                {/* 科目列缩进：level1 → 0，level2 → 1 ...；分类列占 CATEGORY_COL_WIDTH，科目列 sticky 偏移对齐 */}
                <SubjectCell
                  node={node}
                  indentDepth={node.level - 1}
                  expandedCodes={expandedCodes}
                  onToggle={onToggle}
                  stickyLeftPx={CATEGORY_COL_WIDTH}
                  onAnalyze={onAnalyze}
                  analyzeDisabled={analyzeDisabled}
                  analyzeHint={analyzeHint}
                  rowPad={rowPad}
                />
                {renderValueCells(valueMap.get(node.code), columns, node.valueType, rowPad)}
              </tr>
            ))}
          </Fragment>
        )
      })}
    </>
  )
}

/**
 * 财务指标科目树：以树形结构展示科目层级，并按当前主体维度 + 期间渲染期间维度数值列。
 *
 * 经营指标列：分类(可选) / 科目 / 本月实际组(预算金额/本月实际/同期实际/同比) / 本年累计组(本年累计/同期累计/累计同比/达成率)。
 * 静态指标列：科目 / 本期金额 / 同期金额 / 变动率。
 * 数值列按列配置渲染；同比/累计同比/变动率红涨绿跌无箭头；达成率进度条（RateBar above）= 本年累计 / 全年预算。
 */
export function MetricTree({
  nodes,
  categoryCandidates,
  valueMap,
  variant,
  expandedCodes,
  onToggle,
  categoryColumn = false,
  onAnalyze,
  analyzeDisabled = false,
  analyzeHint,
  emptyText = '暂无数据',
  stickyHeaderTop = 0,
  sortKey,
  sortDirection,
  onSortChange,
  categoryFilter,
  onCategoryFilterChange,
  density,
  hiddenColumns,
}: MetricTreeProps) {
  const isOperating = variant === 'operating'
  // 密度 → 数据行纵向内边距（py-2 / py-1.5 / py-1，对齐 DataTable 三档）
  const rowPad = ROW_PAD[density ?? 'default']
  // 列显隐：隐藏列不渲染表头与数据行（分组表头 colSpan 同步按可见列数）
  const valueCols = (isOperating ? OPERATING_COLUMNS : STATIC_COLUMNS).filter((c) => !hiddenColumns?.includes(c.key))
  const visibleGroups = isOperating
    ? OPERATING_GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => !hiddenColumns?.includes(k)) })).filter((g) => g.keys.length > 0)
    : []
  const colSpan = 1 + valueCols.length + (categoryColumn ? 1 : 0)
  // 表头 sticky：组名行 top-0、明细行 top-GROUP_HEAD_H（组名行 h-11=44px，模块级 GROUP_HEAD_H 单一来源）
  // TABLE_HEAD_BASE（13px/500 黑字居中）为共享样式常量，对齐《统一表格设计标准》
  const headBase = cn(TABLE_HEAD_BASE, 'h-11 border-b bg-muted px-3')

  /** 排序三态循环：升序 → 降序 → 取消（受控，与 DataTable 一致；取消时 sortKey 保持键值、direction 为 null，再次点击回升序） */
  const handleSort = (key: string) => {
    const next =
      sortKey === key
        ? sortDirection === 'asc'
          ? { key, direction: 'desc' as const }
          : sortDirection === 'desc'
            ? { key, direction: null as const }
            : { key, direction: 'asc' as const }
        : { key, direction: 'asc' as const }
    onSortChange?.(next.key, next.direction)
  }
  return (
    // 浅灰圆角容器（与 DataTable 视觉一致）：overflow-hidden 将白底表格直角裁剪为 8px 圆角（rounded-card）
    <div className="overflow-hidden rounded-card bg-muted/40 p-2">
      <div
        className={cn('bg-background', 'overflow-x-auto', stickyHeaderTop > 0 && 'overflow-y-auto')}
        style={
          stickyHeaderTop > 0
            ? { position: 'sticky', top: stickyHeaderTop, maxHeight: `calc(100dvh - ${stickyHeaderTop}px - 24px)` }
            : undefined
        }
      >
        {/* border-separate：sticky 单元格边框随滚动稳定跟随（collapse 模式下边框渲染异常） */}
        {/* minWidth 兜底：窄容器下表格保持完整列宽走横向滚动，列宽永不小于各列 min-w，杜绝浏览器压缩截断 */}
        {/* 斑马纹：tbody 偶数行浅灰底；hover:!bg-muted 加 important 盖过斑马纹选择器（[&_tbody_tr:nth-child(even)] 特异性更高，不加 important 时偶数行悬停高亮不生效） */}
        <table
          className="w-full caption-bottom border-separate border-spacing-0 text-[13px] [&_tbody_tr:nth-child(even)]:bg-muted/30"
          style={{ minWidth: isOperating ? 1128 : 464 }}
        >
          <thead>
            {isOperating ? (
              <>
                {/* 组名行：sticky top-0 固定容器顶 */}
                <tr className="sticky top-0 z-[2] bg-muted">
                  {categoryColumn && (
                    <th
                      rowSpan={2}
                      scope="col"
                      className={cn(headBase, 'sticky left-0 z-[3] border-r bg-muted text-center shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)]')}
                      style={{ width: CATEGORY_COL_WIDTH, minWidth: CATEGORY_COL_WIDTH, maxWidth: CATEGORY_COL_WIDTH }}
                    >
                      {categoryColumn && onCategoryFilterChange ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span>分类</span>
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                aria-label="筛选分类"
                                className={cn(
                                  'rounded p-0.5 transition-colors hover:bg-muted',
                                  categoryFilter && categoryFilter.length > 0 ? 'text-primary' : 'text-muted-foreground',
                                )}
                              >
                                <Filter className="h-3.5 w-3.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" sideOffset={4} className="w-48 p-2">
                              <div className="space-y-1">
                                {/* 分类候选集：categoryCandidates 优先（完整候选），缺省回退 nodes（无候选传参场景） */}
                                {(categoryCandidates ?? nodes).map((n) => (
                                  <label
                                    key={n.code}
                                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-muted/60"
                                  >
                                    <Checkbox
                                      checked={categoryFilter ? categoryFilter.includes(n.code) : true}
                                      onCheckedChange={() => {
                                        const cur = categoryFilter ?? (categoryCandidates ?? nodes).map((x) => x.code)
                                        const next = cur.includes(n.code) ? cur.filter((c) => c !== n.code) : [...cur, n.code]
                                        onCategoryFilterChange(next.length === (categoryCandidates ?? nodes).length ? null : next)
                                      }}
                                    />
                                    <span className="truncate">{n.name}</span>
                                  </label>
                                ))}
                              </div>
                              <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-1.5">
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => onCategoryFilterChange(null)}
                                >
                                  全选
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground hover:text-foreground"
                                  onClick={() => onCategoryFilterChange([])}
                                >
                                  清空
                                </button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                      ) : (
                        <span>分类</span>
                      )}
                    </th>
                  )}
                  <th
                    rowSpan={2}
                    scope="col"
                    className={cn(headBase, 'sticky z-[3] min-w-[160px] border-r bg-muted text-center shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)]')}
                    style={{ left: categoryColumn ? CATEGORY_COL_WIDTH : 0 }}
                  >
                    科目
                  </th>
                  {visibleGroups.map((g) => (
                    <th
                      key={g.label}
                      colSpan={g.keys.length}
                      scope="colgroup"
                      className={cn(headBase, 'border-l border-border/60 text-[13px] font-semibold')}
                    >
                      {g.label}
                    </th>
                  ))}
                </tr>
                {/* 明细行：sticky 固定于组名行下方（top = 组名行高 44px）；白底与组名行灰底形成层次（sticky 需不透明背景） */}
                <tr className="sticky bg-background" style={{ top: GROUP_HEAD_H }}>
                  {visibleGroups.flatMap((g) => g.keys).map((key) => {
                    const col = OPERATING_COL_BY_KEY.get(key)!
                    const sortState = sortKey === col.key ? sortDirection : null
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        aria-sort={sortState ? (sortState === 'asc' ? 'ascending' : 'descending') : undefined}
                        className={cn(headBase, 'bg-background text-center')}
                        style={{ minWidth: col.minWidth }}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(col.key)}
                          className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                          aria-label={`按${col.header}排序`}
                        >
                          {col.header}
                          {sortState ? (
                            sortState === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                          )}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </>
            ) : (
              <tr className="sticky top-0 z-[2] bg-muted">
                <th
                  scope="col"
                  className={cn(headBase, 'sticky z-[3] min-w-[160px] border-r bg-muted text-center shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)]')}
                  style={{ left: categoryColumn ? CATEGORY_COL_WIDTH : 0 }}
                >
                  科目
                </th>
                {valueCols.map((col) => {
                  const sortState = sortKey === col.key ? sortDirection : null
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={sortState ? (sortState === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={cn(headBase, 'text-center')}
                      style={{ minWidth: col.minWidth }}
                    >
                      <button
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                        aria-label={`按${col.header}排序`}
                      >
                        {col.header}
                        {sortState ? (
                          sortState === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                        )}
                      </button>
                    </th>
                  )
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {nodes.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="p-6 text-center text-muted-foreground">
                  {emptyText}
                </td>
              </tr>
            ) : categoryColumn ? (
              <CategoryRows
                level0Nodes={nodes}
                valueMap={valueMap}
                columns={valueCols}
                expandedCodes={expandedCodes}
                onToggle={onToggle}
                onAnalyze={onAnalyze}
                analyzeDisabled={analyzeDisabled}
                analyzeHint={analyzeHint}
                rowPad={rowPad}
              />
            ) : (
              <MetricRows
                nodes={nodes}
                depth={0}
                valueMap={valueMap}
                columns={valueCols}
                expandedCodes={expandedCodes}
                onToggle={onToggle}
                onAnalyze={onAnalyze}
                analyzeDisabled={analyzeDisabled}
                analyzeHint={analyzeHint}
                rowPad={rowPad}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
