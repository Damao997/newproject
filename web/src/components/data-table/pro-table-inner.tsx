import ProTable from '@ant-design/pro-table'
import type { ProColumns } from '@ant-design/pro-table'
import { ConfigProvider } from 'antd'
import type { TableProps } from 'antd'
import { THEME_HEX, THEME_PRESETS } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'
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

/** maxHeight（'320px'/'60vh'）→ 数字高度，供 ProTable scroll.y 使用；无法解析时返回 undefined */
function resolveScrollY(maxHeight?: string): number | undefined {
  if (!maxHeight) return undefined
  const px = /^(\d+(?:\.\d+)?)px$/.exec(maxHeight.trim())
  if (px) return Math.round(Number(px[1]))
  const vh = /^(\d+(?:\.\d+)?)vh$/.exec(maxHeight.trim())
  if (vh) return Math.round((window.innerHeight * Number(vh[1])) / 100)
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
  // 品牌主色跟随当前主题（antd token 只接受字面色值，取 THEME_PRESETS hex 镜像）
  const theme = useThemeStore((s) => s.theme)
  const brand = THEME_PRESETS[theme]

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
    fixed: col.sticky ? 'left' : undefined,
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

  return (
    <ConfigProvider
      theme={{
        // 对齐品牌主色与暖中性令牌：默认 antd 主色为蓝，会让排序/勾选/分页脱离品牌视觉
        token: {
          colorPrimary: brand.primary,
          colorInfo: brand.primary,
          colorLink: brand.primary,
          colorLinkHover: brand.primaryHover,
          colorSuccess: THEME_HEX.success,
          colorWarning: THEME_HEX.warning,
          colorError: THEME_HEX.destructive,
          colorText: THEME_HEX.foreground,
          colorTextSecondary: THEME_HEX.mutedForeground,
          colorBorder: THEME_HEX.border,
          colorBorderSecondary: THEME_HEX.borderSubtle,
          borderRadius: 8,
          fontSize: 13,
          fontFamily: "'Microsoft YaHei', '微软雅黑', system-ui, sans-serif",
        },
        components: {
          Table: {
            headerBg: THEME_HEX.muted,
            headerColor: THEME_HEX.foreground,
            rowHoverBg: THEME_HEX.accent,
            borderColor: THEME_HEX.border,
          },
        },
      }}
    >
      <ProTable<T>
        columns={proColumns}
        dataSource={data}
        rowKey={(row) => String(rowKey(row, 0))}
        search={false}
        options={false}
        toolBarRender={false}
        virtual
        scroll={{ y: resolveScrollY(maxHeight) ?? 480 }}
        pagination={false}
        size={tableSize}
        loading={loading}
        locale={emptyText ? { emptyText } : undefined}
        sortDirections={isControlled ? undefined : ['ascend', 'descend', null]}
        onChange={handleTableChange}
        onRow={onRowClick ? (record, index) => ({ onClick: () => onRowClick(record, index ?? 0) }) : undefined}
        rowClassName={rowClassName ? (record, index) => rowClassName(record, index) ?? '' : undefined}
      />
    </ConfigProvider>
  )
}
