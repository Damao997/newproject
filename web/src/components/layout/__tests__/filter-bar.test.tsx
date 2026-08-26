import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { FilterBar, FILTER_WIDTH } from '../filter-bar'

describe('FilterBar 筛选区容器', () => {
  it('默认换行布局：flex-wrap + gap-3 + items-center', () => {
    const { container } = render(<FilterBar><button>控件</button></FilterBar>)
    expect(container.firstChild).toHaveClass('flex', 'flex-wrap', 'items-center', 'gap-3')
  })

  it('nowrap 变体：密集单行布局（账龄筛选行 1）', () => {
    const { container } = render(<FilterBar nowrap><button>控件</button></FilterBar>)
    expect(container.firstChild).toHaveClass('flex-nowrap')
  })

  it('stickyTop 启用吸顶并携带偏移', () => {
    const { container } = render(<FilterBar stickyTop={56}><button>控件</button></FilterBar>)
    expect(container.firstChild).toHaveClass('sticky', 'z-10')
    expect((container.firstChild as HTMLElement).style.top).toBe('56px')
  })

  it('导出宽度语义常量（主体 180 / 期间 140）', () => {
    expect(FILTER_WIDTH.subject).toBe('w-[180px]')
    expect(FILTER_WIDTH.period).toBe('w-[140px]')
  })
})
