import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RequirePermission } from '@/components/layout/require-permission'
import { useAuthStore } from '@/stores/authStore'
import type { User, UserRole } from '@/types'

function makeUser(role: UserRole): User {
  return {
    id: '1',
    username: 'u',
    name: 'U',
    role,
    dataScope: '*',
    status: 'active',
    createdAt: '',
    updatedAt: '',
  }
}

describe('RequirePermission', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false })
  })

  it('有权限时渲染子内容', () => {
    useAuthStore.setState({ user: makeUser('admin'), isAuthenticated: true })
    render(
      <RequirePermission resource="admin:users" action="view">
        <div>用户列表</div>
      </RequirePermission>,
    )
    expect(screen.getByText('用户列表')).toBeInTheDocument()
  })

  it('无权限时渲染 403 提示且不渲染子内容', () => {
    useAuthStore.setState({ user: makeUser('viewer'), isAuthenticated: true })
    render(
      <RequirePermission resource="admin:users" action="view">
        <div>用户列表</div>
      </RequirePermission>,
    )
    expect(screen.queryByText('用户列表')).not.toBeInTheDocument()
    expect(screen.getByText('无访问权限')).toBeInTheDocument()
  })
})
