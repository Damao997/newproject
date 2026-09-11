import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePermission } from '@/hooks/usePermission'
import { useAuthStore } from '@/stores/authStore'
import type { User, UserRole } from '@/types'

function makeUser(role: UserRole, permissions?: string[]): User {
  return {
    id: '1',
    username: 'u',
    name: 'U',
    role,
    permissions,
    dataScope: '*',
    status: 'active',
    createdAt: '',
    updatedAt: '',
  }
}

function setRole(role: UserRole, permissions?: string[]) {
  useAuthStore.setState({ user: makeUser(role, permissions), isAuthenticated: true })
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

  it('后端下发 permissions 时优先使用（支持自定义角色）', () => {
    // 自定义角色码不在静态矩阵中，仅靠后端权限列表生效
    setRole('custom_auditor' as UserRole, ['dashboard:view', 'reports:view'])
    const { result } = renderHook(() => usePermission())
    expect(result.current.can('dashboard', 'view')).toBe(true)
    expect(result.current.can('reports', 'view')).toBe(true)
    expect(result.current.can('admin:users', 'view')).toBe(false)
    expect(result.current.permissions).toEqual(['dashboard:view', 'reports:view'])
  })

  it('后端 permissions 优先于静态矩阵（不取并集）', () => {
    // viewer 静态矩阵含 dashboard:view，但后端仅下发 reports:view 时以后端为准
    setRole('viewer', ['reports:view'])
    const { result } = renderHook(() => usePermission())
    expect(result.current.can('reports', 'view')).toBe(true)
    expect(result.current.can('dashboard', 'view')).toBe(false)
  })

  it('旧会话未携带 permissions 时回退静态矩阵', () => {
    setRole('viewer', undefined)
    const { result } = renderHook(() => usePermission())
    expect(result.current.can('dashboard', 'view')).toBe(true)
    expect(result.current.can('dashboard', 'export')).toBe(false)
  })
})
