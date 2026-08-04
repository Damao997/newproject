import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    data: [{ id: 'r1', code: 'viewer', name: '查看者', description: null, isSystem: true, permissions: [] }],
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
})
