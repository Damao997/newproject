import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChangePasswordDialog } from '../change-password-dialog'

const { closePasswordDialogMock, updateUserMock, setTokensMock } = vi.hoisted(() => ({
  closePasswordDialogMock: vi.fn(),
  updateUserMock: vi.fn(),
  setTokensMock: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: { updatePassword: vi.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }) },
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    user: { name: '测试用户' },
    passwordDialog: { open: true, force: false },
    closePasswordDialog: closePasswordDialogMock,
    updateUser: updateUserMock,
    setTokens: setTokensMock,
  }),
}))

describe('修改密码对话框', () => {
  beforeEach(() => {
    closePasswordDialogMock.mockClear()
    updateUserMock.mockClear()
    setTokensMock.mockClear()
  })

  it('修改成功后展示 FlashMessage 轻提示而非原生弹窗', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(<ChangePasswordDialog />)
    fireEvent.change(screen.getByLabelText('原密码'), { target: { value: 'old1234' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new1234a' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new1234a' } })
    fireEvent.click(screen.getByRole('button', { name: '确认修改' }))
    expect(await screen.findByText('密码修改成功')).toBeInTheDocument()
    expect(alertSpy).not.toHaveBeenCalled()
    // 静默续期行为不变：新令牌对写回 store
    expect(updateUserMock).toHaveBeenCalledWith({ mustChangePassword: false })
    expect(setTokensMock).toHaveBeenCalledWith('at', 'rt')
    expect(closePasswordDialogMock).toHaveBeenCalled()
  })
})
