import { Fragment } from 'react'
import { ChevronRight, ChevronDown, MessageSquarePlus } from 'lucide-react'
import { cn, formatMoneyWan, formatPercent, getChangeColor } from '@/lib/utils'
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
  /** 传入后在行尾渲染「分析」操作列，点击回调该科目节点 */
  onAnalyze?: (node: SubjectNode) => void
  emptyText?: string
}

/** 涨跌彩色百分比（红涨绿跌、无箭头、等宽居中） */
function ChangeText({ value }: { value: number }) {
  return (
    <span className={cn('font-mono', getChangeColor(value))}>
      {(value * 100).toFixed(1)}%
    </span>
  )
}

/** 值列数（不含科目/分类列） */
function valueColCount(isOperating: boolean): number {
  return isOperating ? 8 : 3
}

/** 数值单元格：按 variant 输出各期间维度列，等宽居中、黑色文本；金额不带「万」单位 */
function renderValueCells(mv: MetricValue | undefined, isOperating: boolean) {
  const cell = 'px-4 py-2 align-middle text-center font-mono'
  if (isOperating) {
    return (
      <>
        <td className={cell}>{mv ? formatMoneyWan(mv.budget) : '-'}</td>
        <td className={cell}>{mv ? formatMoneyWan(mv.actual) : '-'}</td>
        <td className={cell}>{mv ? formatMoneyWan(mv.samePeriod) : '-'}</td>
        <td className={cn(cell, 'font-medium')}>{mv ? <ChangeText value={calcYoy(mv)} /> : '-'}</td>
        <td className={cell}>{mv ? formatPercent(calcAchievement(mv)) : '-'}</td>
        <td className={cell}>{mv ? formatMoneyWan(mv.ytd) : '-'}</td>
        <td className={cell}>{mv ? formatMoneyWan(mv.samePeriodYtd) : '-'}</td>
        <td className={cn(cell, 'font-medium')}>{mv ? <ChangeText value={calcYtdYoy(mv)} /> : '-'}</td>
      </>
    )
  }
  return (
    <>
      <td className={cell}>{mv ? formatMoneyWan(mv.actual) : '-'}</td>
      <td className={cell}>{mv ? formatMoneyWan(mv.samePeriod) : '-'}</td>
      <td className={cn(cell, 'font-medium')}>{mv ? <ChangeText value={calcYoy(mv)} /> : '-'}</td>
    </>
  )
}

/** 科目名称单元格：缩进 + 展开折叠箭头 + 名称 */
function SubjectCell({
  node,
  indentDepth,
  expandedCodes,
  onToggle,
}: {
  node: SubjectNode
  indentDepth: number
  expandedCodes: Set<string>
  onToggle: (code: string) => void
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = expandedCodes.has(node.code)
  return (
    <td className="px-4 py-2 align-middle">
      <div className="flex items-center" style={{ paddingLeft: indentDepth * 20 }}>
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
        <span className={cn(indentDepth === 0 && 'font-semibold', 'text-foreground')}>{node.name}</span>
      </div>
    </td>
  )
}

/** 分析操作单元格：点击触发单项分析抽屉 */
function AnalyzeCell({ node, onAnalyze }: { node: SubjectNode; onAnalyze?: (node: SubjectNode) => void }) {
  if (!onAnalyze) return null
  return (
    <td className="px-4 py-2 text-center align-middle">
      <button
        type="button"
        onClick={() => onAnalyze(node)}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] text-primary transition-colors hover:bg-primary/10"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" /> 分析
      </button>
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
}: {
  nodes: SubjectNode[]
  depth: number
  valueMap: Map<string, MetricValue>
  isOperating: boolean
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  onAnalyze?: (node: SubjectNode) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0
        const isExpanded = expandedCodes.has(node.code)
        return (
          <Fragment key={node.code}>
            <tr className="border-b transition-colors hover:bg-muted/50">
              <SubjectCell node={node} indentDepth={depth} expandedCodes={expandedCodes} onToggle={onToggle} />
              {renderValueCells(valueMap.get(node.code), isOperating)}
              <AnalyzeCell node={node} onAnalyze={onAnalyze} />
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

/** 分类列布局行（经营指标）：level0 抽为最左侧跨行「分类」列 */
function CategoryRows({
  level0Nodes,
  valueMap,
  isOperating,
  expandedCodes,
  onToggle,
  onAnalyze,
}: {
  level0Nodes: SubjectNode[]
  valueMap: Map<string, MetricValue>
  isOperating: boolean
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  onAnalyze?: (node: SubjectNode) => void
}) {
  return (
    <>
      {level0Nodes.map((cat) => {
        const rows = collectVisibleRows(cat.children, expandedCodes)
        if (rows.length === 0) return null
        return (
          <Fragment key={cat.code}>
            {rows.map((node, idx) => (
              <tr key={node.code} className="border-b transition-colors hover:bg-muted/50">
                {idx === 0 && (
                  <td
                    rowSpan={rows.length}
                    className="whitespace-nowrap border-r bg-background px-4 text-center align-middle font-semibold text-foreground"
                  >
                    {cat.name}
                  </td>
                )}
                {/* 科目列缩进：level1 → 0，level2 → 1 ... */}
                <SubjectCell
                  node={node}
                  indentDepth={node.level - 1}
                  expandedCodes={expandedCodes}
                  onToggle={onToggle}
                />
                {renderValueCells(valueMap.get(node.code), isOperating)}
                <AnalyzeCell node={node} onAnalyze={onAnalyze} />
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
 * 数值列等宽居中；同比/累计同比/变动率红涨绿跌无箭头；达成率纯百分比无徽标。
 */
export function MetricTree({
  nodes,
  valueMap,
  variant,
  expandedCodes,
  onToggle,
  categoryColumn = false,
  onAnalyze,
  emptyText = '暂无数据',
}: MetricTreeProps) {
  const isOperating = variant === 'operating'
  const colSpan = 1 + valueColCount(isOperating) + (categoryColumn ? 1 : 0) + (onAnalyze ? 1 : 0)
  const headBase = 'h-11 px-4 text-[13px] align-middle font-medium text-black'
  return (
    <div className="overflow-x-auto">
      <table className="w-full caption-bottom text-[13px]">
        <thead className="[&_tr]:border-b">
          <tr className="border-b bg-muted/50">
            {categoryColumn && <th className={cn(headBase, 'text-center')}>分类</th>}
            <th className={cn(headBase, 'text-center')}>科目</th>
            {isOperating ? (
              <>
                <th className={cn(headBase, 'text-center')}>预算金额</th>
                <th className={cn(headBase, 'text-center')}>本月实际</th>
                <th className={cn(headBase, 'text-center')}>同期实际</th>
                <th className={cn(headBase, 'text-center')}>同比</th>
                <th className={cn(headBase, 'text-center')}>达成率</th>
                <th className={cn(headBase, 'text-center')}>本年累计</th>
                <th className={cn(headBase, 'text-center')}>同期累计</th>
                <th className={cn(headBase, 'text-center')}>累计同比</th>
              </>
            ) : (
              <>
                <th className={cn(headBase, 'text-center')}>本期金额</th>
                <th className={cn(headBase, 'text-center')}>同期金额</th>
                <th className={cn(headBase, 'text-center')}>变动率</th>
              </>
            )}
            {onAnalyze && <th className={cn(headBase, 'text-center')}>操作</th>}
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
            />
          )}
        </tbody>
      </table>
    </div>
  )
}
