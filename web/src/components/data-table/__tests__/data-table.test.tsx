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

  it('表头单元格带 scope="col" 无障碍属性', () => {
    const { container } = render(<DataTable columns={columns} data={rows} rowKey={(r) => r.id} />)
    const ths = container.querySelectorAll('th')
    expect(ths.length).toBe(2)
    ths.forEach((th) => expect(th.getAttribute('scope')).toBe('col'))
  })

  it('空态单元格带 role="status"', () => {
    const { container } = render(<DataTable columns={columns} data={[]} rowKey={(r) => r.id} />)
    const empty = container.querySelector('td[role="status"]')
    expect(empty).not.toBeNull()
  })

  it('dense 布尔向后兼容：单元格使用 px-4 py-1.5 紧凑密度', () => {
    const { container } = render(<DataTable columns={columns} data={rows} rowKey={(r) => r.id} dense />)
    const cell = container.querySelector('tbody td')
    expect(cell?.className).toContain('px-4 py-1.5')
  })

  it('density="compact" 使用 px-3 py-2 微紧凑密度，且优先于 dense 布尔', () => {
    const { container } = render(<DataTable columns={columns} data={rows} rowKey={(r) => r.id} dense density="compact" />)
    const cell = container.querySelector('tbody td')
    expect(cell?.className).toContain('px-3 py-2')
    expect(cell?.className).not.toContain('px-4 py-1.5')
  })

  it('排序受控：点击表头回调方向循环 升序 → 降序 → 取消', () => {
    const onSortChange = vi.fn()
    const { rerender } = render(
      <DataTable
        columns={[{ key: 'amount', header: '金额', sortable: true }]}
        data={rows}
        rowKey={(r) => r.id}
        sortKey={null}
        onSortChange={onSortChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '按金额排序' }))
    expect(onSortChange).toHaveBeenLastCalledWith('amount', 'asc')

    rerender(
      <DataTable
        columns={[{ key: 'amount', header: '金额', sortable: true }]}
        data={rows}
        rowKey={(r) => r.id}
        sortKey="amount"
        sortDirection="asc"
        onSortChange={onSortChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '按金额排序' }))
    expect(onSortChange).toHaveBeenLastCalledWith('amount', 'desc')

    rerender(
      <DataTable
        columns={[{ key: 'amount', header: '金额', sortable: true }]}
        data={rows}
        rowKey={(r) => r.id}
        sortKey="amount"
        sortDirection="desc"
        onSortChange={onSortChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '按金额排序' }))
    expect(onSortChange).toHaveBeenLastCalledWith('amount', null)
  })

  it('排序受控：aria-sort 跟随当前排序方向', () => {
    const { rerender } = render(
      <DataTable
        columns={[{ key: 'amount', header: '金额', sortable: true }]}
        data={rows}
        rowKey={(r) => r.id}
        sortKey="amount"
        sortDirection="asc"
        onSortChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('columnheader', { name: /金额/ }).getAttribute('aria-sort')).toBe('ascending')
    rerender(
      <DataTable
        columns={[{ key: 'amount', header: '金额', sortable: true }]}
        data={rows}
        rowKey={(r) => r.id}
        sortKey="amount"
        sortDirection="desc"
        onSortChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('columnheader', { name: /金额/ }).getAttribute('aria-sort')).toBe('descending')
  })

  it('排序非受控：点击后本地排序数据行', () => {
    render(
      <DataTable
        columns={[{ key: 'amount', header: '金额', sortable: true }]}
        data={rows}
        rowKey={(r) => r.id}
      />,
    )
    const cells = () => screen.getAllByRole('cell').map((c) => c.textContent)
    expect(cells()).toEqual(['100', '200'])
    fireEvent.click(screen.getByRole('button', { name: '按金额排序' }))
    expect(cells()).toEqual(['100', '200'])
    fireEvent.click(screen.getByRole('button', { name: '按金额排序' }))
    expect(cells()).toEqual(['200', '100'])
  })

  it('loading 渲染骨架行且不渲染数据行', () => {
    const { container } = render(<DataTable columns={columns} data={rows} rowKey={(r) => r.id} loading loadingRows={3} />)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    expect(screen.queryByText('杭州')).toBeNull()
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

  it('传 onPageSizeChange 才渲染每页条数下拉', () => {
    const onPageChange = vi.fn()
    const { rerender } = render(<Pagination page={1} pageSize={20} total={100} onPageChange={onPageChange} />)
    expect(screen.queryByLabelText('每页条数')).toBeNull()
    rerender(
      <Pagination page={1} pageSize={20} total={100} onPageChange={onPageChange} onPageSizeChange={vi.fn()} />,
    )
    expect(screen.getByLabelText('每页条数')).toBeInTheDocument()
  })

  it('跳转框：合法页码跳转、越界 clamp、非数字忽略', () => {
    const onPageChange = vi.fn()
    render(<Pagination page={1} pageSize={10} total={35} onPageChange={onPageChange} />)
    const input = screen.getByLabelText('跳转页码')

    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.click(screen.getByText('跳转'))
    expect(onPageChange).toHaveBeenLastCalledWith(3)

    // 总页数为 4，输入 999 应 clamp 到 4
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPageChange).toHaveBeenLastCalledWith(4)

    onPageChange.mockClear()
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.click(screen.getByText('跳转'))
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('总页数为 1 时不渲染跳转框', () => {
    render(<Pagination page={1} pageSize={20} total={10} onPageChange={vi.fn()} />)
    expect(screen.queryByLabelText('跳转页码')).toBeNull()
  })

  it('summary 覆盖默认统计文案', () => {
    render(<Pagination page={1} pageSize={20} total={7} onPageChange={vi.fn()} summary="共 7 份报告" />)
    expect(screen.getByText('共 7 份报告')).toBeInTheDocument()
  })
})
