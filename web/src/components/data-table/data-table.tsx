import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

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
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  /** 行唯一键取值 */
  rowKey: (row: T, index: number) => string | number
  /** 表尾（如合计行），需自行渲染 <tr> */
  footer?: ReactNode
  /** 无数据时的提示文案 */
  emptyText?: string
  className?: string
}

const alignClass: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

/**
 * 通用受控数据表格。
 *
 * 纸质感样式对齐《前端开发规范》§3.3：白底、细边框、行 hover。
 * 列定义支持右对齐金额列（配合 `font-mono`）、自定义渲染（Badge/红涨绿跌）等。
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  footer,
  emptyText = '暂无数据',
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full caption-bottom text-[13px]">
        <thead className="[&_tr]:border-b">
          <tr className="border-b bg-muted/50">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'h-11 px-4 text-[13px] text-center align-middle font-medium text-black',
                  col.sticky && 'sticky left-0 z-10 bg-muted',
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="p-8 text-center text-muted-foreground"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => (
              <tr
                key={rowKey(row, rowIndex)}
                className="group border-b transition-colors hover:bg-muted/50"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'p-4 align-middle',
                      alignClass[col.align ?? 'left'],
                      col.sticky && 'sticky left-0 z-[1] border-r bg-background group-hover:bg-muted/50',
                      col.cellClassName,
                    )}
                  >
                    {col.render
                      ? col.render(row, rowIndex)
                      : ((row as Record<string, unknown>)[col.key] as ReactNode)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  )
}
