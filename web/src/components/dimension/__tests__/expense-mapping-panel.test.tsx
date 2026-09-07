import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExpenseMappingPanel } from '../expense-mapping-panel'
import type { ExpenseMappingCheckResult } from '@/types'

/** 提交回调与 check 数据桩（vi.hoisted 供 mock 工厂引用；checkState.data 可按用例覆写） */
const { createMock, checkState } = vi.hoisted(() => ({
  createMock: vi.fn(),
  checkState: { data: null as null | ExpenseMappingCheckResult },
}))

const baseCheckData: ExpenseMappingCheckResult = {
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
  useExpenseMappingCheck: () => ({ data: checkState.data }),
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
    checkState.data = baseCheckData
  })

  it('打开新增对话框后编码为只读自动值（EXP_ 数字序号），说明文字移入悬停提示', async () => {
    await openCreateDialog()
    const input = screen.getByDisplayValue('EXP_001')
    expect(input).toHaveAttribute('readonly')
    // Label 文案缩短为「映射编码」，括号说明不再常驻展示（由 TipLabel 悬停承载）
    expect(screen.getByText('映射编码')).toBeInTheDocument()
    expect(screen.queryByText(/系统自动生成，创建后不可修改/)).not.toBeInTheDocument()
    // 「引用科目」同时存在于表格列头与弹窗 TipLabel
    expect(screen.getAllByText('引用科目').length).toBeGreaterThan(1)
    expect(screen.queryByText(/可多选，选中科目汇总为一行/)).not.toBeInTheDocument()
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

describe('ExpenseMappingPanel 引用科目排除已引用', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockResolvedValue({})
    checkState.data = baseCheckData
  })

  it('新增对话框不展示已被启用映射引用的科目', async () => {
    checkState.data = {
      ...baseCheckData,
      mappings: [
        { id: 'm1', code: 'EXP_001', name: '既有映射', subjectCodes: ['PL05010101'], sortOrder: 0, status: 'active', createdAt: '', updatedAt: '', matchedSubjects: ['人力成本'], hasData: true },
      ],
    }
    await openCreateDialog()
    expect(screen.queryByRole('checkbox', { name: /人力成本/ })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /市场费用/ })).toBeInTheDocument()
  })

  it('编辑映射时自身已选科目保留，其他启用映射的科目被排除', async () => {
    checkState.data = {
      ...baseCheckData,
      mappings: [
        { id: 'm1', code: 'EXP_001', name: '映射A', subjectCodes: ['PL05010101'], sortOrder: 0, status: 'active', createdAt: '', updatedAt: '', matchedSubjects: ['人力成本'], hasData: true },
        { id: 'm2', code: 'EXP_002', name: '映射B', subjectCodes: ['PL05010102'], sortOrder: 1, status: 'active', createdAt: '', updatedAt: '', matchedSubjects: ['市场费用'], hasData: true },
      ],
    }
    renderPanel()
    fireEvent.click(screen.getAllByTitle('编辑映射')[0])
    // 映射A 自身引用的人力成本保留（且为勾选态），映射B 引用的市场费用被排除
    const own = await screen.findByRole('checkbox', { name: /人力成本/ })
    expect(own).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /市场费用/ })).not.toBeInTheDocument()
  })

  it('停用映射引用的科目不排除（与未配置口径一致，仅排除启用映射）', async () => {
    checkState.data = {
      ...baseCheckData,
      mappings: [
        { id: 'm1', code: 'EXP_001', name: '停用映射', subjectCodes: ['PL05010101'], sortOrder: 0, status: 'inactive', createdAt: '', updatedAt: '', matchedSubjects: ['人力成本'], hasData: false },
      ],
    }
    await openCreateDialog()
    expect(screen.getByRole('checkbox', { name: /人力成本/ })).toBeInTheDocument()
  })
})
