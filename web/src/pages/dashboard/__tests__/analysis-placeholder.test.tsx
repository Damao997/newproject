import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AnalysisPlaceholder } from '../analysis-placeholder'
import { AnalysisPage } from '../analysis'

vi.mock('@/hooks/useDashboardFilters', () => ({
  useDashboardFilters: () => ({
    dimFilter: '', setDimFilter: vi.fn(), selectedPeriod: '',
    periodOptions: [], companyCode: '',
  }),
}))

vi.mock('@/hooks/api-queries', () => ({
  useCompanies: () => ({ data: [] }),
  // receivable-aging 子页真实数据 hooks（期间未定时 enabled=false，返回空数据即可）
  useDashboardReceivables: () => ({ data: undefined, isLoading: false, isError: false }),
  useTransactionAging: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
}))

describe('经营分析占位页', () => {
  it('带跳转配置时渲染跳转按钮（应收账龄 → 往来账龄分析）', () => {
    render(
      <MemoryRouter>
        <AnalysisPlaceholder title="应收账款账龄分析表" actionLabel="前往往来账龄分析" actionHref="/transactions/aging" />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: '前往往来账龄分析' })
    expect(link).toHaveAttribute('href', '/transactions/aging')
  })

  it('带说明文案时渲染 note 而非默认文案', () => {
    render(
      <MemoryRouter>
        <AnalysisPlaceholder title="存货库龄分析表" note="功能规划中，如有需求请联系管理员反馈优先级" />
      </MemoryRouter>,
    )
    expect(screen.getByText('功能规划中，如有需求请联系管理员反馈优先级')).toBeInTheDocument()
    expect(screen.queryByText('功能开发中，敬请期待')).not.toBeInTheDocument()
  })

  it('AnalysisPage 的 receivable-aging 子页渲染真实跳转入口', async () => {
    render(
      <MemoryRouter>
        <AnalysisPage variant="receivable-aging" />
      </MemoryRouter>,
    )
    const link = await screen.findByRole('link', { name: '前往往来账龄分析' })
    expect(link).toHaveAttribute('href', '/transactions/aging')
  })
})
