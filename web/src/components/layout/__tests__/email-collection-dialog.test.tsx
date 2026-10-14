import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EMAIL_COLLECTION_SNOOZE_KEY } from '@/lib/email-collection'
import { EmailCollectionDialog } from '../email-collection-dialog'

const { updateUserMock, apiMocks, authState } = vi.hoisted(() => ({
  updateUserMock: vi.fn(),
  apiMocks: { getLoginOptions: vi.fn(), updateProfile: vi.fn() },
  // 用例内按需改写：未绑邮箱 / 已绑邮箱 / 强制改密中
  authState: {
    user: { id: 'u1', username: 'alice', name: '爱丽丝', email: null as string | null, mustChangePassword: false },
  },
}))

vi.mock('@/lib/api', () => ({ api: apiMocks }))
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ user: authState.user, updateUser: updateUserMock }),
}))

// 不 mock '@/lib/email-collection'：豁免状态就是它写的 sessionStorage，要连着一起验

describe('工作邮箱收集引导', () => {
  const dialogTitle = () => screen.queryByText('补全工作邮箱')
  // 用 role 定位输入框：/工作邮箱/ 这类文本查询会同时命中弹窗容器（其可访问名就是标题「补全工作邮箱」）
  const emailInput = () => screen.getByRole('textbox') as HTMLInputElement

  beforeEach(() => {
    sessionStorage.clear()
    updateUserMock.mockClear()
    apiMocks.getLoginOptions.mockReset()
    apiMocks.updateProfile.mockReset()
    authState.user = { id: 'u1', username: 'alice', name: '爱丽丝', email: null, mustChangePassword: false }
    apiMocks.getLoginOptions.mockResolvedValue({ mailConfigured: true, captchaRequired: true, emailCollectionRequired: true })
  })

  it('开关开启且未绑邮箱 → 弹出引导，且不提供关闭按钮（只能保存或暂不填写）', async () => {
    render(<EmailCollectionDialog />)
    expect(await screen.findByText('补全工作邮箱')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '暂不填写' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /关闭|Close/ })).not.toBeInTheDocument()
  })

  it('保存合法邮箱 → 增量提交、写回本地用户、给出成功提示', async () => {
    apiMocks.updateProfile.mockResolvedValue({ email: 'alice@163.com' })
    render(<EmailCollectionDialog />)
    await screen.findByText('补全工作邮箱')

    fireEvent.change(emailInput(), { target: { value: 'Alice@163.com' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(apiMocks.updateProfile).toHaveBeenCalledWith({ email: 'Alice@163.com' }))
    expect(updateUserMock).toHaveBeenCalledWith({ email: 'alice@163.com' })
    expect(await screen.findByText('工作邮箱已保存，可用于找回密码')).toBeInTheDocument()
  })

  it('无效邮箱不提交，显示校验错误（错误摘要与字段提示各一处）', async () => {
    render(<EmailCollectionDialog />)
    await screen.findByText('补全工作邮箱')

    fireEvent.change(emailInput(), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect((await screen.findAllByText('请输入有效邮箱')).length).toBeGreaterThan(0)
    expect(emailInput()).toHaveAttribute('aria-invalid', 'true')
    expect(apiMocks.updateProfile).not.toHaveBeenCalled()
  })

  it('保存失败（如邮箱被他人占用）→ 弹窗留在原地并显示服务端提示', async () => {
    apiMocks.updateProfile.mockRejectedValue(new Error('该邮箱已被其他账号使用'))
    render(<EmailCollectionDialog />)
    await screen.findByText('补全工作邮箱')

    fireEvent.change(emailInput(), { target: { value: 'taken@163.com' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('该邮箱已被其他账号使用')).toBeInTheDocument()
    expect(dialogTitle()).toBeInTheDocument()
  })

  it('「暂不填写」→ 关闭弹窗并只豁免本次会话（下次登录由 login() 清除）', async () => {
    render(<EmailCollectionDialog />)
    await screen.findByText('补全工作邮箱')

    fireEvent.click(screen.getByRole('button', { name: '暂不填写' }))

    await waitFor(() => expect(dialogTitle()).not.toBeInTheDocument())
    expect(sessionStorage.getItem(EMAIL_COLLECTION_SNOOZE_KEY)).toBe('1')
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('已绑邮箱的账号不打扰：连开关都不探测', async () => {
    authState.user = { ...authState.user, email: 'alice@163.com' }
    render(<EmailCollectionDialog />)

    await waitFor(() => expect(screen.queryByText('补全工作邮箱')).not.toBeInTheDocument())
    expect(apiMocks.getLoginOptions).not.toHaveBeenCalled()
  })

  it('活动开关未开启时不弹（活动结束后改 env 即停）', async () => {
    apiMocks.getLoginOptions.mockResolvedValue({ mailConfigured: true, captchaRequired: true, emailCollectionRequired: false })
    render(<EmailCollectionDialog />)

    await waitFor(() => expect(apiMocks.getLoginOptions).toHaveBeenCalled())
    expect(dialogTitle()).not.toBeInTheDocument()
  })

  it('强制改密优先：未改初始密码前不叠加弹窗', async () => {
    authState.user = { ...authState.user, mustChangePassword: true }
    render(<EmailCollectionDialog />)

    await waitFor(() => expect(apiMocks.getLoginOptions).toHaveBeenCalled())
    expect(dialogTitle()).not.toBeInTheDocument()
  })

  it('能力探测失败按不拦截处理，不把用户挡在门外', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    apiMocks.getLoginOptions.mockRejectedValue(new Error('network down'))
    render(<EmailCollectionDialog />)

    await waitFor(() => expect(apiMocks.getLoginOptions).toHaveBeenCalled())
    expect(dialogTitle()).not.toBeInTheDocument()
    errorSpy.mockRestore()
  })
})
