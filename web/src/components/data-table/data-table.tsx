/* eslint-disable react/only-export-components -- compareRaw/类型导出供 pro-table-inner 与使用方复用，属模块能力而非组件 */
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TABLE_HEAD_BASE, TABLE_HEADER_STICKY, TABLE_STICKY_CELL_BASE } from './styles'

export type SortDirection = 'asc' | 'desc'

export interface DataTableColumn<T> {
  /** 列唯一键 */
  key: string
  /** 表头文本 */
  header: ReactNode
  /** 对齐方式，金额类列建议 right */
  align?: 'left' | 'center' | 'right'
  /** 单元格额外类名（如 font-mono、text-muted-foreground） */
  cellClassName?: string
  /** 表头额外类名 */
  headerClassName?: string
  /** 自定义单元格渲染，缺省时读取 row[key] */
  render?: (row: T, rowIndex: number) => ReactNode
  /** 冻结该列（横向滚动时固定于左侧，适用于宽表首列） */
  sticky?: boolean
  /** 表头可点击排序（受控模式传 onSortChange/sortKey；非受控时内部维护并本地排序） */
  sortable?: boolean
}

/** 表格密度：default（表头 h-11 / 单元格 p-4）、dense（h-8 / px-4 py-1.5）、compact（h-8 / px-3 py-2） */
export type TableDensity = 'default' | 'dense' | 'compact'

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  /** 行唯一键取值 */
  rowKey: (row: T, index: number) => string | number
  /** 表尾（如合计行），需自行渲染 <tr> */
  footer?: ReactNode
  /** 无数据时的提示文案 */
  emptyText?: string
  /** 兼容旧用法：dense=true 等价 density='dense'；与 density 同时传入时以 density 为准 */
  dense?: boolean
  /** 密度三档（对齐《统一表格设计标准》），缺省 default */
  density?: TableDensity
  /** 最大高度（如 '60vh'）：限高后内部垂直滚动，表头 sticky 固定 */
  maxHeight?: string
  /** 行点击回调（提供后行显示 pointer 光标，可配合 expandedKeys 实现展开） */
  onRowClick?: (row: T, rowIndex: number) => void
  /** 行额外类名（如选中行高亮），按行返回 */
  rowClassName?: (row: T, rowIndex: number) => string | undefined
  /** 展开行集合（以 rowKey 为准），命中时在该行下方渲染 renderExpanded 内容 */
  expandedKeys?: Set<string | number>
  /** 展开行内容渲染（跨整行 colSpan） */
  renderExpanded?: (row: T) => ReactNode
  /** 受控排序键（null 表示不排序；传 onSortChange 时建议同时传入，否则走非受控本地排序） */
  sortKey?: string | null
  /** 受控排序方向 */
  sortDirection?: SortDirection
  /** 排序变更回调（方向循环：升序 → 降序 → 取消，取消时 direction 为 null） */
  onSortChange?: (key: string, direction: SortDirection | null) => void
  /** 加载态：渲染骨架行而非数据行（对齐 skeleton-blocks 的 .skeleton shimmer） */
  loading?: boolean
  /** 骨架行数，默认 6 */
  loadingRows?: number
  /** 表格标题（屏幕阅读器专用，视觉隐藏） */
  caption?: string
  className?: string
}

const alignClass: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

/** 密度 → 表头/单元格内边距映射（对齐《统一表格设计标准》：default p-4、dense px-4 py-1.5、compact px-3 py-2） */
const densityClass: Record<TableDensity, { head: string; cell: string }> = {
  default: { head: 'h-11', cell: 'p-4' },
  dense: { head: 'h-8 leading-[14px]', cell: 'px-4 py-1.5 leading-[14px]' },
  compact: { head: 'h-8 leading-[14px]', cell: 'px-3 py-2 leading-[14px]' },
}

/** 原始值比较：数字直接差，其余 localeCompare（zh-CN）兜底（供 DataTable 与 ProTable 排序共用） */
export function compareRaw(a: unknown, b: unknown, direction: SortDirection = 'asc'): number {
  const factor = direction === 'asc' ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor
  return String(a ?? '').localeCompare(String(b ?? ''), 'zh-CN') * factor
}

