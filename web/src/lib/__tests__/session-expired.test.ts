import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleSessionExpired } from '@/lib/api'

const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn() }))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ logout: logoutMock }) },
}))

describe('handleSessionExpired 会话失效降级', () => {
  const originalLocation = window.location

  beforeEach(() => {
    logoutMock.mockClear()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    // jsdom 不支持真实导航：以可写 location stub 断言跳转目标
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true })
  })

  it('登出并跳转登录页（携带 expired 参数），不再使用原生弹窗', () => {
    handleSessionExpired(new Error('令牌已过期'))
    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('/login?expired=1')
    expect(window.alert).not.toHaveBeenCalled()
  })
})
