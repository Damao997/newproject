import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RateBar } from '@/components/ui/rate-bar'

describe('RateBar', () => {
  it('default 变体：0-100 语义，文字在条内（现状行为，dashboard 传 96.5 等百分比数值）', () => {
    render(<RateBar rate={82.3} />)
    expect(screen.getByText('82.3%')).toBeInTheDocument()
  })

  it('default 变体：无预算显示 – 与空条', () => {
    const { container } = render(<RateBar rate={null} />)
    expect(screen.getByText('–')).toBeInTheDocument()
    expect(container.querySelector('.bg-chart-1')).toBeNull()
  })

  it('default 变体：超过 100% 填充截断，文字显示实际值', () => {
    const { container } = render(<RateBar rate={150} />)
    expect(screen.getByText('150.0%')).toBeInTheDocument()
    const fill = container.querySelector('.bg-chart-1') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('above 变体：0-1 语义（与 calcAchievement 对接），百分比文字在条内居中', () => {
    render(<RateBar rate={0.823} variant="above" />)
    expect(screen.getByText('82.3%')).toBeInTheDocument()
  })

  it('above 变体：无预算显示 – 与空条', () => {
    const { container } = render(<RateBar rate={null} variant="above" />)
    expect(screen.getByText('–')).toBeInTheDocument()
    expect(container.querySelector('.bg-chart-1')).toBeNull()
  })

  it('above 变体：超过 100% 填充截断，文字显示实际值', () => {
    const { container } = render(<RateBar rate={1.102} variant="above" />)
    expect(screen.getByText('110.2%')).toBeInTheDocument()
    const fill = container.querySelector('.bg-chart-1') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })
})
