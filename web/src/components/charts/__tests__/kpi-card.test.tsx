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
  ytdYoy: 0.25,
  monthMom: -0.0214,
  monthMomReason: null,
  ytdRate: 58.3,
  trend: [100, 110, 120],
}

const noBudgetKpi: KpiData = {
  title: '回款',
  monthActual: 500,
  monthRate: null,
  ytdActual: 3000,
  yoy: 0,
  ytdYoy: 0,
  monthMom: null,
  monthMomReason: 'zero-base',
  ytdRate: null,
  trend: [],
}

describe('KpiCard', () => {
  it('大字体区：本月合计千分位两位小数 + 月度达成率百分比', () => {
    render(<KpiCard data={revenueKpi} />)
    expect(screen.getByText('1,234,567.89')).toBeInTheDocument()
    expect(screen.getByText('96.50%')).toBeInTheDocument()
  })

  it('小字体区：累计实际与累计达成率', () => {
    render(<KpiCard data={revenueKpi} />)
    expect(screen.getByText('财年累计')).toBeInTheDocument()
    expect(screen.getByText('9,876,543.21')).toBeInTheDocument()
    expect(screen.getByText('年度预算完成率')).toBeInTheDocument()
    expect(screen.getByText('58.30%')).toBeInTheDocument()
  })

  it('达成率红绿灯三档：≥75 绿 / 60-75 黄 / <60 红', () => {
    render(<KpiCard data={{ ...revenueKpi, monthRate: 96.5, ytdRate: 58.3 }} />)
    expect(screen.getByText('96.50%').className).toContain('text-success-strong')
    expect(screen.getByText('58.30%').className).toContain('text-destructive')
    render(<KpiCard data={{ ...revenueKpi, title: '毛利', monthRate: 68 }} />)
    expect(screen.getByText('68.00%').className).toContain('text-warning-strong')
  })

  it('无预算与无环比基数显示破折号，不混同于零', () => {
    render(<KpiCard data={noBudgetKpi} />)
    const dashes = screen.getAllByText('—')
    expect(dashes).toHaveLength(3)
    expect(screen.getByRole('button', { name: '月度环比：上月金额为 0，无法计算环比' })).toBeInTheDocument()
  })

  it('同比上涨：红涨徽标（finance.red token），方向由箭头表达、无 + 前缀', () => {
    render(<KpiCard data={revenueKpi} />)
    const badge = screen.getByText('12.30%')
    expect(badge.parentElement?.className).toContain('text-finance-red')
    expect(screen.queryByText('+12.30%')).not.toBeInTheDocument()
    expect(badge.nextElementSibling).toHaveClass('lucide-arrow-up')
  })

  it('同比下跌：绿跌徽标（finance.green token，无 + 前缀）', () => {
    render(<KpiCard data={{ ...revenueKpi, yoy: -0.056 }} />)
    const badge = screen.getByText('5.60%')
    expect(badge.parentElement?.className).toContain('text-finance-green')
    expect(badge.nextElementSibling).toHaveClass('lucide-arrow-down')
    expect(screen.queryByText('-5.60%')).not.toBeInTheDocument()
  })

  it('同比持平显示 0.00% 和尾部横线', () => {
    render(<KpiCard data={noBudgetKpi} />)
    const badge = screen.getByText('0.00%')
    expect(badge.parentElement?.className).toContain('text-muted-foreground')
    expect(badge.nextElementSibling).toHaveClass('lucide-minus')
  })

  it('传入 onClick 时卡片可点击并触发钻取回调', () => {
    const onClick = vi.fn()
    render(<KpiCard data={revenueKpi} onClick={onClick} />)
    fireEvent.click(screen.getByText('1,234,567.89'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
  it('指标排序改变后仍保留各自的配色身份', () => {
    const { container, rerender } = render(<KpiCard data={noBudgetKpi} index={0} />)
    expect(container.querySelector('[data-metric-tone]')).toHaveAttribute('data-metric-tone', '4')
    rerender(<KpiCard data={revenueKpi} index={3} />)
    expect(container.querySelector('[data-metric-tone]')).toHaveAttribute('data-metric-tone', '1')
  })

  it('键盘钻取一次，内部焦点控件不触发卡片快捷键', () => {
    const onClick = vi.fn()
    render(<KpiCard data={revenueKpi} onClick={onClick} />)
    fireEvent.keyDown(screen.getByRole('link'), { key: 'Enter' })
    expect(onClick).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByText('1,234,567.89'), { key: 'Enter' })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('月度环比保留两位小数，下降使用尾部竖直箭头', () => {
    render(<KpiCard data={revenueKpi} />)
    expect(screen.getByText('月度环比')).toBeInTheDocument()
    const value = screen.getByText('2.14%')
    expect(value.nextElementSibling).toHaveClass('lucide-arrow-down')
    expect(value.parentElement).toHaveClass('text-finance-green')
    expect(screen.getByTestId('sparkline')).toBeInTheDocument()
  })

  it('累计模式突出累计金额与累计同比，保留月度摘要且不渲染趋势', () => {
    const { container } = render(<KpiCard data={revenueKpi} mode="ytd" />)
    expect(container.querySelector('.ant-statistic-content')).toHaveTextContent('9,876,543.21')
    expect(screen.getByText('25.00%')).toBeInTheDocument()
    expect(screen.getByText('累计同比')).toBeInTheDocument()
    expect(screen.getByText('年度预算完成')).toBeInTheDocument()
    expect(screen.getByText('月度预算达成率')).toBeInTheDocument()
    expect(screen.getByText('1,234,567.89')).toBeInTheDocument()
    expect(screen.queryByText('月度环比')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument()
  })

  it('切换模式不改变指标身份，回到月度恢复迷你趋势', () => {
    const { container, rerender } = render(<KpiCard data={revenueKpi} mode="ytd" />)
    rerender(<KpiCard data={revenueKpi} mode="month" />)
    expect(container.querySelector('[data-kpi-mode]')).toHaveAttribute('data-kpi-mode', 'month')
    expect(container.querySelector('[data-metric-tone]')).toHaveAttribute('data-metric-tone', '1')
    expect(screen.getByTestId('sparkline')).toBeInTheDocument()
  })

  it('有效环比基数下持平显示 0.00%，不显示缺失提示', () => {
    render(<KpiCard data={{ ...revenueKpi, monthMom: 0 }} />)
    expect(screen.getByText('0.00%').nextElementSibling).toHaveClass('lucide-minus')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([
    ['zero-base', '上月金额为 0，无法计算环比'],
    ['no-data', '上月无数据，无法计算环比'],
  ] as const)('环比原因 %s 可点击查看且不触发钻取', async (reason, text) => {
    const onClick = vi.fn()
    render(<KpiCard data={{ ...revenueKpi, monthMom: null, monthMomReason: reason }} onClick={onClick} />)
    const help = screen.getByRole('button', { name: `月度环比：${text}` })
    fireEvent.keyDown(help, { key: 'Enter' })
    fireEvent.click(help)
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(onClick).not.toHaveBeenCalled()
  })
})
