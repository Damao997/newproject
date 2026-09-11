import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CoreMetricsContent } from '../core-metrics-content'
import type { KeyMetricsGroup, ProductMetricsRow, ProductMetricsResponse } from '@/types'

/**
 * 品类核心指标分析表渲染回归：
 * - 行 = 产品配置全行（含无数据行全列「—」），「其中：」前缀行缩进一级；
 * - 合计行取整体收入/毛利节点（非产品行求和），贡献占比分母 = 整体累计；
 * - 毛利率列 = 毛利 ÷ 收入（累计/同期口径）；渠道切换项禁用占位。
 */

const mocks = vi.hoisted(() => ({
  hook: vi.fn(),
  data: null as ProductMetricsResponse | null,
}))

vi.mock('@/hooks/api-queries', () => ({
  useProductMetrics: (params: { period?: string; companyCode?: string }) => {
    mocks.hook(params)
    return { data: mocks.data, isLoading: false, isError: false, refetch: vi.fn() }
  },
}))

function group(partial: Partial<KeyMetricsGroup> = {}): KeyMetricsGroup {
  return {
    monthBudget: null, monthActual: 0, monthSame: 0, monthChange: 0, monthYoy: 0,
    monthMomChange: 0, monthMom: 0, monthRate: null, annualBudget: null,
    ytdBudget: null, ytdActual: 0, ytdSame: 0, ytdChange: 0, ytdYoy: 0, annualRate: null,
    ...partial,
  }
}

beforeEach(() => {
  mocks.hook.mockClear()
  // 数值参照样图：房居收入 1571/7511、毛利 268/2344；整体收入 7066/26109、毛利 3130
  const fangju: ProductMetricsRow = {
    code: 'km_fangju',
    name: '房居产品销售及服务',
    income: group({ annualBudget: 7511, ytdBudget: 3129.58, monthActual: 415, ytdActual: 1571, ytdSame: 2534, ytdYoy: -0.38, annualRate: 20.91 }),
    profit: group({ annualBudget: 2344, ytdBudget: 976.67, monthActual: 52, ytdActual: 268, ytdSame: 382, ytdYoy: -0.2983, annualRate: 11.43 }),
  }
  const empty: ProductMetricsRow = { code: 'km_empty', name: '其中：技术服务', income: group(), profit: group() }
  const spaced: ProductMetricsRow = {
    code: 'km_space',
    name: '  宣传推广业务',
    income: group({ annualBudget: 1205, ytdActual: 120, monthActual: 26 }),
    profit: group(),
  }
  mocks.data = {
    period: '2026-08',
    dimension: 'product',
    companyCode: 'EN330059',
    companyName: '杭州分公司',
    companyType: 'single',
    degraded: false,
    rows: [fangju, empty, spaced],
    totals: {
      income: group({ annualBudget: 26109, ytdBudget: 10878.75, ytdActual: 7066, ytdSame: 7767 }),
      profit: group({ annualBudget: 9160, ytdBudget: 3816.67, ytdActual: 3130, ytdSame: 4277 }),
    },
  }
})

afterEach(() => {
  cleanup()
})

describe('CoreMetricsContent（品类核心指标分析）', () => {
  it('查询参数透传 period/companyCode', () => {
    render(<CoreMetricsContent period="2026-08" companyCode="EN330059" />)
    expect(mocks.hook).toHaveBeenCalledWith({ period: '2026-08', companyCode: 'EN330059' })
  })

  it('渲染产品行与合计行，合计取整体节点（贡献占比分母=整体累计）', () => {
    render(<CoreMetricsContent period="2026-08" />)
    expect(screen.getByText('品类核心指标分析')).toBeInTheDocument()
    expect(screen.getByText('房居产品销售及服务')).toBeInTheDocument()
    // 贡献占比 = 1571 ÷ 7066 = 22.2%（收入列）；毛利贡献 = 268 ÷ 3130 = 8.6%
    expect(screen.getByText('22.2%')).toBeInTheDocument()
    expect(screen.getByText('8.6%')).toBeInTheDocument()
    // 合计行贡献占比恒 100%（收入/毛利两列）
    expect(screen.getAllByText('100.0%')).toHaveLength(2)
    // 合计毛利率 = 3130 ÷ 7066 = 44.3%
    expect(screen.getByText('44.3%')).toBeInTheDocument()
    // 累计偏差额（时序口径）= 1571 − 3129.58 = −1,558.58（收入列）
    expect(screen.getByText('-1,558.58')).toBeInTheDocument()
  })

  it('「其中：」前缀行缩进一级（名称约定层级）', () => {
    const { container } = render(<CoreMetricsContent period="2026-08" />)
    const cell = screen.getByText('其中：技术服务').closest('td')
    expect(cell?.className).toContain('pl-8')
    expect(container).toBeTruthy()
  })

  it('名称前导空格子项缩进并剥离空格渲染（产品配置空格缩进约定）', () => {
    render(<CoreMetricsContent period="2026-08" />)
    // 前导空格被剥离，显示「宣传推广业务」并缩进
    const cell = screen.getByText('宣传推广业务').closest('td')
    expect(cell?.className).toContain('pl-8')
  })

  it('无数据产品行预算/比率列显示「—」', () => {
    render(<CoreMetricsContent period="2026-08" />)
    // 全 0 行：annualBudget=0 → BudgetCell「—」；annualRate=null → PercentCell「—」
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(4)
  })

  it('毛利率列 = 毛利 ÷ 收入（累计 268/1571=17.1%、同期 382/2534=15.1%）', () => {
    render(<CoreMetricsContent period="2026-08" />)
    expect(screen.getByText('17.1%')).toBeInTheDocument()
    expect(screen.getByText('15.1%')).toBeInTheDocument()
  })

  it('渠道切换项禁用占位（建设中），产品可用', () => {
    render(<CoreMetricsContent period="2026-08" />)
    const channel = screen.getByText('渠道').closest('button')
    expect(channel?.hasAttribute('disabled')).toBe(true)
    const product = screen.getByText('产品').closest('button')
    expect(product?.hasAttribute('disabled')).toBe(false)
  })
})