/**
 * 通用受控数据表格。
 *
 * 纸质感样式对齐《前端开发规范》§3.3：白底、细边框、行 hover。
 * 列定义支持右对齐金额列（配合 `font-mono`）、自定义渲染（Badge/红涨绿跌）等。
 * 统一设计标准（v1.0）：密度三档、可排序表头（aria-sort）、加载骨架行、sticky 表头/冻结列。
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  footer,
  emptyText = '暂无数据',
  dense = false,
  density,
  maxHeight,
  onRowClick,
  rowClassName,
  expandedKeys,
  renderExpanded,
  sortKey,
  sortDirection,
  onSortChange,
  loading = false,
  loadingRows = 6,
  caption,
  className,
}: DataTableProps<T>) {
  // 密度解析：density 优先，兼容旧 dense 布尔
  const densityMode = density ?? (dense ? 'dense' : 'default')
  const pad = densityClass[densityMode]

  // 排序状态：受控（传 sortKey）由外部驱动；非受控内部维护并本地排序
  const [localSort, setLocalSort] = useState<{ key: string; direction: SortDirection } | null>(null)
  const isControlled = sortKey !== undefined
  const activeSort = useMemo(
    () =>
      isControlled
        ? sortKey
          ? { key: sortKey, direction: sortDirection ?? 'asc' }
          : null
        : localSort,
    [isControlled, sortKey, sortDirection, localSort],
  )

  const handleSort = (key: string) => {
    const next =
      activeSort?.key === key
        ? activeSort.direction === 'asc'
          ? { key, direction: 'desc' as const }
          : null
        : { key, direction: 'asc' as const }
    if (isControlled) onSortChange?.(key, next?.direction ?? null)
    else setLocalSort(next)
  }

  const sortedData = useMemo(() => {
    if (!activeSort) return data
    const { key, direction } = activeSort
    return [...data].sort((a, b) =>
      compareRaw((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], direction),
    )
  }, [data, activeSort])
  return (
    <div
      className={cn(maxHeight ? 'overflow-auto' : 'overflow-x-auto', className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full caption-bottom text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className={cn('[&_tr]:border-b', maxHeight && TABLE_HEADER_STICKY)}>
          <tr className="border-b bg-muted/50">
            {columns.map((col) => {
              const sortState = activeSort?.key === col.key ? activeSort : null
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    sortState ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={cn(
                    TABLE_HEAD_BASE,
                    pad.head,
                    // 限高 sticky 表头需不透明背景，避免滚动内容透出
                    maxHeight && 'bg-muted',
                    col.sticky && 'sticky left-0 z-10 bg-muted',
                    // 冻结列 × 冻结表头交叠处需更高层级
                    col.sticky && maxHeight && 'z-30',
                    col.headerClassName,
                  )}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      aria-label={`按${typeof col.header === 'string' ? col.header : col.key}排序`}
                    >
                      {col.header}
                      {sortState ? (
                        sortState.direction === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            // 骨架行：.skeleton shimmer 与 skeleton-blocks 一致，避免加载态布局抖动
            Array.from({ length: loadingRows }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="border-b">
                {columns.map((col) => (
                  <td key={col.key} className={cn(pad.cell, 'align-middle')}>
                    <div className="skeleton h-3.5 w-full rounded" />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                role="status"
                className="p-8 text-center text-muted-foreground"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            sortedData.map((row, rowIndex) => {
              const key = rowKey(row, rowIndex)
              const expanded = expandedKeys?.has(key) && renderExpanded
              return (
                <Fragment key={key}>
                  <tr
                    className={cn('group border-b transition-colors hover:bg-muted/50', onRowClick && 'cursor-pointer', rowClassName?.(row, rowIndex))}
                    onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          pad.cell,
                          'whitespace-nowrap align-middle',
                          alignClass[col.align ?? 'left'],
                          col.sticky && TABLE_STICKY_CELL_BASE,
                          col.cellClassName,
                        )}
                      >
                        {col.render
                          ? col.render(row, rowIndex)
                          : ((row as Record<string, unknown>)[col.key] as ReactNode)}
                      </td>
                    ))}
                  </tr>
                  {expanded && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={columns.length} className="px-4 py-2">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })
          )}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  )
}
