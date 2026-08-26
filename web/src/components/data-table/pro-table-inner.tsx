import { useEffect, useState } from 'react'
import ProTable from '@ant-design/pro-table'
import type { ProColumns } from '@ant-design/pro-table'
import type { TableProps } from 'antd'
import {
  compareRaw,
  type DataTableColumn,
  type SortDirection,
  type TableDensity,
} from './data-table'

interface ProTableInnerProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  rowKey: (row: T, index: number) => string | number
  emptyText?: string
  dense?: boolean
  density?: TableDensity
  maxHeight?: string
  onRowClick?: (row: T, rowIndex: number) => void
  rowClassName?: (row: T, rowIndex: number) => string | undefined
  sortKey?: string | null
  sortDirection?: SortDirection
  onSortChange?: (key: string, direction: SortDirection | null) => void
  loading?: boolean
}

/** maxHeight（'320px'/'60vh'/'calc(100dvh - 120px - 24px)'）→ 数字高度，供 ProTable scroll.y 使用；无法解析时返回 undefined */
function resolveScrollY(maxHeight: string, viewportH: number): number | undefined {
  const px = /^(\d+(?:\.\d+)?)px$/.exec(maxHeight.trim())
  if (px) return Math.round(Number(px[1]))
  const vh = /^(\d+(?:\.\d+)?)vh$/.exec(maxHeight.trim())
  if (vh) return Math.round((viewportH * Number(vh[1])) / 100)
  // calc(100dvh - Npx - Mpx)：吸顶页面传入的限高表达式（视口高 - 吸顶偏移 - 底部留白），支持 1~2 个减项
  const calc = /^calc\(100dvh(?: - (\d+(?:\.\d+)?)px){1,2}\)$/.exec(maxHeight.trim())
  if (calc) {
    const total = calc.slice(1).reduce<number>((sum, n) => sum + (n ? Number(n) : 0), 0)
    return Math.max(120, Math.round(viewportH - total))
  }
  return undefined
}

/**
 * ProTable 内部实现（懒加载目标）。
 *
 * 仅在大数据量（> 100 行）时被 pro-data-table.tsx 通过 React.lazy 加载，
 * 开启虚拟滚动以对齐《前端开发规范》§5、§7.1 的大数据渲染要求。
 * DataTableColumn 能力完整映射：sticky → fixed、cellClassName → className、
 * headerClassName → onHeaderCell、density → size、maxHeight → scroll.y、
 * sortable → sorter（三态循环对齐 DataTable）、onRowClick/rowClassName/loading 透传。
 */
export default function ProTableInner<T extends Record<string, unknown>>({
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
}: ProTableInnerProps<T>) {
  // 视口高度：vh/calc 类 maxHeight 依赖视口尺寸，随窗口 resize 重算（px 直传分支不受影响）
  const [viewportH, setViewportH] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 密度解析：density 优先，兼容旧 dense 布尔；default 用 antd 默认 middle，紧凑两档用 small
  const densityMode = density ?? (dense ? 'dense' : 'default')
  const tableSize = densityMode === 'default' ? undefined : 'small'

  // 受控排序：传 sortKey 时由外部驱动（列级 sortOrder）；非受控时 antd 内部管理（三态循环）
  const isControlled = sortKey !== undefined
  const activeSort = isControlled && sortKey
    ? { key: sortKey, direction: sortDirection ?? 'asc' }
    : null

  const proColumns: ProColumns<T>[] = columns.map((col) => ({
    title: col.header,
    dataIndex: col.key,
    align: col.align ?? 'left',
    fixed: col.sticky === 'right' ? 'right' : col.sticky ? 'left' : undefined,
    className: col.cellClassName,
    onHeaderCell: col.headerClassName ? () => ({ className: col.headerClassName }) : undefined,
    sortOrder: isControlled
      ? activeSort?.key === col.key
        ? activeSort.direction === 'asc'
          ? 'ascend'
          : 'descend'
        : null
      : undefined,
    sorter: col.sortable
      ? (a, b) => compareRaw((a as Record<string, unknown>)[col.key], (b as Record<string, unknown>)[col.key])
      : undefined,
    render: col.render
      ? (_dom, entity, index) => col.render!(entity, index)
      : undefined,
  }))

  // 排序变更（受控）：antd order 三态 ascend/descend/undefined → 统一 asc/desc/null
  const handleTableChange: TableProps<T>['onChange'] = (_pagination, _filters, sorter) => {
    if (!onSortChange) return
    const s = Array.isArray(sorter) ? sorter[0] : sorter
    if (!s) return
    onSortChange(
      String(s.field ?? ''),
      s.order === 'ascend' ? 'asc' : s.order === 'descend' ? 'desc' : null,
    )
  }

  const scrollY = maxHeight ? resolveScrollY(maxHeight, viewportH) : undefined

  return (
    // 浅灰圆角容器（与 DataTable 一致的视觉分割）：内层白底 + overflow-hidden 裁剪 antd 表格直角为圆角
    // 主题：由 App 根部 AntdProvider 统一提供（同配方上提，含 Table 组件级 token）
    <div className="overflow-hidden rounded-card bg-muted/40 p-2">
      <div className="overflow-hidden rounded-sm bg-background">
        <ProTable<T>
          columns={proColumns}
          dataSource={data}
          rowKey={(row) => String(rowKey(row, 0))}
          search={false}
          options={false}
          toolBarRender={false}
          virtual
          scroll={{ y: scrollY ?? 480 }}
          pagination={false}
          size={tableSize}
          loading={loading}
          locale={emptyText ? { emptyText } : undefined}
          sortDirections={isControlled ? undefined : ['ascend', 'descend', null]}
          onChange={handleTableChange}
          onRow={onRowClick ? (record, index) => ({ onClick: () => onRowClick(record, index ?? 0) }) : undefined}
          rowClassName={rowClassName ? (record, index) => rowClassName(record, index) ?? '' : undefined}
        />
      </div>
    </div>
  )
}
