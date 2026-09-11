import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LineChart } from 'lucide-react'
import { NavLeafLink } from '../nav-item'
import type { NavItem } from '../../nav-items'

const item: NavItem = {
  path: '/indicators',
  label: '财务指标',
  icon: LineChart,
  resource: 'indicators:view',
  group: 'data',
  match: ['/indicators/operating', '/indicators/static'],
}

function renderLink(pathname: string, props: { collapsed?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <NavLeafLink item={item} {...props} />
    </MemoryRouter>
  )
}

describe('NavLeafLink（平铺菜单叶子项）', () => {
  it('精确命中自身 path：激活态（aria-current=page + 选中背景类）', () => {
    renderLink('/indicators')
    const link = screen.getByRole('link', { name: '财务指标' })
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(link.className).toContain('bg-sidebar-selected-bg')
  })

  it('命中 match 集合中的页内 Tab 路由：同样激活', () => {
    renderLink('/indicators/operating')
    expect(screen.getByRole('link', { name: '财务指标' })).toHaveAttribute('aria-current', 'page')
  })

  it('非激活：无 aria-current、使用常规字重', () => {
    renderLink('/reports')
    const link = screen.getByRole('link', { name: '财务指标' })
    expect(link).not.toHaveAttribute('aria-current')
    expect(link.className).toContain('font-normal')
  })

  it('边界前缀防误匹配：/indicators2 不激活', () => {
    renderLink('/indicators2')
    expect(screen.getByRole('link', { name: '财务指标' })).not.toHaveAttribute('aria-current')
  })

  it('折叠态：仅图标无文字（Tooltip 由交互触发）', () => {
    renderLink('/indicators', { collapsed: true })
    expect(screen.queryByText('财务指标')).not.toBeInTheDocument()
    expect(screen.getByRole('link')).toBeInTheDocument()
  })

  it('父级下发 activePath：唯一激活以最长路径命中为准（嵌套路径互斥）', () => {
    // /dashboard/analysis/key-metrics 同时命中「首页看板」(/dashboard) 与「经营分析」，父级应下发后者
    render(
      <MemoryRouter initialEntries={['/dashboard/analysis/key-metrics']}>
        <NavLeafLink item={{ ...item, path: '/dashboard', label: '首页看板' }} activePath="/dashboard/analysis/key-metrics" />
        <NavLeafLink
          item={{ ...item, path: '/dashboard/analysis/key-metrics', label: '经营分析' }}
          activePath="/dashboard/analysis/key-metrics"
        />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: '经营分析' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '首页看板' })).not.toHaveAttribute('aria-current')
  })
})
