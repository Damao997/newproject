// 注意：本文件用例存在顺序依赖——模块级 sessionExpiredNotified 标志跨用例保持
// （vitest 同文件共享模块状态），首个用例触发跳转后标志为 true，后续用例验证的是
// 去重语义。新增用例时需留意此顺序依赖，勿假定标志在每个用例前被重置。
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

  it('二次调用不重复跳转（并发 401 只提示一次的去重语义）', () => {
    // 前一用例已触发首次跳转，sessionExpiredNotified 为 true
    const prevHref = window.location.href
    handleSessionExpired(new Error('再次过期'))
    // 跳转不重复发生：href 保持首次跳转目标不变
    expect(window.location.href).toBe(prevHref)
  })
})
