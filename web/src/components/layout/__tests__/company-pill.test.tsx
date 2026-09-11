import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { message } from 'antd'
import { CompanyPill } from '@/components/layout/company-pill'
import { usePeriodStore } from '@/stores/periodStore'
import type { Company } from '@/types'

const mocks = vi.hoisted(() => ({
  companies: [] as Company[],
  displayNameMap: new Map<string, string>(),
  pending: false,
  error: false,
}))

vi.mock('@/hooks/api-queries', () => ({
  useCompanies: () => ({ data: mocks.companies, isPending: mocks.pending, isError: mocks.error }),
}))
vi.mock('@/hooks/useCompanyDisplay', () => ({
  useCompanyDisplayName: () => ({ displayNameMap: mocks.displayNameMap }),
}))

const E1 = { code: 'C1', name: '甲公司', type: 'entity' } as Company
const E2 = { code: 'C2', name: '乙公司', type: 'entity' } as Company
const S1 = { code: 'S1', name: '汇总一号', type: 'summary' } as Company
const S2 = { code: 'S2', name: '汇总二号', type: 'summary' } as Company

let infoSpy: MockInstance<typeof message.info>

beforeEach(() => {
  mocks.companies = [E1, E2, S1, S2]
  mocks.displayNameMap = new Map([
    ['C1', '甲公司'],
    ['C2', '乙公司'],
    ['S1', '汇总一号'],
    ['S2', '汇总二号'],
  ])
  mocks.pending = false
  mocks.error = false
  usePeriodStore.setState({ fiscalYear: null, period: null, companyCodes: null })
  localStorage.clear()
  infoSpy = vi.spyOn(message, 'info').mockImplementation(() => undefined as unknown as ReturnType<typeof message.info>)
})

afterEach(() => {
  infoSpy.mockRestore()
  cleanup()
})

/** 打开公司胶囊面板（Radix Popover → antd 多选下拉） */
async function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: '选择公司' }))
  await screen.findByText('公司范围')
  fireEvent.mouseDown(screen.getByRole('combobox'))
}

