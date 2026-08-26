import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Inbox } from 'lucide-react'
import { EmptyState } from '../empty-state'

describe('EmptyState 统一空态', () => {
  it('渲染图标 + 标题 + 描述', () => {
    render(<EmptyState icon={Inbox} title="暂无数据" description="请调整筛选条件" />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
    expect(screen.getByText('请调整筛选条件')).toBeInTheDocument()
  })

  it('描述可选：不传时仅标题', () => {
    render(<EmptyState icon={Inbox} title="暂无数据" />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })

  it('compact 模式：小图标小间距（表格内空态）', () => {
    const { container } = render(<EmptyState icon={Inbox} title="暂无数据" compact />)
    expect(container.querySelector('.h-8.w-8')).toBeTruthy()
  })

  it('action 区渲染（按钮/链接）', () => {
    render(<EmptyState icon={Inbox} title="暂无数据" action={<button>去导入</button>} />)
    expect(screen.getByRole('button', { name: '去导入' })).toBeInTheDocument()
  })
})
