import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '@/lib/api'
import LoginPage from '../index'

const { apiMocks, authState } = vi.hoisted(() => ({
  apiMocks: { getLoginOptions: vi.fn(), getCaptcha: vi.fn(), login: vi.fn(), autoLogin: vi.fn() },
  authState: {
    login: vi.fn(),
    isAuthenticated: false,
    persistentLoginToken: null as string | null,
    setPersistentLoginToken: vi.fn(),
  },
}))

// 保留真实 ApiError（页面按 428 判定），只替换 api 实例
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: apiMocks }
})

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}))

/**
 * 验证码按需出现：默认隐藏且不预拉图；服务端要求时（登录 428 / 应急开关）才展开。
 * 图形验证码本身由服务端 svg-captcha 生成，不适合在 jsdom 里做识别，这里只验证交互契约。
 */
describe('登录页图形验证码按需出现', () => {
  const renderPage = () => render(<MemoryRouter><LoginPage /></MemoryRouter>)
  const submitButton = () => screen.getByRole('button', { name: /登\s*录/ })

  beforeEach(() => {
    apiMocks.getLoginOptions.mockReset()
    apiMocks.getCaptcha.mockReset()
    apiMocks.login.mockReset()
    authState.login.mockClear()
    apiMocks.getLoginOptions.mockResolvedValue({ mailConfigured: true, captchaRequired: false, emailCollectionRequired: false })
    apiMocks.getCaptcha.mockResolvedValue({ captchaId: 'c1', svg: '<svg></svg>' })
  })

  it('默认不渲染验证码框，也不预拉验证码图', async () => {
    renderPage()
    await waitFor(() => expect(apiMocks.getLoginOptions).toHaveBeenCalled())

    expect(screen.queryByLabelText('验证码')).not.toBeInTheDocument()
    expect(apiMocks.getCaptcha).not.toHaveBeenCalled()
  })

  it('未要求验证码时提交，captcha 字段按空值上送', async () => {
    apiMocks.login.mockResolvedValue({ user: { id: 'u1', username: 'alice' }, accessToken: 'at', refreshToken: 'rt' })
    renderPage()
    await waitFor(() => expect(apiMocks.getLoginOptions).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Yipinhui@2026' } })
    fireEvent.click(submitButton())

    await waitFor(() => expect(apiMocks.login).toHaveBeenCalledWith(expect.objectContaining({ username: 'alice', captchaId: '', captcha: '' })))
  })

  it('服务端要求验证码（应急开关）时，进页面即展示并拉图', async () => {
    apiMocks.getLoginOptions.mockResolvedValue({ mailConfigured: true, captchaRequired: true, emailCollectionRequired: false })
    renderPage()

    expect(await screen.findByLabelText('验证码')).toBeInTheDocument()
    await waitFor(() => expect(apiMocks.getCaptcha).toHaveBeenCalledTimes(1))
  })

  it('登录返回 428 → 展开验证码框、拉图并提示失败次数过多', async () => {
    apiMocks.login.mockRejectedValue(new ApiError('密码错误次数过多，请输入图形验证码', 428))
    renderPage()
    await waitFor(() => expect(apiMocks.getLoginOptions).toHaveBeenCalled())

    expect(screen.queryByLabelText('验证码')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } })
    fireEvent.click(submitButton())

    expect(await screen.findByLabelText('验证码')).toBeInTheDocument()
    // 服务端文案直接进错误条，用户知道为什么要填
    expect(await screen.findByText('密码错误次数过多，请输入图形验证码')).toBeInTheDocument()
    await waitFor(() => expect(apiMocks.getCaptcha).toHaveBeenCalledTimes(1))
  })

  it('验证码框展开后必填：留空提交不再打后端', async () => {
    apiMocks.login.mockRejectedValue(new ApiError('密码错误次数过多，请输入图形验证码', 428))
    renderPage()
    await waitFor(() => expect(apiMocks.getLoginOptions).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } })
    fireEvent.click(submitButton())
    await screen.findByLabelText('验证码')
    expect(apiMocks.login).toHaveBeenCalledTimes(1)

    // 验证码留空再次提交 → 前端拦下，不再多发一次请求
    fireEvent.click(submitButton())
    // 校验文案同时出现在错误摘要与字段提示，故用 findAllByText
    expect((await screen.findAllByText('请输入验证码')).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('验证码')).toHaveAttribute('aria-invalid', 'true')
    expect(apiMocks.login).toHaveBeenCalledTimes(1)
  })

  it('提示普通密码错误（401）时不会误展开验证码框', async () => {
    apiMocks.login.mockRejectedValue(new ApiError('用户名或密码错误', 401))
    renderPage()
    await waitFor(() => expect(apiMocks.getLoginOptions).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } })
    fireEvent.click(submitButton())

    expect(await screen.findByText('用户名或密码错误')).toBeInTheDocument()
    expect(screen.queryByLabelText('验证码')).not.toBeInTheDocument()
  })
})
