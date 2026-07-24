import { lazy, Suspense, useRef } from 'react'
import { DataTable, type DataTableColumn } from './data-table'

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
  className?: string
}

/**
 * 自适应表格封装。
 *
 * 当行数 ≤ 100 时使用轻量 DataTable；超过阈值时通过 React.lazy 懒加载
 * ProTable 并启用虚拟滚动，避免大数据量一次性渲染导致卡顿。
 */
export function ProDataTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  emptyText,
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
      />
    </Suspense>
  )
}
