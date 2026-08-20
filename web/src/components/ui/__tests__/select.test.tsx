import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * 小屏响应式适配验证：jsdom 不应用 Tailwind CSS，以渲染类名断言
 * （与 collapsible.test.tsx 同思路）。
 */
describe('Select 小屏响应式', () => {
  it('SelectContent 渲染视口最大宽度约束类（窄屏面板不超视口）', () => {
    render(
      <Select>
        <SelectTrigger aria-label="选择主体"><SelectValue placeholder="选择主体" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="a">单体公司-测试集团有限公司</SelectItem>
        </SelectContent>
      </Select>,
    )
    fireEvent.click(screen.getByRole('combobox'))
    // 面板经 Portal 渲染，选项文本所在 ItemText 上溯找到带 max-w 类的 content 根
    const itemText = screen.getByText('单体公司-测试集团有限公司')
    const content = itemText.closest('[class*="max-w-[calc(100vw-2rem)]"]')
    expect(content).toBeTruthy()
  })

  it('SelectItem 选项单行截断类（长选项不换行）', () => {
    render(
      <Select>
        <SelectTrigger aria-label="选择主体"><SelectValue placeholder="选择主体" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="a">单体公司-测试集团有限公司</SelectItem>
        </SelectContent>
      </Select>,
    )
    fireEvent.click(screen.getByRole('combobox'))
    // Radix ItemText 不透传 className，截断类作用于外层 SelectItem
    const item = screen.getByText('单体公司-测试集团有限公司').parentElement
    expect(item).toHaveClass('whitespace-nowrap')
    expect(item).toHaveClass('[&>span]:min-w-0', '[&>span]:truncate')
  })
})
