import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { CompanyPill } from '@/components/layout/company-pill'
import { usePeriodStore } from '@/stores/periodStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { DEFAULT_PREFERENCES } from '@/lib/personal-settings'
import { setStorageAccount, claimLegacyStorage } from '@/stores/account-storage'
import type { Company } from '@/types'
const mocks = vi.hoisted(() => ({ companies: [] as Company[], pending: false, error: false, refetch: vi.fn() }))
vi.mock('@/hooks/api-queries', () => ({ useCompanies: () => ({ data: mocks.companies, isPending: mocks.pending, isError: mocks.error, refetch: mocks.refetch }) }))
vi.mock('@/hooks/useCompanyDisplay', () => ({ useCompanyDisplayName: () => ({ getDisplayName: (code: string) => mocks.companies.find(c => c.code === code)?.name ?? code }) }))
const rows = [{ code: 'C1', name: '甲公司', shortName: '甲', type: 'entity' }, { code: 'C2', name: '乙公司', type: 'entity' }, { code: 'S1', name: '汇总一号', type: 'summary' }, { code: 'S2', name: '汇总二号', type: 'summary' }] as Company[]
beforeEach(() => {
  localStorage.clear(); setStorageAccount(null); usePeriodStore.setState(usePeriodStore.getInitialState())
  mocks.companies = rows; mocks.pending = false; mocks.error = false
  usePreferencesStore.setState({ preferences: DEFAULT_PREFERENCES, saving: false })
})
async function open() { fireEvent.click(screen.getByRole('button', { name: '选择公司范围' })); await screen.findByRole('textbox', { name: '搜索公司' }) }
describe('公司确认应用', () => {
  it('空选择明确表示全部授权范围', () => { render(<CompanyPill />); expect(screen.getByRole('button', { name: '选择公司范围' })).toHaveTextContent('全部可见公司') })
  it('勾选仅修改草稿，应用才提交', async () => {
    render(<CompanyPill />); await open(); fireEvent.click(screen.getByRole('checkbox', { name: /甲公司/ }))
    expect(usePeriodStore.getState().companyCodes).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(usePeriodStore.getState().companyCodes).toEqual(['C1']))
  })
  it('取消丢弃草稿，重新打开恢复已提交选择', async () => {
    usePeriodStore.setState({ companyCodes: ['C1'] }); render(<CompanyPill />); await open()
    fireEvent.click(screen.getByRole('checkbox', { name: /乙公司/ })); fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(usePeriodStore.getState().companyCodes).toEqual(['C1'])
    await open(); expect(screen.getByRole('checkbox', { name: /乙公司/ })).not.toBeChecked()
  })
  it('切换汇总主体在面板内提示，保留确认步骤', async () => {
    usePeriodStore.setState({ companyCodes: ['C1'] }); render(<CompanyPill />); await open()
    fireEvent.click(screen.getByRole('checkbox', { name: /汇总一号/ }))
    expect(screen.getByRole('status')).toHaveTextContent('已自动取消')
    expect(usePeriodStore.getState().companyCodes).toEqual(['C1'])
    fireEvent.click(screen.getByRole('button', { name: '应用' })); expect(usePeriodStore.getState().companyCodes).toEqual(['S1'])
  })
  it('汇总主体只能选一个，全选仅包含单体公司', async () => {
    usePeriodStore.setState({ companyCodes: ['S1'] }); render(<CompanyPill />); await open()
    fireEvent.click(screen.getByRole('checkbox', { name: /汇总二号/ }))
    expect(screen.getByRole('checkbox', { name: /汇总一号/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '全选单体公司' }))
    fireEvent.click(screen.getByRole('button', { name: '应用' })); expect(usePeriodStore.getState().companyCodes).toEqual(['C1', 'C2'])
  })
  it('名称、简称与编码可搜索，清除后恢复列表并聚焦', async () => {
    render(<CompanyPill />); await open()
    const input = screen.getByRole('textbox', { name: '搜索公司' })
    fireEvent.change(input, { target: { value: 'C2' } }); expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '清除公司搜索' })); expect(input).toHaveFocus(); expect(screen.getAllByRole('checkbox')).toHaveLength(4)
  })
  it('失败提供重试，且不能应用未加载的范围', async () => {
    mocks.error = true; render(<CompanyPill />); await open()
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(mocks.refetch).toHaveBeenCalled()
  })
})
describe('账号筛选隔离', () => {
  it('旧数据只能被首次绑定账号继承', () => {
    localStorage.setItem('period-storage', JSON.stringify({ state: { fiscalYear: 'FY2026', period: '2026-08', companyCodes: ['C1'] }, version: 0 }))
    expect(claimLegacyStorage('甲')).toBe(true); expect(claimLegacyStorage('乙')).toBe(false)
    expect(localStorage.getItem('period-storage:乙')).toBeNull()
  })
  it('账号切换不覆盖另一账号的公司和期间', async () => {
    setStorageAccount('甲'); act(() => usePeriodStore.getState().setRange('FY2026', '2026-08')); usePeriodStore.getState().setCompanyCodes(['C1'])
    setStorageAccount(null); usePeriodStore.setState(usePeriodStore.getInitialState())
    setStorageAccount('乙'); usePeriodStore.getState().setCompanyCodes(['C2'])
    setStorageAccount(null); usePeriodStore.setState(usePeriodStore.getInitialState())
    setStorageAccount('甲'); await usePeriodStore.persist.rehydrate()
    expect(usePeriodStore.getState().companyCodes).toEqual(['C1']); expect(usePeriodStore.getState().period).toBe('2026-08')
  })
})
