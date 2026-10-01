import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { PageContainer } from '../page-container'

afterEach(() => vi.restoreAllMocks())

describe('列表页可用高度', () => {
  it('扣除实际起点和底部留白，缩放时重算且不会随页面滚动增长', () => {
    let viewportHeight = 600
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewportHeight)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.tagName === 'MAIN' ? 56 : 100 - (this.closest('main')?.scrollTop ?? 0)
      return { top, bottom: top + viewportHeight, height: viewportHeight, left: 0, right: 800, width: 800, x: 0, y: top, toJSON: () => ({}) }
    })
    render(
      <main>
        <div style={{ paddingBottom: 24 }}>
          <PageContainer viewportBound data-testid="panel" title="列表">表格区域</PageContainer>
        </div>
      </main>,
    )
    expect(screen.getByTestId('panel')).toHaveStyle({ height: '532px' })
    screen.getByTestId('panel').closest('main')!.scrollTop = 80
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByTestId('panel')).toHaveStyle({ height: '532px' })
    viewportHeight = 420
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByTestId('panel')).toHaveStyle({ height: '352px' })
  })

  it('未启用列表模式的长表单保持自然高度', () => {
    render(<PageContainer title="长表单" data-testid="form">表单内容</PageContainer>)
    expect(screen.getByTestId('form').style.height).toBe('')
  })
})
