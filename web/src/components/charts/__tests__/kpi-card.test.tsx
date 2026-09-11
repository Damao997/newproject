import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KpiCard } from '../kpi-card'
import type { KpiData } from '@/types'

// ECharts 迷你图在 jsdom 下无法渲染，替换为空占位
vi.mock('../kpi-sparkline', () => ({
  KpiSparkline: () => <div data-testid="sparkline" />,
}))

const revenueKpi: KpiData = {
  title: '收入',
  monthActual: 1234567.89,
  monthRate: 96.5,
  ytdActual: 9876543.21,
  yoy: 0.123,
  ytdRate: 58.3,
  trend: [100, 110, 120],
}

const noBudgetKpi: KpiData = {
  title: '回款',
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

  it('达成率红绿灯三档：≥75 绿 / 60-75 黄 / <60 红', () => {
    render(<KpiCard data={{ ...revenueKpi, monthRate: 96.5, ytdRate: 58.3 }} />)
    expect(screen.getByText('96.5%').className).toContain('text-success-strong')
    expect(screen.getByText('58.3%').className).toContain('text-destructive')
    render(<KpiCard data={{ ...revenueKpi, title: '毛利', monthRate: 68 }} />)
    expect(screen.getByText('68.0%').className).toContain('text-warning-strong')
  })

  it('无预算（rate=null）时达成率显示灰色 "–"', () => {
    render(<KpiCard data={noBudgetKpi} />)
    const dashes = screen.getAllByText('–')
    expect(dashes).toHaveLength(2)
    for (const d of dashes) expect(d.className).toContain('text-muted-foreground')
  })

  it('同比上涨：红涨徽标（finance.red token），方向由箭头表达、无 + 前缀', () => {
    render(<KpiCard data={revenueKpi} />)
    const badge = screen.getByText('12.3%')
    expect(badge.parentElement?.className).toContain('text-finance-red')
    expect(screen.queryByText('+12.3%')).not.toBeInTheDocument()
  })

  it('同比下跌：绿跌徽标（finance.green token，无 + 前缀）', () => {
    render(<KpiCard data={{ ...revenueKpi, yoy: -0.056 }} />)
    const badge = screen.getByText('5.6%')
    expect(badge.parentElement?.className).toContain('text-finance-green')
  })

  it('同比持平：muted 徽标显示 -（零值统一占位）', () => {
    render(<KpiCard data={noBudgetKpi} />)
    const badge = screen.getByText('-')
    expect(badge.parentElement?.className).toContain('text-muted-foreground')
  })

  it('传入 onClick 时卡片可点击并触发钻取回调', () => {
    const onClick = vi.fn()
    render(<KpiCard data={revenueKpi} onClick={onClick} />)
    fireEvent.click(screen.getByText('1,234,567.89'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
