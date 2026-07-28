import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Collapsible } from '@/components/ui/collapsible'

describe('Collapsible', () => {
  it('默认展开并渲染内容', () => {
    render(
      <Collapsible trigger={() => <span>标题</span>}>
        <p>正文内容</p>
      </Collapsible>,
    )
    expect(screen.getByText('正文内容')).toBeVisible()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })

  it('defaultOpen=false 时初始收起', () => {
    render(
      <Collapsible defaultOpen={false} trigger={() => <span>标题</span>}>
        <p>正文内容</p>
      </Collapsible>,
    )
    expect(screen.getByText('正文内容')).not.toBeVisible()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('点击触发器切换展开/收起，trigger 收到最新状态', () => {
    render(
      <Collapsible trigger={(open) => <span>{open ? '收起' : '展开'}</span>}>
        <p>正文内容</p>
      </Collapsible>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('正文内容')).not.toBeVisible()
    expect(screen.getByText('展开')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('正文内容')).toBeVisible()
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
    expect(screen.getByText('正文内容')).not.toBeVisible()
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
})
