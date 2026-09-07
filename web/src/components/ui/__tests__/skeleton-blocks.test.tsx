import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalysisPageSkeleton, KpiGridSkeleton, TableSkeleton } from '../skeleton-blocks'

describe('AnalysisPageSkeleton 分析子页骨架', () => {
  it('渲染加载语义 + 4 个 KPI 磁贴', () => {
    render(<AnalysisPageSkeleton blocks={[220, 240]} />)
    expect(screen.getByRole('status', { name: '内容加载中' })).toBeInTheDocument()
    // 磁贴网格：4 个 h-[108px] 磁贴块
    const tiles = document.querySelectorAll('.skeleton.h-\\[108px\\]')
    expect(tiles.length).toBe(4)
  })

  it('number 块渲染为单整块，[number, number] 块渲染为两列网格', () => {
    render(<AnalysisPageSkeleton blocks={[[280, 280], 240]} />)
    // 两列网格 1 组（lg:grid-cols-2），内含 2 块
    const twoColGrids = document.querySelectorAll('div.grid.grid-cols-1.gap-4.lg\\:grid-cols-2')
    expect(twoColGrids.length).toBe(1)
    expect(twoColGrids[0].querySelectorAll('.skeleton').length).toBe(2)
    // 单整块：h-240px（style 内联高度）
    const singles = Array.from(document.querySelectorAll('.skeleton.rounded-card')).filter(
      (el) => (el as HTMLElement).style.height === '240px',
    )
    expect(singles.length).toBe(1)
  })

  it('磁贴列数断点与各子页实际磁贴网格一致（sm:2 / lg:4）', () => {
    render(<AnalysisPageSkeleton blocks={[220, 240]} />)
    const tileGrid = document.querySelector('div.grid.grid-cols-1.gap-4.sm\\:grid-cols-2.lg\\:grid-cols-4')
    expect(tileGrid).toBeTruthy()
  })
})

describe('既有骨架块回归', () => {
  it('TableSkeleton 按行列数渲染骨架块', () => {
    render(<TableSkeleton rows={3} columns={4} />)
    // 表头 4 + 行 3×4 = 16 块
    const container = document.querySelector('.w-full.overflow-hidden')
    expect(container?.querySelectorAll('.skeleton').length).toBe(16)
  })

  it('KpiGridSkeleton 默认 4 卡', () => {
    render(<KpiGridSkeleton />)
    expect(document.querySelector('div.grid.grid-cols-1.gap-5.sm\\:grid-cols-2.xl\\:grid-cols-4')).toBeTruthy()
  })
})
