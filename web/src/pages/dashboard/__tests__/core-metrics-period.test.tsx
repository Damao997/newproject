import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { AnalysisContext } from '@/components/analysis/analysis-context'
import { defaultAnalysisState } from '@/stores/pageStateStore'
import type { KeyMetricsGroup, KeyMetricsResponse } from '@/types'

const { state } = vi.hoisted(() => ({ state: { data: null as KeyMetricsResponse | null } }))

vi.mock('@/hooks/api-queries', () => ({
  useKeyMetrics: () => ({ data: state.data, isLoading: false, isError: false, isPlaceholderData: false, refetch: vi.fn() }),
}))

import { CoreMetricsOverview } from '../core-metrics-overview'

/** 完整默认组：周期 2026-09，月/累计的金额、基数、同比都可单独覆盖 */
function group(over: Partial<KeyMetricsGroup> = {}): KeyMetricsGroup {
  return {
    monthBudget: 1220,
    monthActual: 1134.6,
    monthSame: 1037.28,
    monthChange: 97.32,
    monthYoy: 0.094,
    monthMomChange: 97.32,
    monthMom: 0.057,
    monthRate: 93,
    annualBudget: 14640,
    ytdBudget: 10980,
    ytdActual: 10248,
    ytdSame: 9150,
    ytdChange: 1098,
    ytdYoy: 0.12,
    annualRate: 70,
    ...over,
  }
}

function response(g: KeyMetricsGroup, valueType: 'amount' | 'ratio' = 'amount'): KeyMetricsResponse {
  return {
    period: '2026-09',
    companyCode: null,
    companyName: null,
    companyType: null,
    degraded: false,
    rows: [
      { key: 'income', label: '营业收入', category: '收入', valueType, products: [], values: g },
      { key: 'expense', label: '运营费用', category: '费用', valueType, products: [], values: g },
    ],
  } as unknown as KeyMetricsResponse
}

/** 聚焦视图只显示指标卡，报表视图只显示完整报表（与页面模式一致） */
function renderOverview(data: KeyMetricsResponse, view: 'focus' | 'report' = 'focus') {
  state.data = data
  return render(
    <AnalysisContext.Provider value={{ state: { ...defaultAnalysisState, view }, companyType: 'single', update: vi.fn() }}>
      <CoreMetricsOverview period="2026-09" />
    </AnalysisContext.Provider>,
  )
}

/** 取指标磁贴（label 所在 .stat-tile 容器；报表/差距分析中同名文本不计入） */
function tileOf(label: string): HTMLElement {
  const tile = screen.getAllByText(label)
    .map((node) => node.closest('.stat-tile'))
    .find((node): node is HTMLElement => node instanceof HTMLElement)
  if (!tile) throw new Error(`未找到指标磁贴：${label}`)
  return tile
}

describe('核心指标总览期间与比较基准（DX-01）', () => {
  beforeEach(() => { state.data = null; cleanup() })

  it('本月同比与累计同比分别展示，主金额标为财年累计', () => {
    renderOverview(response(group()))

    // 主金额：财年累计 10248.00 万（营业收入/运营费用两张磁贴）
    expect(screen.getAllByText('财年累计')).toHaveLength(2)
    const income = tileOf('营业收入')
    expect(within(income).getByText('10,248.00')).toBeInTheDocument()
    expect(within(income).getByText('万')).toBeInTheDocument()

    // 月度组只出现月度同比 9.4%，累计组只出现累计同比 12.0%
    expect(within(income).getByText(/本月达成 1,134\.60 万/)).toBeInTheDocument()
    expect(within(income).getByText(/月度同比/)).toBeInTheDocument()
    expect(within(income).getByText('+9.4%')).toBeInTheDocument()
    expect(within(income).getByText('累计同比')).toBeInTheDocument()
    expect(within(income).getByText('+12.0%')).toBeInTheDocument()
    // 上月金额行文本中不得出现累计同比数值
    expect(within(income).getByText(/本月达成/).textContent).not.toContain('12.0')
  })

  it('完整报表表头使用月度同比与累计同比，不再使用含混的财年同比', () => {
    renderOverview(response(group()), 'report')
    const table = screen.getByRole('table', { name: /关键指标完整报表/ })
    expect(within(table).getByText('月度同比')).toBeInTheDocument()
    expect(within(table).getByText('累计同比')).toBeInTheDocument()
    expect(within(table).queryByText('财年同比')).toBeNull()
  })

  it('零值：金额按既有约定显示占位符，同比为 0.0%，期间与单位仍可辨识', () => {
    renderOverview(response(group({ monthActual: 0, ytdActual: 0, monthYoy: 0, ytdYoy: 0 })))
    const income = tileOf('营业收入')
    expect(within(income).getByText('-')).toBeInTheDocument()
    expect(within(income).getByText('万')).toBeInTheDocument()
    expect(within(income).getAllByText('0.0%')).toHaveLength(2)
    expect(within(income).getByText('财年累计')).toBeInTheDocument()
  })

  it('负值：金额与同比保留负号', () => {
    renderOverview(response(group({ monthActual: -520.5, ytdActual: -3210.25, monthYoy: -0.083, ytdYoy: -0.125 })))
    const income = tileOf('营业收入')
    expect(within(income).getByText('-3,210.25')).toBeInTheDocument()
    expect(within(income).getByText(/-520\.50 万/)).toBeInTheDocument()
    expect(within(income).getByText('-8.3%')).toBeInTheDocument()
    expect(within(income).getByText('-12.5%')).toBeInTheDocument()
  })

  it('缺基数：同期基数为 0 时不伪装成 0.0% 持平', () => {
    renderOverview(response(group({ monthSame: 0, ytdSame: 0, monthYoy: 0, ytdYoy: 0 })))
    const income = tileOf('营业收入')
    expect(within(income).getAllByText('无基数')).toHaveLength(2)
    expect(within(income).queryByText('0.0%')).toBeNull()
    cleanup()
    renderOverview(response(group({ monthSame: 0, ytdSame: 0, monthYoy: 0, ytdYoy: 0 })), 'report')
    const table = screen.getByRole('table', { name: /关键指标完整报表/ })
    expect(within(table).getAllByText('无基数').length).toBeGreaterThanOrEqual(2)
  })

  it('空预算：预算与完成率显示占位符，不参与比较', () => {
    renderOverview(response(group({ monthBudget: null, annualBudget: null, ytdBudget: null, monthRate: null, annualRate: null })), 'report')
    const table = screen.getByRole('table', { name: /关键指标完整报表/ })
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(6)
  })

  it('旧数据缺同比字段：有同期基数但缺同比值时显示占位符而非 0.0%', () => {
    const legacy = group() as Partial<KeyMetricsGroup>
    delete legacy.monthYoy
    delete legacy.ytdYoy
    renderOverview(response(legacy as KeyMetricsGroup))
    const income = tileOf('营业收入')
    expect(within(income).getAllByText('—')).toHaveLength(2)
    expect(within(income).queryByText('0.0%')).toBeNull()
    expect(within(income).queryByText('无基数')).toBeNull()
  })

  it('比率行沿用百分比口径并标注财年累计', () => {
    renderOverview(response(group({ ytdActual: 0.1234, ytdYoy: 0.12 }), 'ratio'))
    const expense = tileOf('运营费用')
    expect(within(expense).getByText('12.3%')).toBeInTheDocument()
    expect(within(expense).queryByText('万')).toBeNull()
  })
})
