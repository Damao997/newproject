import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProductCategoryPanel } from '../product-category-panel'
import type { ProductCategory, ProductCategoryCheckResult } from '@/types'

const { createMock, updateMock, state } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  state: {
    categories: [] as ProductCategory[],
    check: null as null | ProductCategoryCheckResult,
    tree: [
      { id: '1', code: 'PL01', name: '壹品慧收入', level: 1, parentCode: null, category: '壹品慧收入', direction: 'credit', isLeaf: false, dataType: 'data' },
      { id: '2', code: 'PL0101', name: '销售收入', level: 2, parentCode: 'PL01', category: '壹品慧收入', direction: 'credit', isLeaf: false, dataType: 'data' },
      { id: '3', code: 'PL010101', name: '厨房电器销售', level: 3, parentCode: 'PL0101', category: '壹品慧收入', direction: 'credit', isLeaf: true, dataType: 'data' },
    ],
  },
}))

vi.mock('@/hooks/api-queries', () => ({
  useProductCategories: () => ({ data: state.categories, isLoading: false }),
  useProductCategoryCheck: () => ({ data: state.check }),
  useProductCategoryMutations: () => ({
    create: { mutateAsync: createMock },
    update: { mutateAsync: updateMock },
    remove: { mutateAsync: vi.fn() },
  }),
  useSubjectTree: () => ({ data: state.tree, isLoading: false }),
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => ({ confirm: vi.fn(), element: null }),
}))

function makeCategory(over: Partial<ProductCategory> = {}): ProductCategory {
  return {
    id: 'c1', code: 'kitchen', name: '厨房产品销售', subjectKeyword: '厨房产品销售',
    subjectCodes: [], sortOrder: 0, status: 'active', createdAt: '', updatedAt: '', ...over,
  }
}

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProductCategoryPanel canCreate canUpdate canDelete />
    </QueryClientProvider>,
  )
}

/** 打开新增对话框，展开收入树并勾选叶子科目 */
function pickLeafSubject() {
  fireEvent.click(screen.getByRole('button', { name: /选择显式科目/ }))
  fireEvent.click(screen.getByRole('button', { name: '展开 壹品慧收入' }))
  fireEvent.click(screen.getByRole('button', { name: '展开 销售收入' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /厨房电器销售/ }))
}

describe('ProductCategoryPanel C1 显式科目（混合模式）', () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({})
    updateMock.mockReset().mockResolvedValue({})
    state.categories = []
    state.check = { categories: [], uncoveredSubjects: [], brokenKeywords: [], brokenCodes: [], missingProfitMirror: [] }
  })

  it('纯显式配置可保存：不填关键词，payload 携带 subjectCodes', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /新增品类/ }))
    fireEvent.change(screen.getByPlaceholderText('如 kitchen'), { target: { value: 'kitchen' } })
    fireEvent.change(screen.getByLabelText('品类名称'), { target: { value: '厨房电器' } })
    pickLeafSubject()
    expect(screen.getByRole('button', { name: /已选 1 个科目/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
        code: 'kitchen',
        name: '厨房电器',
        subjectKeyword: '',
        subjectCodes: ['PL010101'],
        status: 'active',
      }))
    })
  })

  it('关键词与显式科目均空时保存被拦截，并提示至少配置一个', async () => {
    const { container } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /新增品类/ }))
    fireEvent.change(screen.getByPlaceholderText('如 kitchen'), { target: { value: 'kitchen' } })
    fireEvent.change(screen.getByLabelText('品类名称'), { target: { value: '厨房电器' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      // 错误提示元素（列表下方 text-destructive 段落），而非对话框描述里的恒真文案
      expect(container.querySelector('p.text-destructive')?.textContent).toMatch(/至少配置一个/)
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('编辑时带入已有显式科目（触发按钮回显已选数量）', async () => {
    state.categories = [makeCategory({ subjectCodes: ['PL010101'] })]
    state.check = {
      categories: [{ ...makeCategory({ subjectCodes: ['PL010101'] }), matchedSubjects: ['厨房电器销售'], profitOk: true }],
      uncoveredSubjects: [], brokenKeywords: [], brokenCodes: [], missingProfitMirror: [],
    }
    renderPanel()
    fireEvent.click(screen.getAllByTitle('编辑品类')[0])
    const trigger = await screen.findByRole('button', { name: /已选 1 个科目/ })
    expect(trigger).toBeInTheDocument()
  })

  it('列表对显式配置行展示「显式 N 科」徽标', () => {
    state.categories = [makeCategory({ subjectCodes: ['PL010101', 'PL010102'] })]
    state.check = {
      categories: [{ ...makeCategory({ subjectCodes: ['PL010101', 'PL010102'] }), matchedSubjects: ['厨房电器销售'], profitOk: true }],
      uncoveredSubjects: [], brokenKeywords: [], brokenCodes: [], missingProfitMirror: [],
    }
    renderPanel()
    expect(screen.getByText('显式 2 科')).toBeInTheDocument()
    expect(screen.getByText('精确匹配')).toBeInTheDocument()
  })

  it('检测结果包含失效编码时展示 brokenCodes 警示', () => {
    state.categories = [makeCategory({ subjectCodes: ['PL999999'] })]
    state.check = {
      categories: [{ ...makeCategory({ subjectCodes: ['PL999999'] }), matchedSubjects: [], profitOk: false }],
      uncoveredSubjects: [], brokenKeywords: [], brokenCodes: ['PL999999'], missingProfitMirror: [],
    }
    renderPanel()
    expect(screen.getByText(/以下显式科目编码在收入科目树中不存在/)).toBeInTheDocument()
    expect(screen.getByText('PL999999')).toBeInTheDocument()
  })

  it('保存 payload 同时提交关键词与显式科目（显式优先）', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /新增品类/ }))
    fireEvent.change(screen.getByPlaceholderText('如 kitchen'), { target: { value: 'kitchen' } })
    fireEvent.change(screen.getByLabelText('品类名称'), { target: { value: '厨房电器' } })
    fireEvent.change(screen.getByLabelText(/匹配关键词/), { target: { value: '厨房' } })
    pickLeafSubject()
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
        subjectKeyword: '厨房',
        subjectCodes: ['PL010101'],
      }))
    })
  })
})
