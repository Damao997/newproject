import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KpiCard } from '../kpi-card'
import type { KpiData } from '@/types'

// ECharts 迷你图在 jsdom 下无法渲染，替换为空占位
vi.mock('../kpi-sparkline', () => ({
  KpiSparkline: () => <div data-testid="sparkline" />,
}))

const revenueKpi: KpiData = {
  title: '收入',
  icon: 'TrendingUp',
  monthActual: 1234567.89,
  monthRate: 96.5,
  ytdActual: 9876543.21,
  yoy: 0.123,
  ytdRate: 58.3,
  trend: [100, 110, 120],
}

const noBudgetKpi: KpiData = {
  title: '回款',
  icon: 'Banknote',
  monthActual: 500,
  monthRate: null,
  ytdActual: 3000,
  yoy: 0,
  ytdRate: null,
  trend: [],
}

describe('KpiCard', () => {
  it('大字体区：本月合计千分位两位小数 + 月度达成率百分比', () => {
    render(<KpiCard data={revenueKpi} />)
    expect(screen.getByText('1,234,567.89')).toBeInTheDocument()
    expect(screen.getByText('96.5%')).toBeInTheDocument()
  })

  it('小字体区：累计实际与累计达成率', () => {
    render(<KpiCard data={revenueKpi} />)
    expect(screen.getByText('累计实际')).toBeInTheDocument()
    expect(screen.getByText('9,876,543.21')).toBeInTheDocument()
    expect(screen.getByText('累计达成率')).toBeInTheDocument()
    expect(screen.getByText('58.3%')).toBeInTheDocument()
  })

  it('无预算（rate=null）时达成率显示 "–"', () => {
    render(<KpiCard data={noBudgetKpi} />)
    expect(screen.getAllByText('–')).toHaveLength(2)
  })

  it('同比上涨：红涨徽标带 + 前缀', () => {
    render(<KpiCard data={revenueKpi} />)
    const badge = screen.getByText('+12.3%')
    expect(badge.parentElement?.className).toContain('text-[#FF3B30]')
  })

  it('同比下跌：绿跌徽标（无 + 前缀）', () => {
    render(<KpiCard data={{ ...revenueKpi, yoy: -0.056 }} />)
    const badge = screen.getByText('5.6%')
    expect(badge.parentElement?.className).toContain('text-[#34C759]')
  })

  it('同比持平：灰色徽标显示 0.0%', () => {
    render(<KpiCard data={noBudgetKpi} />)
    const badge = screen.getByText('0.0%')
    expect(badge.parentElement?.className).toContain('text-[#64748B]')
  })
})
