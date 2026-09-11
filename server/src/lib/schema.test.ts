import { describe, it, expect } from 'vitest'
import { updateRolePermissionsSchema, permissionActionSchema } from './schema'

/**
 * 角色权限入参校验单测（B5）。
 * 背景：PUT /admin/roles/:id/permissions 原先无校验，req.body.permissions
 * 直达 prisma.createMany —— 非法 action 会由 PG 抛 22P02 变成 500，
 * 且拼写错误的 resource 会静默成为永不命中的死权限。
 */

describe('permissionActionSchema', () => {
  it.each(['view', 'create', 'update', 'delete', 'export', 'import', 'approve'])(
    '接受合法 action：%s',
    (action) => {
      expect(permissionActionSchema.safeParse(action).success).toBe(true)
    },
  )

  it.each(['viewx', 'View', 'VIEW', 'read', 'purge', '', 'view ', 'approve;'])(
    '拒绝非法 action：%j',
    (action) => {
      expect(permissionActionSchema.safeParse(action).success).toBe(false)
    },
  )
})

describe('updateRolePermissionsSchema', () => {
  it('接受二段式与三段式资源码', () => {
    const r = updateRolePermissionsSchema.safeParse({
      permissions: [
        { resource: 'tools:view', action: 'view' },
        { resource: 'data:import:upload', action: 'import' },
        { resource: 'admin:users:reset-password', action: 'update' },
        { resource: 'data:metric:approve', action: 'approve' },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('接受空数组（清空角色权限是合法操作）', () => {
    expect(updateRolePermissionsSchema.safeParse({ permissions: [] }).success).toBe(true)
  })

  it('缺少 permissions 字段 → 拒绝', () => {
    expect(updateRolePermissionsSchema.safeParse({}).success).toBe(false)
  })

  it('非法 action 被拦下（此前会直达 createMany）', () => {
    const r = updateRolePermissionsSchema.safeParse({
      permissions: [{ resource: 'data:browse:view', action: 'destroy' }],
    })
    expect(r.success).toBe(false)
  })

  it.each([
    ['单段式（缺子级）', 'dashboard'],
    ['四段式（超出三段）', 'a:b:c:d'],
    ['含大写', 'Data:browse:view'],
    ['含下划线', 'data:browse_view'],
    ['含空格', 'data: browse'],
    ['SQL 注入样式', "data:browse'--"],
    ['空字符串', ''],
  ])('拒绝非法 resource —— %s', (_label, resource) => {
    const r = updateRolePermissionsSchema.safeParse({
      permissions: [{ resource, action: 'view' }],
    })
    expect(r.success).toBe(false)
  })

  it('条目数超上限 → 拒绝（防批量写入放大）', () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ resource: `m${i}:view`, action: 'view' as const }))
    expect(updateRolePermissionsSchema.safeParse({ permissions: many }).success).toBe(false)
  })

  it('resource 两端空白被 trim', () => {
    const r = updateRolePermissionsSchema.parse({
      permissions: [{ resource: '  tools:view  ', action: 'view' }],
    })
    expect(r.permissions[0]?.resource).toBe('tools:view')
  })
})
