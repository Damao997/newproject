// 注意：本文件“未登录并发跳转”用例依赖模块级 sessionExpiredNotified 标志（vitest 同文件共享模块状态）。
// 首个未登录用例触发跳转后标志为 true，后续未登录用例验证去重语义；新增用例时勿假定标志在每例前重置。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleSessionExpired } from '@/lib/api'

const { state } = vi.hoisted(() => ({
  state: { isAuthenticated: true, expireSession: vi.fn(), logout: vi.fn() },
}))

vi.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => state } }))

describe('handleSessionExpired 会话失效统一入口（FE-02）', () => {
  const originalLocation = window.location

  beforeEach(() => {
    state.isAuthenticated = true
    state.expireSession.mockClear()
    state.logout.mockClear()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    // jsdom 不支持真实导航：以可写 location stub 断言跳转目标
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true })
  })

  it('已登录：只标记同页重新认证，不本地登出、不整页跳转（保留页面与表单输入）', () => {
    handleSessionExpired(new Error('令牌已过期'))
    expect(state.expireSession).toHaveBeenCalledTimes(1)
    expect(state.logout).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  it('未登录的后台请求：无输入可保护，保留整页跳转登录页（携带 expired 参数）', () => {
    state.isAuthenticated = false
    handleSessionExpired(new Error('后台请求失效'))
    expect(window.location.href).toBe('/login?expired=1')
    expect(state.expireSession).not.toHaveBeenCalled()
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('未登录时二次调用不重复跳转（并发失效只跳转一次）', () => {
    // 前一用例已触发首次跳转，sessionExpiredNotified 为 true
    state.isAuthenticated = false
    const prevHref = window.location.href
    handleSessionExpired(new Error('再次失效'))
    expect(window.location.href).toBe(prevHref)
  })
})
