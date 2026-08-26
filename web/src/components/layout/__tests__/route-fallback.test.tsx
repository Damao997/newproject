import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouteFallback } from '../route-fallback'

describe('RouteFallback 路由级骨架', () => {
  it('渲染加载状态语义与页头占位条', () => {
    render(<RouteFallback />)
    expect(screen.getByRole('status', { name: '页面加载中' })).toBeInTheDocument()
    expect(document.querySelector('.skeleton.h-7')).toBeTruthy()
  })

  it('复用既有骨架块：4 个 KPI 卡 + 2 个列表面板', () => {
    const { container } = render(<RouteFallback />)
    // KpiGridSkeleton count=4 → 4 个骨架 Card（grid grid-cols-1 … xl:grid-cols-4）
    expect(container.querySelectorAll('div.grid.grid-cols-1').length).toBeGreaterThanOrEqual(1)
    // 页头 2 + KPI 卡 24 + 列表 26 = 52 个 skeleton 块，远超 10
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(10)
  })

  it('无"加载中"纯文本', () => {
    render(<RouteFallback />)
    expect(screen.queryByText(/加载中/)).not.toBeInTheDocument()
  })
})
