import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '@/lib/personal-settings'
import { usePreferencesStore } from '../preferencesStore'
import type { PreferenceSnapshot } from '@/lib/personal-settings'

const mocks = vi.hoisted(() => ({ update: vi.fn(), accountId: 'account-a' }))
vi.mock('@/lib/api', () => ({ api: { updatePreferences: mocks.update }, ApiError: class extends Error {} }))
vi.mock('../authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: mocks.accountId } }) } }))

describe('首页 KPI 偏好保存与账号隔离', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    mocks.accountId = 'account-a'
    usePreferencesStore.setState({ ...usePreferencesStore.getInitialState(), accountId: 'account-a', ready: true, revision: 2 })
  })
  it('保存成功前模式不变，成功后按账号缓存并恢复累计模式', async () => {
    let complete!: (value: PreferenceSnapshot) => void
    mocks.update.mockReturnValue(new Promise<PreferenceSnapshot>(resolve => { complete = resolve }))
    const saving = usePreferencesStore.getState().save({ dashboardKpiMode: 'ytd' })
    expect(usePreferencesStore.getState().preferences.dashboardKpiMode).toBe('month')
    expect(usePreferencesStore.getState().saving).toBe(true)
    complete({ preferences: { ...DEFAULT_PREFERENCES, dashboardKpiMode: 'ytd' }, revision: 3 })
    await saving
    expect(mocks.update).toHaveBeenCalledWith({ changes: { dashboardKpiMode: 'ytd' }, revision: 2 })
    expect(usePreferencesStore.getState().preferences.dashboardKpiMode).toBe('ytd')
    expect(JSON.parse(localStorage.getItem('personal-preferences:account-a')!).preferences.dashboardKpiMode).toBe('ytd')
  })
  it('保存失败保留旧模式和版本，可再次提交', async () => {
    mocks.update.mockRejectedValue(new Error('设置已在其他设备更新'))
    await expect(usePreferencesStore.getState().save({ dashboardKpiMode: 'ytd' })).rejects.toThrow('设置已在其他设备更新')
    expect(usePreferencesStore.getState()).toMatchObject({ revision: 2, saving: false, error: '设置已在其他设备更新' })
    expect(usePreferencesStore.getState().preferences.dashboardKpiMode).toBe('month')
    expect(localStorage.getItem('personal-preferences:account-a')).toBeNull()
  })
  it('账号切换后迟到的保存响应不能覆盖新账号偏好', async () => {
    let complete!: (value: PreferenceSnapshot) => void
    mocks.update.mockReturnValue(new Promise<PreferenceSnapshot>(resolve => { complete = resolve }))
    const saving = usePreferencesStore.getState().save({ dashboardKpiMode: 'ytd' })
    mocks.accountId = 'account-b'
    usePreferencesStore.setState({ ...usePreferencesStore.getInitialState(), accountId: 'account-b', ready: true })
    complete({ preferences: { ...DEFAULT_PREFERENCES, dashboardKpiMode: 'ytd' }, revision: 3 })
    await saving
    expect(usePreferencesStore.getState().accountId).toBe('account-b')
    expect(usePreferencesStore.getState().preferences.dashboardKpiMode).toBe('month')
    expect(localStorage.getItem('personal-preferences:account-b')).toBeNull()
  })
})
