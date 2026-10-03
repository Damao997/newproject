import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { PageContainer } from '../page-container'
import { HeaderTitleHost, PageTitleProvider } from '../page-heading'
import { SubPageTabs } from '../sub-page-tabs'

function Shell({ title }: { title?: string }) {
  return <PageTitleProvider><header data-testid="header"><HeaderTitleHost /></header><main data-testid="main">
    {title && <PageContainer title={title} headingMeta="金额：万元">内容</PageContainer>}
  </main></PageTitleProvider>
}

describe('顶栏标题与分类导航', () => {
  it('页面标题只出现于顶栏，更新和卸载后不留下旧标题，单位不进入标题文本', () => {
    const { rerender } = render(<Shell title="财务指标" />)
    expect(within(screen.getByTestId('header')).getByRole('heading', { level: 1 })).toHaveTextContent(/^财务指标$/)
    expect(within(screen.getByTestId('main')).queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByText('金额：万元')).toBeInTheDocument()
    rerender(<Shell title="经营分析" />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading')).toHaveTextContent('经营分析')
    rerender(<Shell />)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('分类方向键只移动焦点，选择链接才切换路由并同步当前分类', () => {
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = vi.fn()
    function Location() { return <output data-testid="path">{useLocation().pathname}</output> }
    try {
      render(<MemoryRouter initialEntries={['/a']}><SubPageTabs items={[{ path: '/a', label: '指标' }, { path: '/b', label: '库存' }]} /><Location /></MemoryRouter>)
      const first = screen.getByRole('link', { name: '指标' }), second = screen.getByRole('link', { name: '库存' })
      expect(first).toHaveAttribute('aria-current', 'page')
      first.focus()
      fireEvent.keyDown(first, { key: 'ArrowRight' })
      expect(second).toHaveFocus()
      expect(screen.getByTestId('path')).toHaveTextContent('/a')
      fireEvent.click(second)
      expect(second).toHaveAttribute('aria-current', 'page')
      expect(screen.getByTestId('path')).toHaveTextContent('/b')
    } finally { HTMLElement.prototype.scrollIntoView = original }
  })
})
