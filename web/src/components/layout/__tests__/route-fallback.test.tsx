import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouteFallback } from '../route-fallback'

describe('RouteFallback 路由级骨架', () => {
  it('渲染页头占位条与骨架卡片（替代纯文本加载中）', () => {
    render(<RouteFallback />)
    // 页头占位条
    expect(document.querySelector('.skeleton.h-7')).toBeTruthy()
    // 复用既有骨架块：KPI 网格 + 列表面板，skeleton 块数量充足
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(5)
    // 无"加载中"纯文本
    expect(screen.queryByText(/加载中/)).not.toBeInTheDocument()
  })
})
