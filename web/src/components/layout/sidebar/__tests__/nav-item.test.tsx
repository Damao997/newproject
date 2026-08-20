import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { LayoutDashboard } from 'lucide-react'
import { NavItemRow } from '../nav-item'
import type { NavItem } from '../../nav-items'

/** 渲染当前路由路径，用于断言点击后的跳转目标 */
function LocationProbe() {
  const { pathname } = useLocation()
  return <span data-testid="path">{pathname}</span>
}

const item: NavItem = {
  path: '/m',
  label: 'M 模块',
  icon: LayoutDashboard,
  resource: 'tools:view',
  children: [
    { path: '/m/a', label: 'A 子页' },
    { path: '/m/b', label: 'B 子页' },
  ],
}

describe('NavItemRow（一级目录项）', () => {
  it('点击一级项直接跳转首个二级子页（无需手动展开选择）', () => {
    render(
      <MemoryRouter initialEntries={['/other']}>
        <NavItemRow item={item} expanded={false} />
        <LocationProbe />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: /M 模块/ }))
    expect(screen.getByTestId('path').textContent).toBe('/m/a')
  })

  it('跳转同时触发 onNavigate（移动端关闭抽屉）', () => {
    const onNavigate = vi.fn()
    render(
      <MemoryRouter initialEntries={['/other']}>
        <NavItemRow item={item} expanded={false} onNavigate={onNavigate} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: /M 模块/ }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('expanded 时内联展开二级列表，子项可点击', () => {
    render(
      <MemoryRouter initialEntries={['/m/a']}>
        <NavItemRow item={item} expanded={true} />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: 'A 子页' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'B 子页' })).toBeInTheDocument()
  })

  it('children 为空时回退自身 path（防御）', () => {
    const leafish: NavItem = { ...item, children: [] }
    render(
      <MemoryRouter initialEntries={['/other']}>
        <NavItemRow item={leafish} expanded={false} />
        <LocationProbe />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: /M 模块/ }))
    expect(screen.getByTestId('path').textContent).toBe('/m')
  })
})
