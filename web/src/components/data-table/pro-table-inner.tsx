import ProTable from '@ant-design/pro-table'
import type { ProColumns } from '@ant-design/pro-table'
import type { DataTableColumn } from './data-table'

interface ProTableInnerProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  rowKey: (row: T, index: number) => string | number
}

/**
 * ProTable 内部实现（懒加载目标）。
 *
 * 仅在大数据量（> 100 行）时被 pro-data-table.tsx 通过 React.lazy 加载，
 * 开启虚拟滚动以对齐《前端开发规范》§5、§7.1 的大数据渲染要求。
 */
export default function ProTableInner<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
}: ProTableInnerProps<T>) {
  const proColumns: ProColumns<T>[] = columns.map((col) => ({
    title: col.header,
    dataIndex: col.key,
    align: col.align ?? 'left',
    render: col.render
      ? (_dom, entity, index) => col.render!(entity, index)
      : undefined,
  }))

  return (
    <ProTable<T>
      columns={proColumns}
      dataSource={data}
      rowKey={(row) => String(rowKey(row, 0))}
      search={false}
      options={false}
      toolBarRender={false}
      virtual
      scroll={{ y: 480 }}
      pagination={false}
    />
  )
}
