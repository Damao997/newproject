import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Select 门面（antd Select）行为验证：
 * - 占位文案（Radix 空串语义 '' → antd undefined）
 * - mouseDown 打开下拉（antd 触发时机）后渲染选项并选择回调
 * - 分组选项（SelectGroup + SelectLabel）与禁用项
 */
describe('Select 门面（antd）', () => {
  it('未选值时显示占位文案（空串语义）', () => {
    render(
      <Select value="" onValueChange={vi.fn()}>
        <SelectTrigger aria-label="选择主体">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">选项A</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(screen.getByText('请选择')).toBeInTheDocument()
  })

  it('打开下拉选择后回调 onValueChange（携带选项值）', async () => {
    const onValueChange = vi.fn()
    render(
      <Select value="" onValueChange={onValueChange}>
        <SelectTrigger aria-label="选择主体">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">选项A</SelectItem>
          <SelectItem value="b">选项B</SelectItem>
        </SelectContent>
      </Select>,
    )
    // antd Select 以 mouseDown 开合下拉
    fireEvent.mouseDown(screen.getByText('请选择'))
    fireEvent.click(await screen.findByText('选项A'))
    expect(onValueChange).toHaveBeenCalledWith('a')
  })

  it('选中值直接回显选项文案', () => {
    render(
      <Select value="b" onValueChange={vi.fn()}>
        <SelectTrigger>
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">选项A</SelectItem>
          <SelectItem value="b">选项B</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(screen.getByText('选项B')).toBeInTheDocument()
  })

  it('分组选项渲染（SelectGroup + SelectLabel）', async () => {
    render(
      <Select value="" onValueChange={vi.fn()}>
        <SelectTrigger>
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>公司</SelectLabel>
            <SelectItem value="c1">甲公司</SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>汇总主体</SelectLabel>
            <SelectItem value="s1">汇总一号</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value="all">全部</SelectItem>
        </SelectContent>
      </Select>,
    )
    fireEvent.mouseDown(screen.getByText('请选择'))
    expect(await screen.findByText('公司')).toBeInTheDocument()
    expect(await screen.findByText('甲公司')).toBeInTheDocument()
    expect(screen.getByText('汇总主体')).toBeInTheDocument()
    expect(screen.getByText('汇总一号')).toBeInTheDocument()
    expect(screen.getByText('全部')).toBeInTheDocument()
  })
})
