import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'

interface Row {
  id: number
  name: string
  amount: number
}

const columns: DataTableColumn<Row>[] = [
  { key: 'name', header: '名称' },
  { key: 'amount', header: '金额', align: 'right', cellClassName: 'font-mono' },
]

const rows: Row[] = [
  { id: 1, name: '杭州', amount: 100 },
  { id: 2, name: '宁波', amount: 200 },
]

describe('DataTable', () => {
  it('渲染表头与数据行', () => {
    render(<DataTable columns={columns} data={rows} rowKey={(r) => r.id} />)
    expect(screen.getByText('名称')).toBeInTheDocument()
    expect(screen.getByText('杭州')).toBeInTheDocument()
    expect(screen.getByText('宁波')).toBeInTheDocument()
  })

  it('无数据时展示空文案', () => {
    render(<DataTable columns={columns} data={[]} rowKey={(r) => r.id} emptyText="没有数据" />)
    expect(screen.getByText('没有数据')).toBeInTheDocument()
  })

  it('使用自定义 render 渲染单元格', () => {
    const cols: DataTableColumn<Row>[] = [
      { key: 'name', header: '名称', render: (r) => <span>城市-{r.name}</span> },
    ]
    render(<DataTable columns={cols} data={rows} rowKey={(r) => r.id} />)
    expect(screen.getByText('城市-杭州')).toBeInTheDocument()
  })
})

describe('Pagination', () => {
  it('展示条数范围并响应翻页', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} pageSize={10} total={35} onPageChange={onPageChange} />)
    expect(screen.getByText('共 35 条，第 1-10 条')).toBeInTheDocument()
    fireEvent.click(screen.getByText('下一页'))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('首页时上一页禁用', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} pageSize={10} total={35} onPageChange={onPageChange} />)
    const prev = screen.getByText('上一页') as HTMLButtonElement
    expect(prev.disabled).toBe(true)
  })
})
