import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../dialog'
import { LinkDialog } from '@/components/editor/link-dialog'

describe('统一弹窗正文', () => {
  it('标题和操作按钮留在正文之外，并透传内容区域引用', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Dialog open>
        <DialogContent ref={ref}>
          <DialogHeader><DialogTitle>布局验证</DialogTitle></DialogHeader>
          <DialogBody><label>正文内容<input aria-label="正文输入" /></label></DialogBody>
          <DialogFooter><button>保存布局</button></DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    const body = screen.getByLabelText('正文输入').closest('[data-dialog-body]')
    expect(body).not.toContainElement(screen.getByRole('heading', { name: '布局验证' }))
    expect(body).not.toContainElement(screen.getByRole('button', { name: '保存布局' }))
    expect(ref.current).toContainElement(body as HTMLElement)
  })

  it('链接表单的固定底部按钮仍提交正文表单，并保留输入去空格行为', () => {
    const confirm = vi.fn()
    render(<LinkDialog open initialUrl="https://example.com" onConfirm={confirm} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: '  https://example.com/path  ' } })
    fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }))
    expect(confirm).toHaveBeenCalledWith('https://example.com/path')
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
