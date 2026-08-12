import { lazy, Suspense, useRef } from 'react'
import {
  DataTable,
  type DataTableColumn,
  type SortDirection,
  type TableDensity,
} from './data-table'

const ProTableInner = lazy(() => import('./pro-table-inner'))

/** 启用虚拟滚动的行数阈值（进入），对齐《前端开发规范》§7.1 */
const VIRTUAL_ENABLE_THRESHOLD = 100
/** 退出虚拟滚动的行数阈值：低于该值才退出，形成迟滞区避免阈值附近反复切换实现导致 remount 抖动 */
const VIRTUAL_DISABLE_THRESHOLD = 80

interface ProDataTableProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  rowKey: (row: T, index: number) => string | number
  emptyText?: string
  /** 兼容旧用法：dense=true 等价 density='dense'；与 density 同时传入时以 density 为准 */
  dense?: boolean
  /** 密度三档（对齐《统一表格设计标准》），缺省 default */
  density?: TableDensity
  /** 最大高度（如 '60vh'）：限高后内部垂直滚动；大数据模式映射为 ProTable scroll.y */
  maxHeight?: string
  /** 行点击回调（大数据模式映射为 antd onRow） */
  onRowClick?: (row: T, rowIndex: number) => void
  /** 行额外类名（如选中行高亮），按行返回 */
  rowClassName?: (row: T, rowIndex: number) => string | undefined
  /** 受控排序键（null 表示不排序；传 onSortChange 时建议同时传入，否则走内部排序） */
  sortKey?: string | null
  /** 受控排序方向 */
  sortDirection?: SortDirection
  /** 排序变更回调（方向循环：升序 → 降序 → 取消，取消时 direction 为 null） */
  onSortChange?: (key: string, direction: SortDirection | null) => void
  /** 加载态（大数据模式映射为 ProTable loading） */
  loading?: boolean
  /** 骨架行数（仅轻量 DataTable 模式生效） */
  loadingRows?: number
  className?: string
}

/**
 * 自适应表格封装。
 *
 * 当行数 ≤ 100 时使用轻量 DataTable；超过阈值时通过 React.lazy 懒加载
 * ProTable 并启用虚拟滚动，避免大数据量一次性渲染导致卡顿。
 * 大数据模式能力与 DataTable 对齐（冻结列/density/maxHeight/行点击/行类名/排序/loading），
 * 避免阈值切换后交互断档（《统一表格设计标准》§3）。
 */
export function ProDataTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  emptyText,
  dense,
  density,
  maxHeight,
  onRowClick,
  rowClassName,
  sortKey,
  sortDirection,
  onSortChange,
  loading,
  loadingRows,
  className,
}: ProDataTableProps<T>) {
  // 迟滞判定：进入虚拟模式后需降到较低阈值才退出，避免行数在阈值附近抖动时反复 remount
  const virtualRef = useRef(false)
  if (!virtualRef.current && data.length > VIRTUAL_ENABLE_THRESHOLD) virtualRef.current = true
  else if (virtualRef.current && data.length < VIRTUAL_DISABLE_THRESHOLD) virtualRef.current = false

  if (!virtualRef.current) {
    return (
      <DataTable
        columns={columns}
        data={data}
        rowKey={rowKey}
        emptyText={emptyText}
        dense={dense}
        density={density}
        maxHeight={maxHeight}
        onRowClick={onRowClick}
        rowClassName={rowClassName}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={onSortChange}
        loading={loading}
        loadingRows={loadingRows}
        className={className}
      />
    )
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-[480px] items-center justify-center p-8 text-center text-sm text-muted-foreground">
          表格加载中…
        </div>
      }
    >
      <ProTableInner
        columns={columns as DataTableColumn<Record<string, unknown>>[]}
        data={data as Record<string, unknown>[]}
        rowKey={rowKey as (row: Record<string, unknown>, index: number) => string | number}
        emptyText={emptyText}
        dense={dense}
        density={density}
        maxHeight={maxHeight}
        onRowClick={onRowClick as ((row: Record<string, unknown>, index: number) => void) | undefined}
        rowClassName={rowClassName as ((row: Record<string, unknown>, index: number) => string | undefined) | undefined}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={onSortChange}
        loading={loading}
      />
    </Suspense>
  )
}
