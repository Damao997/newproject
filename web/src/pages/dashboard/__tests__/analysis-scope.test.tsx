import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AnalysisPage } from '../analysis'
import { usePeriodStore } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'
const mocks = vi.hoisted(() => ({ query: vi.fn(), data: { companyCode: 'C1', companyName: '甲公司', companyType: 'single', degraded: false } as { companyCode: string | null; companyName: string | null; companyType: string | null; degraded: boolean }, error: false, pending: false, placeholder: false }))
vi.mock('@/hooks/api-queries', () => ({
  useCompanies: () => ({ data: [{ code: 'C1', name: '甲公司', type: 'entity' }, { code: 'C2', name: '乙公司', type: 'entity' }, { code: 'S1', name: '省公司汇总', type: 'summary' }], isPending: false }),
  useAvailablePeriods: () => ({ data: { periods: ['2026-09'], fiscalStartMonth: 1 }, isPending: false }),
  useKeyMetrics: (params: unknown, options: unknown) => { mocks.query(params, options); return { data: mocks.data, isPending: mocks.pending, isError: mocks.error, isPlaceholderData: mocks.placeholder, refetch: vi.fn() } },
}))
vi.mock('../core-metrics-overview', () => ({ CoreMetricsOverview: ({ companyCode }: { companyCode?: string }) => <p>已查询主体：{companyCode}</p> }))
beforeEach(() => {
  cleanup(); usePeriodStore.setState({ period: '2026-09', fiscalYear: null, companyCodes: ['C1'] }); usePageStore.setState({ analysis: {} })
  mocks.data = { companyCode: 'C1', companyName: '甲公司', companyType: 'single', degraded: false }; mocks.error = false; mocks.pending = false; mocks.placeholder = false; mocks.query.mockClear()
})
const mount = () => render(<MemoryRouter initialEntries={['/dashboard/analysis/key-metrics']}><AnalysisPage variant="key-metrics" /></MemoryRouter>)
describe('经营分析主体范围', () => {
  it('多公司先选择主体，禁用查询，不静默取第一家', () => {
    usePeriodStore.setState({ companyCodes: ['C1', 'C2'] }); mount()
    expect(screen.getByText('选择本次分析主体')).toBeInTheDocument()
    expect(screen.queryByText(/已查询主体/)).not.toBeInTheDocument()
    expect(mocks.query).toHaveBeenCalledWith({ period: '2026-09', companyCode: undefined }, { enabled: false })
    expect(usePeriodStore.getState().companyCodes).toEqual(['C1', 'C2'])
  })
  it('默认及权限回退显示实际主体并用实际编码查询子页', () => {
    usePeriodStore.setState({ companyCodes: null }); mocks.data = { companyCode: 'S1', companyName: '省公司汇总', companyType: 'summary', degraded: true }; mount()
    expect(screen.getByText('省公司汇总')).toBeInTheDocument()
    expect(screen.getByText(/权限回退后生效/)).toBeInTheDocument()
    expect(screen.getByText('已查询主体：S1')).toBeInTheDocument()
  })
  it('切换主体不会把上一主体的占位响应应用到新页', () => {
    usePeriodStore.setState({ companyCodes: ['C2'] }); mocks.placeholder = true; mount()
    expect(screen.getByText('已查询主体：C2')).toBeInTheDocument()
    expect(screen.queryByText('已查询主体：C1')).not.toBeInTheDocument()
  })
  it('明确且有权限的主体不因一个指标接口失败而阻断其他分析内容', () => {
    mocks.error = true; mocks.data = { companyCode: null, companyName: null, companyType: null, degraded: false }; mount()
    expect(screen.getByText('已查询主体：C1')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('刷新失败')
  })
})
