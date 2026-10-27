import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProductConfigPanel } from '../product-config-panel'
import type { KeyMetricsProduct, KeyMetricsProductCheckResult } from '@/types'

const { createMock, state } = vi.hoisted(() => ({
  createMock: vi.fn(),
  state: {
    products: [] as KeyMetricsProduct[],
    check: null as null | KeyMetricsProductCheckResult,
    tree: [
      { id: '1', code: 'PL01', name: '壹品慧收入', level: 1, parentCode: null, category: '壹品慧收入', direction: 'credit', isLeaf: false, dataType: 'data' },
      { id: '2', code: 'PL0101', name: '销售收入', level: 2, parentCode: 'PL01', category: '壹品慧收入', direction: 'credit', isLeaf: false, dataType: 'data' },
      { id: '3', code: 'PL010101', name: '厨房电器销售', level: 3, parentCode: 'PL0101', category: '壹品慧收入', direction: 'credit', isLeaf: true, dataType: 'data' },
    ],
  },
}))

vi.mock('@/hooks/api-queries', () => ({
  useKeyMetricsProducts: () => ({ data: state.products, isLoading: false }),
  useKeyMetricsProductCheck: () => ({ data: state.check }),
  useKeyMetricsProductMutations: () => ({
    create: { mutateAsync: createMock },
    update: { mutateAsync: vi.fn() },
    remove: { mutateAsync: vi.fn() },
  }),
  useSubjectTree: () => ({ data: state.tree, isLoading: false }),
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => ({ confirm: vi.fn(), element: null }),
}))

function makeProduct(over: Partial<KeyMetricsProduct> = {}): KeyMetricsProduct {
  return {
    id: 'p1', code: 'km_kitchen', name: '厨房电器', subjectKeyword: '厨房电器',
    subjectCodes: [], sortOrder: 0, status: 'active', createdAt: '', updatedAt: '', ...over,
  }
}

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProductConfigPanel canCreate canUpdate canDelete />
    </QueryClientProvider>,
  )
}

describe('ProductConfigPanel C1 显式科目（混合模式）', () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({})
    state.products = []
    state.check = { products: [], uncoveredSubjects: [], brokenKeywords: [], brokenCodes: [], missingProfitMirror: [] }
  })

  it('纯显式配置可保存：不填关键词，payload 携带 subjectCodes', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /新增产品/ }))
    fireEvent.change(screen.getByPlaceholderText('如 km_kitchen'), { target: { value: 'km_kitchen' } })
    fireEvent.change(screen.getByLabelText('产品名称'), { target: { value: '厨房电器' } })
    fireEvent.click(screen.getByRole('button', { name: /选择显式科目/ }))
    fireEvent.click(screen.getByRole('button', { name: '展开 壹品慧收入' }))
    fireEvent.click(screen.getByRole('button', { name: '展开 销售收入' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /厨房电器销售/ }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
        code: 'km_kitchen',
        name: '厨房电器',
        subjectKeyword: '',
        subjectCodes: ['PL010101'],
      }))
    })
  })

  it('关键词与显式科目均空时保存被拦截', async () => {
    const { container } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /新增产品/ }))
    fireEvent.change(screen.getByPlaceholderText('如 km_kitchen'), { target: { value: 'km_kitchen' } })
    fireEvent.change(screen.getByLabelText('产品名称'), { target: { value: '厨房电器' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(container.querySelector('p.text-destructive')?.textContent).toMatch(/至少配置一个/)
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('检测结果包含失效编码时展示 brokenCodes 警示', () => {
    state.products = [makeProduct({ subjectCodes: ['PL999999'] })]
    state.check = {
      products: [{ ...makeProduct({ subjectCodes: ['PL999999'] }), matchedSubjects: [], profitOk: false }],
      uncoveredSubjects: [], brokenKeywords: [], brokenCodes: ['PL999999'], missingProfitMirror: [],
    }
    renderPanel()
    expect(screen.getByText(/以下显式科目编码在收入科目树中不存在/)).toBeInTheDocument()
    expect(screen.getByText('PL999999')).toBeInTheDocument()
    expect(screen.getByText('显式 1 科')).toBeInTheDocument()
  })
})
