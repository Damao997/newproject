import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CompanyMultiSelect } from '@/components/filters/company-select'
import type { Company } from '@/types'

const mocks = vi.hoisted(() => ({
  companies: [] as Company[],
  displayNameMap: new Map<string, string>(),
}))

vi.mock('@/hooks/api-queries', () => ({
  useCompanies: () => ({ data: mocks.companies }),
}))
vi.mock('@/hooks/useCompanyDisplay', () => ({
  useCompanyDisplayName: () => ({ displayNameMap: mocks.displayNameMap }),
}))

const E1 = { code: 'C1', name: '甲公司', type: 'entity' } as Company
const E2 = { code: 'C2', name: '乙公司', type: 'entity' } as Company
const S1 = { code: 'S1', name: '汇总一号', type: 'summary' } as Company
const S2 = { code: 'S2', name: '汇总二号', type: 'summary' } as Company

beforeEach(() => {
  mocks.companies = [E1, E2, S1, S2]
  mocks.displayNameMap = new Map([
    ['C1', '甲公司'],
    ['C2', '乙公司'],
    ['S1', '汇总一号'],
    ['S2', '汇总二号'],
  ])
})

describe('CompanyMultiSelect（antd multiple 门面）', () => {
  it('空数组显示占位"全部公司"', () => {
    render(<CompanyMultiSelect value={[]} onChange={vi.fn()} />)
    expect(screen.getByText('全部公司')).toBeInTheDocument()
  })

  it('触发器 tag 仅显示名称（无前缀），多项时显示"等 N 家"', () => {
    const { rerender } = render(<CompanyMultiSelect value={['C1']} onChange={vi.fn()} />)
    expect(screen.getByText('甲公司')).toBeInTheDocument()
    expect(screen.queryByText('单体公司-甲公司')).not.toBeInTheDocument()

    rerender(<CompanyMultiSelect value={['C1', 'C2']} onChange={vi.fn()} />)
    expect(screen.getByText('甲公司')).toBeInTheDocument()
    expect(screen.getByText('等 2 家')).toBeInTheDocument()
  })

  it('打开下拉显示前缀式选项与全选/清空操作行', async () => {
    render(<CompanyMultiSelect value={[]} onChange={vi.fn()} />)
    fireEvent.mouseDown(screen.getByText('全部公司'))
    expect(await screen.findByText('单体公司-甲公司')).toBeInTheDocument()
    expect(screen.getByText('单体公司-乙公司')).toBeInTheDocument()
    expect(screen.getByText('汇总主体-汇总一号')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全选' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清空（全部公司）' })).toBeInTheDocument()
  })

  it('勾选选项回调 onChange（追加公司编码）', async () => {
    const onChange = vi.fn()
    const { container } = render(<CompanyMultiSelect value={['C1']} onChange={onChange} />)
    fireEvent.mouseDown(container.querySelector('.ant-select-selector')!)
    fireEvent.click(await screen.findByText('单体公司-乙公司'))
    expect(onChange).toHaveBeenCalledWith(['C1', 'C2'])
  })

  it('取消勾选选项回调 onChange（移除公司编码）', async () => {
    const onChange = vi.fn()
    const { container } = render(<CompanyMultiSelect value={['C1', 'C2']} onChange={onChange} />)
    fireEvent.mouseDown(container.querySelector('.ant-select-selector')!)
    fireEvent.click(await screen.findByText('单体公司-乙公司'))
    expect(onChange).toHaveBeenCalledWith(['C1'])
  })

  it('全选默认圈定全部公司（单体+汇总）', async () => {
    const onChange = vi.fn()
    render(<CompanyMultiSelect value={[]} onChange={onChange} />)
    fireEvent.mouseDown(screen.getByText('全部公司'))
    fireEvent.click(await screen.findByRole('button', { name: '全选' }))
    expect(onChange).toHaveBeenCalledWith(['C1', 'C2', 'S1', 'S2'])
  })

  it('selectAllType="entity" 时全选仅圈定单体公司', async () => {
    const onChange = vi.fn()
    render(<CompanyMultiSelect value={[]} onChange={onChange} selectAllType="entity" />)
    fireEvent.mouseDown(screen.getByText('全部公司'))
    fireEvent.click(await screen.findByRole('button', { name: '全选' }))
    expect(onChange).toHaveBeenCalledWith(['C1', 'C2'])
  })

  it('清空操作行回调空数组', async () => {
    const onChange = vi.fn()
    const { container } = render(<CompanyMultiSelect value={['C1']} onChange={onChange} />)
    fireEvent.mouseDown(container.querySelector('.ant-select-selector')!)
    fireEvent.click(await screen.findByRole('button', { name: '清空（全部公司）' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('entitiesOnly 时仅显示单体公司选项', async () => {
    render(<CompanyMultiSelect value={[]} onChange={vi.fn()} entitiesOnly />)
    fireEvent.mouseDown(screen.getByText('全部公司'))
    expect(await screen.findByText('单体公司-甲公司')).toBeInTheDocument()
    expect(screen.queryByText('汇总主体-汇总一号')).not.toBeInTheDocument()
  })

  it('组件层允许多选汇总主体（汇总单选限制由上层负责）', async () => {
    const onChange = vi.fn()
    const { container } = render(<CompanyMultiSelect value={['S1']} onChange={onChange} />)
    fireEvent.mouseDown(container.querySelector('.ant-select-selector')!)
    fireEvent.click(await screen.findByText('汇总主体-汇总二号'))
    expect(onChange).toHaveBeenCalledWith(['S1', 'S2'])
  })
})
