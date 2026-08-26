import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DashboardFilterBar } from '../dashboard-filter-bar'

// CompanySelect 依赖 React Query（useCompanies），无 Provider 时抛错；按 analysis-placeholder.test.tsx 先例 mock
vi.mock('@/hooks/api-queries', () => ({
  useCompanies: () => ({ data: [] }),
}))

describe('DashboardFilterBar 看板筛选块', () => {
  const base = {
    dimFilter: '',
    onDimChange: vi.fn(),
    selectedPeriod: '',
    onPeriodChange: vi.fn(),
    periodOptions: ['2026-01', '2026-02'],
  }

  it('渲染主体选择与期间选择（含最新期间选项）', () => {
    render(<DashboardFilterBar {...base} />)
    // 主体触发器：未选定时显示占位符（Radix 下拉选项仅在打开后渲染，见 select.test.tsx）
    expect(screen.getByRole('combobox', { name: '选择主体维度（汇总主体自动展开为成员合并口径）' })).toBeInTheDocument()
    // 期间触发器：未选定时直接回显最新期间实际值（YYYY-MM）；打开后含「最新期间」选项
    const periodTrigger = screen.getByRole('combobox', { name: '选择预览期间' })
    expect(periodTrigger).toHaveTextContent('2026-02')
    fireEvent.click(periodTrigger)
    expect(screen.getByText('最新期间')).toBeInTheDocument()
  })

  it('无期间候选时不渲染期间选择器', () => {
    render(<DashboardFilterBar {...base} periodOptions={[]} />)
    expect(screen.queryByText('最新期间')).not.toBeInTheDocument()
  })

  it('控件统一 h-9 高度与语义宽度', () => {
    const { container } = render(<DashboardFilterBar {...base} />)
    // 主体 + 期间两个触发器均为 h-9（若实现回退为 h-8，数量断言会失败）
    expect(container.querySelectorAll('[class*="h-9"]').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('[class*="w-[180px]"]')).toBeTruthy()
    expect(container.querySelector('[class*="w-[140px]"]')).toBeTruthy()
  })
})
