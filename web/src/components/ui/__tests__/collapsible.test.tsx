import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Collapsible } from '@/components/ui/collapsible'

/** 内容区外层 grid 面板（jsdom 不应用 Tailwind CSS，可见性以类名断言） */
function panelOf(text: string): HTMLElement {
  const content = screen.getByText(text)
  const panel = content.closest('.grid')
  if (!panel) throw new Error('panel not found')
  return panel as HTMLElement
}

describe('Collapsible', () => {
  it('默认展开并渲染内容', () => {
    render(
      <Collapsible trigger={() => <span>标题</span>}>
        <p>正文内容</p>
      </Collapsible>,
    )
    expect(panelOf('正文内容')).toHaveClass('grid-rows-[1fr]')
    expect(panelOf('正文内容')).not.toHaveClass('invisible')
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })

  it('defaultOpen=false 时初始收起', () => {
    render(
      <Collapsible defaultOpen={false} trigger={() => <span>标题</span>}>
        <p>正文内容</p>
      </Collapsible>,
    )
    expect(panelOf('正文内容')).toHaveClass('grid-rows-[0fr]')
    expect(panelOf('正文内容')).toHaveClass('invisible')
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('点击触发器切换展开/收起，trigger 收到最新状态', () => {
    render(
      <Collapsible trigger={(open) => <span>{open ? '收起' : '展开'}</span>}>
        <p>正文内容</p>
      </Collapsible>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(panelOf('正文内容')).toHaveClass('invisible')
    expect(screen.getByText('展开')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(panelOf('正文内容')).not.toHaveClass('invisible')
    expect(screen.getByText('收起')).toBeInTheDocument()
  })

  it('受控模式：open prop 生效且点击回调 onOpenChange', () => {
    const onOpenChange = vi.fn()
    function Controlled() {
      const [open, setOpen] = useState(true)
      return (
        <Collapsible
          open={open}
          onOpenChange={(o) => {
            onOpenChange(o)
            setOpen(o)
          }}
          trigger={() => <span>标题</span>}
        >
          <p>正文内容</p>
        </Collapsible>
      )
    }
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(panelOf('正文内容')).toHaveClass('invisible')
  })

  it('aria-controls 指向内容区 id', () => {
    render(
      <Collapsible trigger={() => <span>标题</span>}>
        <p>正文内容</p>
      </Collapsible>,
    )
    const btn = screen.getByRole('button')
    const panelId = btn.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId as string)).toContainElement(screen.getByText('正文内容'))
  })

  it('不传 trigger 时不渲染触发按钮，仅渲染内容区（外部受控）', () => {
    render(
      <Collapsible open onOpenChange={() => {}}>
        <p>正文内容</p>
      </Collapsible>,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('正文内容')).toBeInTheDocument()
  })
})
