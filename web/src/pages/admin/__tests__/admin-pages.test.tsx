import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useAuthStore } from '@/stores/authStore'
import type { User } from '@/types'

/**
 * 管理页面渲染冒烟测试（白屏回归）。
 *
 * 背景：dialogs.tsx 转译产物损坏导致 users/roles 页静态导入链接失败 → 整页白屏。
 * 本测试直接 import 三个页面模块并渲染，任何导出缺失/模块链接失败都会在导入期或渲染期暴露。
 */

const { mutationStub } = vi.hoisted(() => ({
  mutationStub: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/api-queries', () => ({
  useUsers: () => ({ data: { items: [], total: 0 } }),
  useRoles: () => ({
    data: [{ id: 'r1', code: 'viewer', name: '查看者', description: null, isSystem: true, userCount: 0, permissions: [] }],
  }),
  usePermissions: () => ({ data: [] }),
  useCompanies: () => ({ data: [] }),
  useUpdateUser: mutationStub,
  useDisableUser: mutationStub,
  usePurgeUser: mutationStub,
  useCreateUser: mutationStub,
  useResetPassword: mutationStub,
  useDeleteRole: mutationStub,
  useCloneRole: mutationStub,
  useCreateRole: mutationStub,
  useUpdateRole: mutationStub,
  useUpdateRolePermissions: mutationStub,
  useUpdateRolePermissionsBatch: mutationStub,
}))

import UsersPage from '../users'
import RolesPage from '../roles'

const ADMIN_PERMISSIONS = [
  'admin:users:view', 'admin:users:create', 'admin:users:update', 'admin:users:delete',
  'admin:users:reset-password', 'admin:users:export',
  'admin:roles:view', 'admin:roles:create', 'admin:roles:update', 'admin:roles:delete',
  'admin:permissions:view', 'admin:permissions:update',
]

function setAdminSession() {
  const user: User = {
    id: 'u-admin', username: 'admin', name: '管理员', role: 'admin',
    permissions: ADMIN_PERMISSIONS, dataScope: '全部', status: 'active', createdAt: '', updatedAt: '',
  }
  useAuthStore.setState({ user, isAuthenticated: true })
}

describe('管理页面渲染冒烟（白屏回归）', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false })
    setAdminSession()
  })

  it('用户管理页正常渲染（标题与新增按钮可见）', () => {
    render(<UsersPage />)
    expect(screen.getByText('用户管理')).toBeInTheDocument()
    expect(screen.getByText('新增用户')).toBeInTheDocument()
    expect(screen.getByText('暂无用户')).toBeInTheDocument()
  })

  it('角色管理页正常渲染（标题与角色行可见）', () => {
    render(<RolesPage />)
    expect(screen.getByText('角色管理')).toBeInTheDocument()
    expect(screen.getByText('查看者')).toBeInTheDocument()
  })

  it('角色管理页展示统计卡片、搜索框与角色编码', () => {
    render(<RolesPage />)
    expect(screen.getByText('角色总数')).toBeInTheDocument()
    expect(screen.getByText('系统角色')).toBeInTheDocument()
    expect(screen.getByText('自定义角色')).toBeInTheDocument()
    expect(screen.getByText('含高危权限')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('搜索角色名称、编码或描述...')).toBeInTheDocument()
    expect(screen.getByText('viewer')).toBeInTheDocument()
  })

  it('角色管理页：中大屏切换表格视图，展示表头与行选择', () => {
    // 模拟 ≥768px 视口（jsdom 无 matchMedia）：切换器可见，点击「表格」进入表格视图
    const mq = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mq))
    localStorage.removeItem('roles-view-mode')
    try {
      render(<RolesPage />)
      // 默认卡片视图；Radix Tabs 为 RovingTabIndex 键盘激活，按 Enter 切换「表格」
      fireEvent.keyDown(screen.getByRole('tab', { name: /表格/ }), { key: 'Enter' })
      expect(screen.getByRole('columnheader', { name: /角色名称/ })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /角色编码/ })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /类型/ })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /权限数/ })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /成员数/ })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: /操作/ })).toBeInTheDocument()
      // 行选择：表头全选复选框存在，角色行可勾选
      expect(screen.getByLabelText('全选当前角色')).toBeInTheDocument()
      expect(screen.getAllByLabelText('选择该行')).toHaveLength(1)
      // 选择持久化：localStorage 已记录表格视图
      expect(localStorage.getItem('roles-view-mode')).toBe('table')
    } finally {
      vi.unstubAllGlobals()
      localStorage.removeItem('roles-view-mode')
    }
  })
})
