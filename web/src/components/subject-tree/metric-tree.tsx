import { Fragment, useState } from 'react'
import { ChevronRight, ChevronDown, MessageSquarePlus } from 'lucide-react'
import { cn, formatMetricValue, formatPercent, getChangeColor } from '@/lib/utils'
import { calcYoy, calcAchievement, calcYtdYoy, type MetricValue } from '@/lib/metric-values'
import type { SubjectNode } from '@/types'

export type MetricTreeVariant = 'operating' | 'static'

interface MetricTreeProps {
  nodes: SubjectNode[]
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

/** 值列数（不含科目/分类列） */
function valueColCount(isOperating: boolean): number {
  return isOperating ? 8 : 3
}

/** 数值单元格：按 variant + 值类型输出各期间维度列（金额/数量/比率分型格式化）；同比统一按相对增长率 */
function renderValueCells(mv: MetricValue | undefined, isOperating: boolean, valueType?: SubjectNode['valueType']) {
  // 金额/数量列预留最小宽度，保证窄容器下数值完整显示（类名与 AMOUNT_COL_MIN_WIDTH/PCT_COL_MIN_WIDTH 常量一致）；百分比列较窄（px-3：压缩列宽，小屏多释放数值列空间）
  const cellAmt = 'whitespace-nowrap border-b px-3 py-2 align-middle text-center font-num min-w-[112px]'
  const cellPct = 'whitespace-nowrap border-b px-3 py-2 align-middle text-center font-num min-w-[80px]'
  const fmt = (v: number) => formatMetricValue(v, valueType)
  // 同比 = 相对同期增长率（比率科目同样用增长率，如 20%→22% 显示 +10.0%）
  const yoy = (mv: MetricValue) => <ChangeText value={calcYoy(mv)} />
  if (isOperating) {
    return (
      <>
        <td className={cellAmt}>{mv ? fmt(mv.budget) : '-'}</td>
        <td className={cellAmt}>{mv ? fmt(mv.actual) : '-'}</td>
        <td className={cellAmt}>{mv ? fmt(mv.samePeriod) : '-'}</td>
        <td className={cn(cellPct, 'font-medium')}>{mv ? yoy(mv) : '-'}</td>
        <td className={cellPct}>{mv ? formatPercent(calcAchievement(mv)) : '-'}</td>
        <td className={cellAmt}>{mv ? fmt(mv.ytd) : '-'}</td>
        <td className={cellAmt}>{mv ? fmt(mv.samePeriodYtd) : '-'}</td>
        <td className={cn(cellPct, 'font-medium')}>
          {mv ? <ChangeText value={calcYtdYoy(mv)} /> : '-'}
        </td>
      </>
    )
  }
  return (
    <>
      <td className={cellAmt}>{mv ? fmt(mv.actual) : '-'}</td>
      <td className={cellAmt}>{mv ? fmt(mv.samePeriod) : '-'}</td>
      <td className={cn(cellPct, 'font-medium')}>{mv ? yoy(mv) : '-'}</td>
    </>
  )
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
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = expandedCodes.has(node.code)
  return (
    <td
      className="sticky z-[1] min-w-[160px] border-b border-r bg-background px-4 py-2 align-middle shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)] transition-colors group-hover:bg-muted"
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
  isOperating,
  expandedCodes,
  onToggle,
  onAnalyze,
  analyzeDisabled,
  analyzeHint,
}: {
  nodes: SubjectNode[]
  depth: number
  valueMap: Map<string, MetricValue>
  isOperating: boolean
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  onAnalyze?: (node: SubjectNode) => void
  analyzeDisabled?: boolean
  analyzeHint?: string
}) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0
        const isExpanded = expandedCodes.has(node.code)
        return (
          <Fragment key={node.code}>
            <tr className="group transition-colors hover:bg-muted/50">
              <SubjectCell
                node={node}
                indentDepth={depth}
                expandedCodes={expandedCodes}
                onToggle={onToggle}
                onAnalyze={onAnalyze}
                analyzeDisabled={analyzeDisabled}
                analyzeHint={analyzeHint}
              />
              {renderValueCells(valueMap.get(node.code), isOperating, node.valueType)}
            </tr>
            {hasChildren && isExpanded && (
              <MetricRows
                nodes={node.children}
                depth={depth + 1}
                valueMap={valueMap}
                isOperating={isOperating}
                expandedCodes={expandedCodes}
                onToggle={onToggle}
                onAnalyze={onAnalyze}
                analyzeDisabled={analyzeDisabled}
                analyzeHint={analyzeHint}
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
  isOperating,
  expandedCodes,
  onToggle,
  onAnalyze,
  analyzeDisabled,
  analyzeHint,
}: {
  level0Nodes: SubjectNode[]
  valueMap: Map<string, MetricValue>
  isOperating: boolean
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  onAnalyze?: (node: SubjectNode) => void
  analyzeDisabled?: boolean
  analyzeHint?: string
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
                className="group transition-colors hover:bg-muted/50"
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
                />
                {renderValueCells(valueMap.get(node.code), isOperating, node.valueType)}
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
 * 经营指标列：分类(可选) / 科目 / 预算金额 / 本月实际 / 同期实际 / 同比 / 达成率 / 本年累计 / 同期累计 / 累计同比。
 * 静态指标列：科目 / 本期金额 / 同期金额 / 变动率。
 * 数值列等宽居中；同比/累计同比/变动率红涨绿跌无箭头；达成率纯百分比无徽标（= 本年累计 / 全年预算）。
 */
export function MetricTree({
  nodes,
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
}: MetricTreeProps) {
  const isOperating = variant === 'operating'
  const colSpan = 1 + valueColCount(isOperating) + (categoryColumn ? 1 : 0)
  // sticky top-0 + z-[2]：容器内部滚动时表头固定在容器顶（高于表体 sticky 列的 z-[1]）；bg-muted 保证吸顶时不透明遮挡下方行
  const headBase = 'sticky top-0 z-[2] h-11 whitespace-nowrap border-b bg-muted px-3 text-[13px] align-middle font-medium text-black'
  return (
    <div
      className={cn('overflow-x-auto', stickyHeaderTop > 0 && 'overflow-y-auto')}
      style={
        stickyHeaderTop > 0
          ? { position: 'sticky', top: stickyHeaderTop, maxHeight: `calc(100dvh - ${stickyHeaderTop}px - 24px)` }
          : undefined
      }
    >
      {/* border-separate：sticky 单元格边框随滚动稳定跟随（collapse 模式下边框渲染异常） */}
      {/* minWidth 兜底：窄容器下表格保持完整列宽走横向滚动，列宽永不小于各列 min-w，杜绝浏览器压缩截断 */}
      <table
        className="w-full caption-bottom border-separate border-spacing-0 text-[13px]"
        style={{ minWidth: isOperating ? 1056 : 464 }}
      >
        <thead>
          <tr className="bg-muted">
            {categoryColumn && (
              <th
                className={cn(headBase, 'sticky left-0 z-[2] border-r bg-muted text-center shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)]')}
                style={{ width: CATEGORY_COL_WIDTH, minWidth: CATEGORY_COL_WIDTH, maxWidth: CATEGORY_COL_WIDTH }}
              >
                分类
              </th>
            )}
            <th
              className={cn(headBase, 'sticky z-[2] min-w-[160px] border-r bg-muted text-center shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)]')}
              style={{ left: categoryColumn ? CATEGORY_COL_WIDTH : 0 }}
            >
              科目
            </th>
            {isOperating ? (
              <>
                <th className={cn(headBase, 'min-w-[112px] text-center')}>预算金额</th>
                <th className={cn(headBase, 'min-w-[112px] text-center')}>本月实际</th>
                <th className={cn(headBase, 'min-w-[112px] text-center')}>同期实际</th>
                <th className={cn(headBase, 'min-w-[80px] text-center')}>同比</th>
                <th className={cn(headBase, 'min-w-[80px] text-center')}>达成率</th>
                <th className={cn(headBase, 'min-w-[112px] text-center')}>本年累计</th>
                <th className={cn(headBase, 'min-w-[112px] text-center')}>同期累计</th>
                <th className={cn(headBase, 'min-w-[80px] text-center')}>累计同比</th>
              </>
            ) : (
              <>
                <th className={cn(headBase, 'min-w-[112px] text-center')}>本期金额</th>
                <th className={cn(headBase, 'min-w-[112px] text-center')}>同期金额</th>
                <th className={cn(headBase, 'min-w-[80px] text-center')}>变动率</th>
              </>
            )}
          </tr>
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
              isOperating={isOperating}
              expandedCodes={expandedCodes}
              onToggle={onToggle}
              onAnalyze={onAnalyze}
              analyzeDisabled={analyzeDisabled}
              analyzeHint={analyzeHint}
            />
          ) : (
            <MetricRows
              nodes={nodes}
              depth={0}
              valueMap={valueMap}
              isOperating={isOperating}
              expandedCodes={expandedCodes}
              onToggle={onToggle}
              onAnalyze={onAnalyze}
              analyzeDisabled={analyzeDisabled}
              analyzeHint={analyzeHint}
            />
          )}
        </tbody>
      </table>
    </div>
  )
}