describe('CompanyPill（Header 公司胶囊）', () => {
  it('渲染触发器：h-8 圆角胶囊 + Building2 图标 + ChevronDown，与 PeriodPill 同构', () => {
    const { container } = render(<CompanyPill />)
    const trigger = screen.getByRole('button', { name: '选择公司' })
    expect(trigger).toHaveClass('h-8', 'rounded-md', 'border', 'border-border/60')
    expect(trigger.querySelector('.lucide-building-2')).toBeInTheDocument()
    expect(trigger.querySelector('.lucide-chevron-down')).toBeInTheDocument()
    // 面板未打开时不渲染公司范围内容
    expect(screen.queryByText('公司范围')).not.toBeInTheDocument()
    expect(container).toBeInTheDocument()
  })

  it('companyCodes 为 null（全部公司语义）与空数组均显示「全部公司」', () => {
    usePeriodStore.setState({ companyCodes: null })
    const { rerender } = render(<CompanyPill />)
    const trigger = screen.getByRole('button', { name: '选择公司' })
    expect(trigger).toHaveTextContent('全部公司')

    act(() => usePeriodStore.setState({ companyCodes: [] }))
    rerender(<CompanyPill />)
    expect(screen.getByRole('button', { name: '选择公司' })).toHaveTextContent('全部公司')
  })

  it('选中 1 家显示显示名（跟随简称偏好映射），多家显示「N 家公司」', () => {
    usePeriodStore.setState({ companyCodes: ['C1'] })
    const { rerender } = render(<CompanyPill />)
    expect(screen.getByRole('button', { name: '选择公司' })).toHaveTextContent('甲公司')

    act(() => usePeriodStore.setState({ companyCodes: ['C1', 'C2'] }))
    rerender(<CompanyPill />)
    expect(screen.getByRole('button', { name: '选择公司' })).toHaveTextContent('2 家公司')
  })

  it('面板内嵌 CompanyMultiSelect（分组选项）与快捷操作（全选实体 / 全部（清空））', async () => {
    render(<CompanyPill />)
    await openPanel()
    expect(await screen.findByText('单体公司-甲公司')).toBeInTheDocument()
    expect(screen.getByText('汇总主体-汇总一号')).toBeInTheDocument()
    expect(screen.getByText('全选实体')).toBeInTheDocument()
    expect(screen.getByText('全部（清空）')).toBeInTheDocument()
    // 规则说明改为「公司范围」标签旁 Info 图标的 antd Tooltip hover 展示（不再占面板底部文案）
    expect(screen.getByLabelText('公司范围规则说明')).toBeInTheDocument()
  })

  it('勾选公司后写入 store（触发器文案随之更新）', async () => {
    render(<CompanyPill />)
    await openPanel()
    fireEvent.click(await screen.findByText('单体公司-甲公司'))
    await waitFor(() => expect(usePeriodStore.getState().companyCodes).toEqual(['C1']))
    expect(screen.getByRole('button', { name: '选择公司' })).toHaveTextContent('甲公司')
  })

  it('互斥替换：已选单体时选汇总主体，自动取消单体并以 antd message 轻提示', async () => {
    usePeriodStore.setState({ companyCodes: ['C1'] })
    render(<CompanyPill />)
    await openPanel()
    fireEvent.click(await screen.findByText('汇总主体-汇总一号'))
    await waitFor(() => expect(usePeriodStore.getState().companyCodes).toEqual(['S1']))
    expect(infoSpy).toHaveBeenCalledWith('单体公司与汇总主体不能同时筛选，已自动取消已选单体公司。')
  })

  it('互斥替换：第二个汇总主体自动替换第一个并以 antd message 轻提示', async () => {
    usePeriodStore.setState({ companyCodes: ['S1'] })
    render(<CompanyPill />)
    await openPanel()
    fireEvent.click(await screen.findByText('汇总主体-汇总二号'))
    await waitFor(() => expect(usePeriodStore.getState().companyCodes).toEqual(['S2']))
    expect(infoSpy).toHaveBeenCalledWith('汇总主体仅可选择一个，已切换为「汇总二号」。')
  })

  it('快捷操作：全选实体写入全部单体公司（不含汇总主体），全部（清空）恢复 null', async () => {
    render(<CompanyPill />)
    fireEvent.click(screen.getByRole('button', { name: '选择公司' }))
    await screen.findByText('公司范围')

    fireEvent.click(screen.getByText('全选实体'))
    await waitFor(() => expect(usePeriodStore.getState().companyCodes).toEqual(['C1', 'C2']))

    fireEvent.click(screen.getByText('全部（清空）'))
    await waitFor(() => expect(usePeriodStore.getState().companyCodes).toBeNull())
  })

  it('加载态渲染骨架占位，失败态与空数据态渲染占位文案（与 PeriodPill 同风格）', () => {
    mocks.companies = []
    mocks.pending = true
    const { container, rerender } = render(<CompanyPill />)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()

    mocks.pending = false
    mocks.error = true
    rerender(<CompanyPill />)
    expect(screen.getByText('公司加载失败')).toBeInTheDocument()

    mocks.error = false
    rerender(<CompanyPill />)
    expect(screen.getByText('暂无公司')).toBeInTheDocument()
  })
})

describe('periodStore companyCodes 持久化', () => {
  it('从 period-storage 恢复 companyCodes，既有 fiscalYear/period 恢复行为不变', async () => {
    localStorage.setItem(
      'period-storage',
      JSON.stringify({ state: { fiscalYear: 'FY2026', period: '2026-08', companyCodes: ['C1'] }, version: 0 }),
    )
    vi.resetModules()
    const { usePeriodStore: freshStore } = await import('@/stores/periodStore')
    expect(freshStore.getState().companyCodes).toEqual(['C1'])
    expect(freshStore.getState().fiscalYear).toBe('FY2026')
    expect(freshStore.getState().period).toBe('2026-08')
    cleanup()
  })

  it('旧版 storage 无 companyCodes 字段时保持初始 null（= 全部公司）', async () => {
    localStorage.setItem(
      'period-storage',
      JSON.stringify({ state: { fiscalYear: 'FY2025', period: '2025-12' }, version: 0 }),
    )
    vi.resetModules()
    const { usePeriodStore: freshStore } = await import('@/stores/periodStore')
    expect(freshStore.getState().companyCodes).toBeNull()
    expect(freshStore.getState().fiscalYear).toBe('FY2025')
  })

  it('setCompanyCodes 后写入 storage（partialize 含 companyCodes）', async () => {
    usePeriodStore.getState().setCompanyCodes(['C1', 'S1'])
    const persisted = JSON.parse(localStorage.getItem('period-storage') ?? '{}')
    expect(persisted.state.companyCodes).toEqual(['C1', 'S1'])
    expect(persisted.state.fiscalYear).toBeNull()
    expect(persisted.state.period).toBeNull()
  })
})
