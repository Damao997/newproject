import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePermission } from '@/hooks/usePermission'
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

function setRole(role: UserRole) {
  useAuthStore.setState({ user: makeUser(role), isAuthenticated: true })
}

describe('usePermission', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false })
  })

  it('管理员 can 对权限管理返回 true', () => {
    setRole('admin')
    const { result } = renderHook(() => usePermission())
    expect(result.current.can('admin:roles', 'create')).toBe(true)
    expect(result.current.permissions.length).toBeGreaterThan(0)
  })

  it('查看者 can 对导出返回 false', () => {
    setRole('viewer')
    const { result } = renderHook(() => usePermission())
    expect(result.current.can('dashboard', 'view')).toBe(true)
    expect(result.current.can('dashboard', 'export')).toBe(false)
  })

  it('未登录时 can 恒为 false 且 permissions 为空', () => {
    const { result } = renderHook(() => usePermission())
    expect(result.current.can('dashboard', 'view')).toBe(false)
    expect(result.current.permissions).toEqual([])
  })
})
