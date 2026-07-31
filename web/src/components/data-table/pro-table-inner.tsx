import ProTable from '@ant-design/pro-table'
import type { ProColumns } from '@ant-design/pro-table'
import { ConfigProvider } from 'antd'
import { THEME_HEX } from '@/lib/chart-theme'
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
    <ConfigProvider
      theme={{
        // 对齐品牌橙与暖中性令牌：默认 antd 主色为蓝，会让排序/勾选/分页脱离品牌视觉
        token: {
          colorPrimary: THEME_HEX.primary,
          colorInfo: THEME_HEX.primary,
          colorLink: THEME_HEX.primary,
          colorLinkHover: THEME_HEX.primaryHover,
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
        scroll={{ y: 480 }}
        pagination={false}
      />
    </ConfigProvider>
  )
}
