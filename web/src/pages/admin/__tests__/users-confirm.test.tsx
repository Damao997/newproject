import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { useAuthStore } from '@/stores/authStore'
import type { User } from '@/types'
import UsersPage from '../users'

const { disableMutate, purgeMutate } = vi.hoisted(() => ({
  disableMutate: vi.fn(),
  purgeMutate: vi.fn(),
}))

vi.mock('@/hooks/api-queries', () => ({
  useUsers: () => ({
    data: {
      items: [
        { id: 'u1', username: 'zhangsan', name: '张三', role: 'viewer', status: 'active', dataScope: '*', createdAt: '', updatedAt: '', lastLoginAt: null },
        { id: 'u2', username: 'lisi', name: '李四', role: 'viewer', status: 'inactive', dataScope: '*', createdAt: '', updatedAt: '', lastLoginAt: null },
      ],
      total: 2,
    },
  }),
  useRoles: () => ({ data: [] }),
  usePermissions: () => ({ data: [] }),
  useCompanies: () => ({ data: [] }),
  useUpdateUser: () => ({ mutate: vi.fn(), isPending: false }),
  useDisableUser: () => ({
    mutate: (id: string, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => disableMutate(id, opts),
    isPending: false,
  }),
  usePurgeUser: () => ({
    mutate: (id: string, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => purgeMutate(id, opts),
    isPending: false,
  }),
  useCreateUser: () => ({ mutate: vi.fn(), isPending: false }),
  useResetPassword: () => ({ mutate: vi.fn(), isPending: false }),
}))

const ADMIN_PERMISSIONS = [
  'admin:users:view', 'admin:users:create', 'admin:users:update', 'admin:users:delete',
  'admin:users:reset-password', 'admin:users:export', 'admin:users:purge',
]

function setAdminSession() {
  const user: User = {
    id: 'u-admin', username: 'admin', name: '管理员', role: 'admin',
    permissions: ADMIN_PERMISSIONS, dataScope: '全部', status: 'active', createdAt: '', updatedAt: '',
  }
  useAuthStore.setState({ user, isAuthenticated: true })
}

describe('用户管理：停用/彻底删除走确认对话框（替代原生 confirm）', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false })
    setAdminSession()
    disableMutate.mockClear()
    purgeMutate.mockClear()
  })

  /** 打开指定用户名所在行的操作菜单（MoreHorizontal 按钮） */
  const openRowMenu = (name: string) => {
    const row = screen.getByText(name).closest('tr')
    if (!row) throw new Error(`未找到 ${name} 所在行`)
    const trigger = within(row).getByRole('button', { name: `操作 ${name}` })
    // Radix DropdownMenu 由 pointerdown(左键)/keyDown(Enter) 打开，click 事件不触发。
    // jsdom 无 PointerEvent 构造器（fireEvent.pointerDown 的 button 属性丢失），用键盘 Enter 打开（等价真实键盘操作）
    fireEvent.keyDown(trigger, { key: 'Enter' })
  }

  it('停用：先弹确认框，确认后才调用停用接口', async () => {
    render(<UsersPage />)
    openRowMenu('张三')
    fireEvent.click(await screen.findByRole('menuitem', { name: '停用' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('确认停用用户「张三」？停用后其登录会话将失效。')
    fireEvent.click(screen.getByRole('button', { name: /停\s*用/ }))
    await waitFor(() => expect(disableMutate).toHaveBeenCalledWith('u1', expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })))
  })

  it('停用失败：接口报错时展示错误 flash 提示', async () => {
    disableMutate.mockImplementationOnce((_id, opts) => opts?.onError?.(new Error('网络错误')))
    render(<UsersPage />)
    openRowMenu('张三')
    fireEvent.click(await screen.findByRole('menuitem', { name: '停用' }))
    fireEvent.click(await screen.findByRole('button', { name: /停\s*用/ }))
    expect(await screen.findByText('网络错误')).toBeInTheDocument()
  })

  it('停用：取消确认则不调用接口', async () => {
    render(<UsersPage />)
    openRowMenu('张三')
    fireEvent.click(await screen.findByRole('menuitem', { name: '停用' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(disableMutate).not.toHaveBeenCalled()
  })

  it('彻底删除：需输入用户名才能确认（防呆），确认后调用删除接口', async () => {
    render(<UsersPage />)
    openRowMenu('李四')
    fireEvent.click(await screen.findByRole('menuitem', { name: '彻底删除' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('将物理删除用户「李四」（lisi）')
    const confirmBtn = screen.getByRole('button', { name: '彻底删除' })
    expect(confirmBtn).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('lisi'), { target: { value: 'lisiX' } })
    expect(confirmBtn).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('lisi'), { target: { value: 'lisi' } })
    expect(confirmBtn).toBeEnabled()
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(purgeMutate).toHaveBeenCalledWith('u2', expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })))
  })
})
