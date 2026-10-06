import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
  resetPasswordByEmail: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    forgotPassword: mocks.forgotPassword,
    resetPasswordByEmail: mocks.resetPasswordByEmail,
  },
}))

import { ForgotPasswordDialog } from '../forgot-password-dialog'

function renderDialog() {
  return render(<ForgotPasswordDialog open onOpenChange={() => undefined} />)
}

function gotoResetStep() {
  fireEvent.change(screen.getByLabelText('用户名或邮箱'), { target: { value: 'alice' } })
  fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.forgotPassword.mockResolvedValue(undefined)
  mocks.resetPasswordByEmail.mockResolvedValue(undefined)
})

describe('ForgotPasswordDialog', () => {
  it('第一步：空凭据提交展示校验错误，不调接口', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(screen.getByText('请输入用户名或邮箱')).toBeInTheDocument()
    expect(mocks.forgotPassword).not.toHaveBeenCalled()
  })

  it('第一步：含 @ 但格式非法时提示邮箱格式错误', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('用户名或邮箱'), { target: { value: 'bad@email' } })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(screen.getByText('邮箱格式不正确')).toBeInTheDocument()
    expect(mocks.forgotPassword).not.toHaveBeenCalled()
  })

  it('第一步通过 → 进入验证码+新密码步骤并调用 forgotPassword', async () => {
    renderDialog()
    gotoResetStep()

    await waitFor(() => expect(mocks.forgotPassword).toHaveBeenCalledWith({ identifier: 'alice' }))
    expect(await screen.findByLabelText('邮箱验证码')).toBeInTheDocument()
    expect(screen.getByLabelText('新密码')).toBeInTheDocument()
    expect(screen.getByLabelText('确认新密码')).toBeInTheDocument()
  })

  it('第二步：验证码非 6 位数字时提示错误', async () => {
    renderDialog()
    gotoResetStep()
    await screen.findByLabelText('邮箱验证码')

    fireEvent.change(screen.getByLabelText('邮箱验证码'), { target: { value: '12ab' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'NewPass123' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'NewPass123' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))

    expect(screen.getByText('请输入 6 位数字验证码')).toBeInTheDocument()
    expect(mocks.resetPasswordByEmail).not.toHaveBeenCalled()
  })

  it('第二步：两次密码不一致时提示错误', async () => {
    renderDialog()
    gotoResetStep()
    await screen.findByLabelText('邮箱验证码')

    fireEvent.change(screen.getByLabelText('邮箱验证码'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'NewPass123' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'NewPass456' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))

    expect(screen.getByText('两次输入的密码不一致')).toBeInTheDocument()
    expect(mocks.resetPasswordByEmail).not.toHaveBeenCalled()
  })

  it('第二步：新密码不符合规则（纯数字）时提示错误', async () => {
    renderDialog()
    gotoResetStep()
    await screen.findByLabelText('邮箱验证码')

    fireEvent.change(screen.getByLabelText('邮箱验证码'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))

    expect(screen.getByText('密码至少 8 位，且需同时包含字母与数字')).toBeInTheDocument()
    expect(mocks.resetPasswordByEmail).not.toHaveBeenCalled()
  })

  it('第二步通过 → 展示成功态并调用 resetPasswordByEmail', async () => {
    renderDialog()
    gotoResetStep()
    await screen.findByLabelText('邮箱验证码')

    fireEvent.change(screen.getByLabelText('邮箱验证码'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'NewPass123' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'NewPass123' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))

    await waitFor(() =>
      expect(mocks.resetPasswordByEmail).toHaveBeenCalledWith({ identifier: 'alice', code: '123456', newPassword: 'NewPass123' }),
    )
    expect(await screen.findByText(/密码重置成功/)).toBeInTheDocument()
  })

  it('接口失败时展示错误 FlashMessage', async () => {
    mocks.forgotPassword.mockRejectedValue(new Error('邮件服务未配置'))
    renderDialog()
    gotoResetStep()
    expect(await screen.findByText('邮件服务未配置')).toBeInTheDocument()
  })
})
