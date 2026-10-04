import { describe, it, vi, expect } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AnalysisContext } from '@/components/analysis/analysis-context'
import { defaultAnalysisState } from '@/stores/pageStateStore'
import baseline from './fixtures/analysis-report-baseline.json'
import input from './fixtures/analysis-input.json'
import { usePageStore } from '@/stores/pageStateStore'
import { CoreMetricsOverview } from '../core-metrics-overview'
import { CoreMetricsContent } from '../analysis/core-metrics-content'
import { CategoryBudgetContent } from '../analysis/category-budget-content'
import { SubjectBudgetContent } from '../analysis/subject-budget-content'
import { ExpenseContent } from '../analysis/expense-content'
import { CashFlowContent } from '../analysis/cash-flow-content'
import { ReceivableAgingContent } from '../analysis/receivable-aging-content'
import { InventoryAgingContent } from '../analysis/inventory-aging-content'
vi.mock('@/hooks/api-queries', () => {
  const query = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() })
  return { useKeyMetrics: () => query(input.key), useProductMetrics: () => query(input.core), useProductBudget: () => query(input.category), useSubjectBudget: () => query(input.subject), useExpenseAnalysis: () => query(input.expense), useCashflowIndicators: () => query(input.cash), useDashboardReceivables: () => query(input.receivable), useTransactionAging: () => query(input.aging), useInventoryOverview: () => query(input.inventory), useInventoryDetails: () => query(input.details), useCompanies: () => query([]), useTransactionAccounts: () => query([]) }
})
const components = { key: CoreMetricsOverview, core: CoreMetricsContent, category: CategoryBudgetContent, subject: SubjectBudgetContent, expense: ExpenseContent, cash: CashFlowContent, receivable: ReceivableAgingContent, inventory: InventoryAgingContent }
function capture(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLTableElement>('[data-comparison-matrix]')].map(table => ({
    head: [...table.tHead!.rows].map(row => [...row.cells].map(cell => ({ text: cell.textContent?.trim().replace(/\s+/g, ' '), colSpan: cell.colSpan, rowSpan: cell.rowSpan }))),
    body: [...table.tBodies[0].rows].map(row => [...row.cells].map(cell => cell.textContent?.trim().replace(/\s+/g, ' '))),
    foot: table.tFoot ? [...table.tFoot.rows].map(row => [...row.cells].map(cell => cell.textContent?.trim().replace(/\s+/g, ' '))) : [],
  }))
}
/** 基线来源：c3a46f4 原组件；输入包含零、空预算、负数、大金额和产品层级。 */
describe('经营分析完整报表契约', () => {
  for (const [name, Component] of Object.entries(components)) for (const amountMode of name === 'category' || name === 'subject' ? ['month', 'ytd'] as const : ['month'] as const) {
    it(name + ' 的行列、分组、合计与数值保持原样（' + amountMode + '）', () => {
      usePageStore.setState({ dashboard: { ...usePageStore.getInitialState().dashboard, dim: 'summary:ET0001' } })
      const { container } = render(<MemoryRouter><AnalysisContext.Provider value={{ state: { ...defaultAnalysisState, view: 'report', amountMode, selected: '不应过滤完整报表', keyword: '不应过滤完整报表' }, companyType: 'summary', update: vi.fn() }}><Component period="2026-09" companyCode="ET0001" /></AnalysisContext.Provider></MemoryRouter>)
      const key = name + (amountMode === 'ytd' ? '-ytd' : '')
      const expected = JSON.parse(JSON.stringify(baseline).replaceAll('财年预计完成情况', '财年累计')) as Record<string, unknown>
      expect(capture(container)).toEqual(expected[key])
      expect(container.querySelectorAll('[data-analysis-section="report"] h3')).toHaveLength(0)
      for (const table of container.querySelectorAll('[data-comparison-matrix]')) expect(table.closest('.app-card')).toBeNull()
      cleanup()
    })
  }
})
