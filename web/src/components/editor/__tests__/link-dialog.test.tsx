import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LinkDialog } from '../link-dialog'

describe('LinkDialog 链接编辑对话框（替代原生 prompt）', () => {
  it('确定时回传输入的 URL', () => {
    const onConfirm = vi.fn()
    render(<LinkDialog open initialUrl="https://a.com" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: 'https://b.com' } })
    // antd Button 对两字中文标签自动插入空格（"确 定"），用弹性匹配
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }))
    expect(onConfirm).toHaveBeenCalledWith('https://b.com')
  })

  it('清空后确定回传空串（移除链接语义，与旧 prompt 行为一致）', () => {
    const onConfirm = vi.fn()
    render(<LinkDialog open initialUrl="https://a.com" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }))
    expect(onConfirm).toHaveBeenCalledWith('')
  })

  it('取消时不回传', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<LinkDialog open initialUrl="https://a.com" onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
