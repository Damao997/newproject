import { describe, it, expect } from 'vitest'
import { hasPermission, ROLE_PERMISSIONS } from '@/lib/permissions'

describe('hasPermission', () => {
  it('管理员拥有全部模块权限', () => {
    expect(hasPermission('admin', 'admin:roles', 'create')).toBe(true)
    expect(hasPermission('admin', 'data:import', 'upload')).toBe(true)
    expect(hasPermission('admin', 'inventory', 'delete')).toBe(true)
  })

  it('查看者仅有看板/指标/报告的查看权限', () => {
    expect(hasPermission('viewer', 'dashboard', 'view')).toBe(true)
    expect(hasPermission('viewer', 'indicators', 'view')).toBe(true)
    expect(hasPermission('viewer', 'reports', 'view')).toBe(true)
    // 查看者无任何导出权限
    expect(hasPermission('viewer', 'dashboard', 'export')).toBe(false)
    expect(hasPermission('viewer', 'indicators', 'export')).toBe(false)
    // 查看者无往来/存货/数据/权限管理
    expect(hasPermission('viewer', 'transactions', 'view')).toBe(false)
    expect(hasPermission('viewer', 'data:browse', 'view')).toBe(false)
  })

  it('财务分析师兼IT 可管理用户但不可操作角色/权限', () => {
    expect(hasPermission('finance_analyst_it', 'admin:users', 'create')).toBe(true)
    expect(hasPermission('finance_analyst_it', 'admin:users', 'reset-password')).toBe(true)
    expect(hasPermission('finance_analyst_it', 'admin:roles', 'create')).toBe(false)
    expect(hasPermission('finance_analyst_it', 'admin:permissions', 'update')).toBe(false)
  })

  it('部门经理无导入与数据结构管理权限', () => {
    expect(hasPermission('department_manager', 'dashboard', 'export')).toBe(true)
    expect(hasPermission('department_manager', 'data:import', 'upload')).toBe(false)
    expect(hasPermission('department_manager', 'data:metric', 'create')).toBe(false)
    expect(hasPermission('department_manager', 'inventory', 'create')).toBe(false)
  })

  it('财务主管有财务导入导出但无权限管理', () => {
    expect(hasPermission('finance_manager', 'data:import', 'upload')).toBe(true)
    expect(hasPermission('finance_manager', 'indicators', 'export')).toBe(true)
    expect(hasPermission('finance_manager', 'admin:users', 'view')).toBe(false)
  })

  it('未知角色或空角色返回 false', () => {
    expect(hasPermission(undefined, 'dashboard', 'view')).toBe(false)
    expect(hasPermission(null, 'dashboard', 'view')).toBe(false)
  })

  it('每个预置角色的权限集合非空且为字符串数组', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true)
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0)
    }
  })
})
