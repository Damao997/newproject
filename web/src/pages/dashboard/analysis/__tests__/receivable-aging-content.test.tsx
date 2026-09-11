import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ReceivableAgingContent } from '../receivable-aging-content'

/**
 * 回归测试：应收余额按主体分布恒按单体行展示。
 * 选中汇总主体（dim='summary:ET0001'）时，主体分布查询必须以 mode='single' 发起
 * （后端 single 路径将汇总主体展开为成员公司各行）；曾因传 mode='summary' 聚合回一行。
 */
const mocks = vi.hoisted(() => ({
  dim: 'summary:ET0001',
  receivablesRows: [] as { code: string; name: string; balance: number }[],
  /** 捕获 useDashboardReceivables 实际收到的参数 */
  receivablesHook: vi.fn(),
}))

vi.mock('@/hooks/api-queries', () => ({
  useDashboardReceivables: (params: { period?: string; mode: 'single' | 'summary'; companyCode?: string }) => {
    mocks.receivablesHook(params)
    return { data: { period: params.period ?? null, rows: mocks.receivablesRows }, isLoading: false, isError: false }
  },
  // 账龄查询（company/counterparty 两次调用）与 shared.tsx 依赖的 hooks 一并置空，不影响断言
  useTransactionAging: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useCompanies: () => ({ data: [] }),
  useTransactionAccounts: () => ({ data: [] }),
}))

vi.mock('@/stores/pageStateStore', () => ({
  usePageStore: (selector: (s: { dashboard: { dim: string } }) => unknown) => selector({ dashboard: { dim: mocks.dim } }),
}))

vi.mock('react-router-dom', () => ({
  Link: (props: { to?: string; children?: React.ReactNode }) => <a href={props.to}>{props.children}</a>,
}))

beforeEach(() => {
  mocks.dim = 'summary:ET0001'
  mocks.receivablesRows = [
    { code: 'EN330059', name: '杭州分公司', balance: 500 },
    { code: 'EN330060', name: '宁波分公司', balance: 300 },
  ]
  mocks.receivablesHook.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('ReceivableAgingContent（应收余额按主体分布·单体行展示）', () => {
  it('选中汇总主体时以 mode=single 发起主体分布查询（后端展开为成员公司各行）', () => {
    render(<ReceivableAgingContent period="2026-08" companyCode="ET0001" />)
    expect(mocks.receivablesHook).toHaveBeenCalledWith({ period: '2026-08', mode: 'single', companyCode: 'ET0001' })
  })

  it('主体分布卡按成员单体逐行渲染', () => {
    render(<ReceivableAgingContent period="2026-08" companyCode="ET0001" />)
    expect(screen.getByText('应收余额按主体分布')).toBeInTheDocument()
    expect(screen.getByText('杭州分公司')).toBeInTheDocument()
    expect(screen.getByText('宁波分公司')).toBeInTheDocument()
  })

  it('选中单体公司时同样以 mode=single 查询（自身一行）', () => {
    mocks.dim = 'company:EN330059'
    render(<ReceivableAgingContent period="2026-08" companyCode="EN330059" />)
    expect(mocks.receivablesHook).toHaveBeenCalledWith({ period: '2026-08', mode: 'single', companyCode: 'EN330059' })
  })
})
