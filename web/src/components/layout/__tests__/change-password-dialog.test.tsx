import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChangePasswordDialog } from '../change-password-dialog'

const { closePasswordDialogMock, updateUserMock, setTokensMock, logoutMock, apiLogoutMock, dialogState } =
  vi.hoisted(() => ({
    closePasswordDialogMock: vi.fn(),
    updateUserMock: vi.fn(),
    setTokensMock: vi.fn(),
    logoutMock: vi.fn(),
    apiLogoutMock: vi.fn().mockResolvedValue(undefined),
    // passwordDialog.force 需按用例切换（vi.hoisted 保证先于 mock 工厂执行，避免 TDZ）
    dialogState: { force: false },
  }))

vi.mock('@/lib/api', () => ({
  api: {
    updatePassword: vi.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    logout: apiLogoutMock,
  },
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    user: { name: '测试用户' },
    passwordDialog: { open: true, force: dialogState.force },
    closePasswordDialog: closePasswordDialogMock,
    updateUser: updateUserMock,
    setTokens: setTokensMock,
    logout: logoutMock,
  }),
}))

describe('修改密码对话框', () => {
  // antd Button 对两个汉字的按钮自动插空格（"取消"→ accessible name "取 消"），须用正则匹配
  const cancelButton = () => screen.queryByRole('button', { name: /^取\s*消$/ })

  beforeEach(() => {
    dialogState.force = false
    closePasswordDialogMock.mockClear()
    updateUserMock.mockClear()
    setTokensMock.mockClear()
    logoutMock.mockClear()
    apiLogoutMock.mockClear()
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

  it('主动改密（非 force）显示"取消"、不显示"退出登录"（防回归）', () => {
    render(<ChangePasswordDialog />)
    expect(cancelButton()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument()
  })

  it('强制改密（force）提供"退出登录"出口：调用后端登出 + 本地登出，且不显示"取消"', async () => {
    dialogState.force = true
    render(<ChangePasswordDialog />)
    // force 模式不得出现"取消"（避免误以为可跳过改密继续使用系统）
    expect(cancelButton()).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    // 先通知后端吊销会话（强制改密豁免白名单已放行 logout），再本地登出兜底
    await waitFor(() => expect(logoutMock).toHaveBeenCalled())
    expect(apiLogoutMock).toHaveBeenCalledTimes(1)
  })
})
