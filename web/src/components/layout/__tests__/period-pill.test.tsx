import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PeriodPill } from '../period-pill'
import { usePeriodStore } from '@/stores/periodStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
const state = vi.hoisted(() => ({ data: { periods: ['2025-12', '2026-09', '2027-01', '2027-03'], fiscalYears: ['FY2026', 'FY2025'], fiscalStartMonth: 4 }, isPending: false, isError: false }))
vi.mock('@/hooks/api-queries', () => ({ useAvailablePeriods: () => ({ ...state, refetch: vi.fn() }) }))
beforeEach(() => {
  usePeriodStore.setState({ fiscalYear: 'FY2026', period: '2026-09' })
  usePreferencesStore.setState({ latestPending: false })
  state.isPending = false; state.isError = false
})
describe('期间月份直接生效', () => {
  it('浏览财年不会修改数据期间，跨年月份提交为一次完整更新', async () => {
    render(<PeriodPill />); fireEvent.click(screen.getByRole('button', { name: '选择期间' }))
    fireEvent.click(screen.getByRole('button', { name: '2027年1月' }))
    expect(usePeriodStore.getState().fiscalYear).toBe('FY2026'); expect(usePeriodStore.getState().period).toBe('2027-01')
  })
  it('无数据月份禁用，当前年月直接显示', () => {
    render(<PeriodPill />); expect(screen.getByRole('button', { name: '选择期间' })).toHaveTextContent('2026年09月')
    fireEvent.click(screen.getByRole('button', { name: '选择期间' })); expect(screen.getByRole('button', { name: '2026年4月' })).toBeDisabled()
  })
  it('加载与失败时保留原期间', () => {
    state.isPending = true; state.isError = true; render(<PeriodPill />)
    expect(usePeriodStore.getState().period).toBe('2026-09')
  })
  it('启动最新期间只应用一次', () => {
    usePreferencesStore.setState({ latestPending: true }); render(<PeriodPill />)
    expect(usePeriodStore.getState().period).toBe('2027-03'); expect(usePreferencesStore.getState().latestPending).toBe(false)
  })
})
