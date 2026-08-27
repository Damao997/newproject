import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExpenseMappingPanel } from '../expense-mapping-panel'
import type { ExpenseMappingCheckResult } from '@/types'

/** 提交回调断言桩（vi.hoisted 供 mock 工厂引用） */
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

const checkData: ExpenseMappingCheckResult = {
  mappings: [],
  candidates: [
    {
      group: '付现运营费用',
      items: [
        { code: 'PL05010101', name: '人力成本', hasData: true },
        { code: 'PL05010102', name: '市场费用', hasData: false },
      ],
    },
  ],
  uncoveredSubjects: [],
  brokenCodes: [],
}

vi.mock('@/hooks/api-queries', () => ({
  useExpenseMappings: () => ({ data: [], isLoading: false }),
  useExpenseMappingCheck: () => ({ data: checkData }),
  useExpenseMappingMutations: () => ({
    create: { mutateAsync: createMock },
    update: { mutateAsync: vi.fn() },
    remove: { mutateAsync: vi.fn() },
  }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    getNextExpenseMappingCode: vi.fn().mockResolvedValue({ code: 'EXP_001' }),
  },
}))

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => ({ confirm: vi.fn(), element: null }),
}))

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ExpenseMappingPanel canCreate canUpdate canDelete />
    </QueryClientProvider>,
  )
}

/** 打开新增对话框并等待自动编码加载完成 */
async function openCreateDialog() {
  renderPanel()
  fireEvent.click(screen.getByRole('button', { name: /新增映射/ }))
  await screen.findByDisplayValue('EXP_001')
}

describe('ExpenseMappingPanel 新增映射统一编码', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockResolvedValue({})
  })

  it('打开新增对话框后编码为只读自动值（EXP_ 数字序号）', async () => {
    await openCreateDialog()
    const input = screen.getByDisplayValue('EXP_001')
    expect(input).toHaveAttribute('readonly')
    expect(screen.getByText(/映射编码（系统自动生成/)).toBeInTheDocument()
  })

  it('选择科目不改变自动编码（单选/多选均保持 EXP_ 值）', async () => {
    await openCreateDialog()
    const checkbox = screen.getByRole('checkbox', { name: /人力成本/ })
    fireEvent.click(checkbox)
    expect(screen.getByDisplayValue('EXP_001')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /市场费用/ }))
    expect(screen.getByDisplayValue('EXP_001')).toBeInTheDocument()
  })

  it('创建提交 payload 携带自动生成 code', async () => {
    await openCreateDialog()
    fireEvent.change(screen.getByPlaceholderText('如 人力成本'), { target: { value: '人力成本' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /人力成本/ }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        code: 'EXP_001',
        name: '人力成本',
        subjectCodes: ['PL05010101'],
        sortOrder: 0,
        status: 'active',
      })
    })
  })
})
