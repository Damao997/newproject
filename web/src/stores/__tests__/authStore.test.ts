import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '../authStore'
import type { User } from '@/types'

const baseUser: User = {
  id: 'account-a',
  username: 'account-a',
  name: '账号 A',
  role: 'viewer',
  permissions: ['reports:view'],
  dataScope: 'all',
  status: 'active',
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('认证状态：会话失效与同页重新认证（FE-02）', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useAuthStore.setState(useAuthStore.getInitialState())
    useAuthStore.getState().login(baseUser, 'access-1', 'refresh-1')
  })

  it('expireSession 保留账号与令牌、维持已登录外壳，仅标记待重新认证', () => {
    useAuthStore.getState().expireSession()
    const state = useAuthStore.getState()
    expect(state.reauthRequired).toBe(true)
    expect(state.isAuthenticated).toBe(true)
    expect(state.user?.id).toBe('account-a')
    expect(state.accessToken).toBe('access-1')
  })

  it('reauthenticate 更新令牌并清除待认证标记，账号与页面状态不被重置', () => {
    useAuthStore.getState().expireSession()
    useAuthStore.getState().reauthenticate({ ...baseUser, name: '账号 A（更新）' }, 'access-2', 'refresh-2')
    const state = useAuthStore.getState()
    expect(state.reauthRequired).toBe(false)
    expect(state.isAuthenticated).toBe(true)
    expect(state.accessToken).toBe('access-2')
    expect(state.refreshToken).toBe('refresh-2')
    expect(state.user?.name).toBe('账号 A（更新）')
  })

  it('logout 清空待认证标记与账号', () => {
    useAuthStore.getState().expireSession()
    useAuthStore.getState().logout()
    const state = useAuthStore.getState()
    expect(state.reauthRequired).toBe(false)
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
  })

  it('显式登出清理本人报告草稿，不清理其他账号的草稿键', () => {
    sessionStorage.setItem('report-drafts:account-a:report-1', '{}')
    sessionStorage.setItem('report-drafts:account-b:report-1', '{}')
    useAuthStore.getState().logout()
    expect(sessionStorage.getItem('report-drafts:account-a:report-1')).toBeNull()
    expect(sessionStorage.getItem('report-drafts:account-b:report-1')).toBe('{}')
  })

  it('会话过期（未显式登出）不清理本人报告草稿', () => {
    sessionStorage.setItem('report-drafts:account-a:report-1', '{}')
    useAuthStore.getState().expireSession()
    expect(sessionStorage.getItem('report-drafts:account-a:report-1')).toBe('{}')
  })

  it('重新登录（含切换账号）清除待认证标记', () => {
    useAuthStore.getState().expireSession()
    useAuthStore.getState().login({ ...baseUser, id: 'account-b', username: 'account-b' }, 'access-b', 'refresh-b')
    expect(useAuthStore.getState().reauthRequired).toBe(false)
    expect(useAuthStore.getState().user?.id).toBe('account-b')
  })

  it('待认证标记不写入持久化存储（不承诺跨刷新恢复）', () => {
    useAuthStore.getState().expireSession()
    const persisted = JSON.parse(localStorage.getItem('auth-storage') ?? '{}') as { state?: Record<string, unknown> }
    expect(persisted.state?.reauthRequired).toBeUndefined()
    expect(persisted.state?.isAuthenticated).toBe(true)
  })
})
