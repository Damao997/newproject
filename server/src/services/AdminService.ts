import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { hashPassword } from '../lib/password'
import { buildExcel } from '../lib/excel'

/**
 * 权限管理服务：用户 / 角色 / 权限 / 审计日志。
 * 预置角色（is_system）权限只读；停用角色前校验活跃用户绑定。
 */

interface AuditCtx { userId: string; traceId?: string }

interface UserRow {
  id: string; username: string; displayName: string; companyCode: string | null
  status: string; createdAt: Date; updatedAt: Date; role: { code: string; scopeValue: string }
}

function userDto(u: UserRow) {
  let dataScope: string
  if (u.companyCode) dataScope = u.companyCode
  else if (u.role.scopeValue === '*') dataScope = '全部'
  else dataScope = '无'
  return {
    id: u.id, username: u.username, name: u.displayName, role: u.role.code, dataScope,
    status: u.status, createdAt: u.createdAt.toISOString(), updatedAt: u.updatedAt.toISOString(),
  }
}

const USER_INCLUDE = { role: { select: { code: true, scopeValue: true } } } as const

export const AdminService = {
  // ===== 用户 =====
  async listUsers(params: { page: number; pageSize: number; keyword?: string }) {
    const where: Record<string, unknown> = {}
    if (params.keyword) where.OR = [{ username: { contains: params.keyword } }, { displayName: { contains: params.keyword } }]
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, include: USER_INCLUDE, orderBy: { createdAt: 'asc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
      prisma.user.count({ where }),
    ])
    return { items: rows.map(userDto), total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },

  async createUser(input: { username: string; name?: string; password: string; role: string; companyCode?: string }, ctx: AuditCtx) {
    const exists = await prisma.user.findUnique({ where: { username: input.username } })
    if (exists) throw errors.conflict('用户名已存在')
    const role = await prisma.role.findUnique({ where: { code: input.role } })
    if (!role) throw errors.badRequest('角色不存在')
    if (!input.password || input.password.length < 8) throw errors.badRequest('初始密码至少 8 位')
    const passwordHash = await hashPassword(input.password)
    const created = await prisma.user.create({
      data: {
        username: input.username, displayName: input.name ?? input.username, passwordHash, roleId: role.id,
        companyCode: input.companyCode ?? null,
      },
      include: USER_INCLUDE,
    })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'user_create', targetId: created.id }, ctx.traceId)
    return userDto(created)
  },

  async updateUser(id: string, input: { name?: string; role?: string; companyCode?: string | null; status?: string }, ctx: AuditCtx) {
    const found = await prisma.user.findUnique({ where: { id } })
    if (!found) throw errors.notFound('用户不存在')
    let roleId: string | undefined
    if (input.role) {
      const role = await prisma.role.findUnique({ where: { code: input.role } })
      if (!role) throw errors.badRequest('角色不存在')
      roleId = role.id
    }
    const updated = await prisma.user.update({
      where: { id },
      data: {
        displayName: input.name ?? undefined,
        roleId,
        companyCode: input.companyCode === undefined ? undefined : input.companyCode,
        status: input.status === 'inactive' ? 'inactive' : input.status === 'active' ? 'active' : undefined,
      },
      include: USER_INCLUDE,
    })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'update', targetId: id }, ctx.traceId)
    return userDto(updated)
  },

  async disableUser(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.user.findUnique({ where: { id } })
    if (!found) throw errors.notFound('用户不存在')
    await prisma.user.update({ where: { id }, data: { status: 'inactive', refreshTokenJti: null } })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'user_disable', targetId: id }, ctx.traceId)
  },

  async resetPassword(id: string, newPassword: string, ctx: AuditCtx): Promise<void> {
    if (!newPassword || newPassword.length < 8) throw errors.badRequest('新密码至少 8 位')
    const found = await prisma.user.findUnique({ where: { id } })
    if (!found) throw errors.notFound('用户不存在')
    const passwordHash = await hashPassword(newPassword)
    await prisma.user.update({ where: { id }, data: { passwordHash, refreshTokenJti: null } })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'update', targetId: id, detail: { action: 'reset_password' } }, ctx.traceId)
  },

  async exportUsers(): Promise<Buffer> {
    const rows = await prisma.user.findMany({ include: USER_INCLUDE, orderBy: { createdAt: 'asc' } })
    return buildExcel('用户列表', [
      { header: '用户名', key: 'username' }, { header: '姓名', key: 'name', width: 20 },
      { header: '角色', key: 'role', width: 20 }, { header: '数据范围', key: 'dataScope', width: 20 },
      { header: '状态', key: 'status' },
    ], rows.map(userDto).map((u) => ({ username: u.username, name: u.name, role: u.role, dataScope: u.dataScope, status: u.status })))
  },

  // ===== 角色 =====
  async listRoles() {
    const rows = await prisma.role.findMany({ include: { permissions: { select: { id: true, resource: true, action: true } } }, orderBy: { createdAt: 'asc' } })
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, isSystem: r.isSystem, scopeValue: r.scopeValue, permissions: r.permissions }))
  },

  async createRole(input: { code: string; name: string; description?: string; scopeValue?: string }, ctx: AuditCtx) {
    const exists = await prisma.role.findUnique({ where: { code: input.code } })
    if (exists) throw errors.conflict('角色编码已存在')
    const created = await prisma.role.create({ data: { code: input.code, name: input.name, description: input.description ?? null, scopeValue: input.scopeValue ?? '', isSystem: false } })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'role_change', targetId: created.id, detail: { action: 'create' } }, ctx.traceId)
    return { id: created.id, code: created.code, name: created.name, description: created.description, isSystem: created.isSystem, permissions: [] }
  },

  async updateRole(id: string, input: { name?: string; description?: string; scopeValue?: string; status?: string }, ctx: AuditCtx) {
    const found = await prisma.role.findUnique({ where: { id } })
    if (!found) throw errors.notFound('角色不存在')
    if (found.isSystem && (input.scopeValue !== undefined)) throw errors.forbidden('预置角色核心属性只读')
    const updated = await prisma.role.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        description: input.description ?? undefined,
        scopeValue: found.isSystem ? undefined : (input.scopeValue ?? undefined),
        status: input.status === 'inactive' ? 'inactive' : input.status === 'active' ? 'active' : undefined,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'role_change', targetId: id, detail: { action: 'update' } }, ctx.traceId)
    return { id: updated.id, code: updated.code, name: updated.name, description: updated.description, isSystem: updated.isSystem }
  },

  async deleteRole(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.role.findUnique({ where: { id } })
    if (!found) throw errors.notFound('角色不存在')
    if (found.isSystem) throw errors.forbidden('预置角色不可删除')
    const activeUsers = await prisma.user.count({ where: { roleId: id, status: 'active' } })
    if (activeUsers > 0) throw errors.conflict('该角色仍有活跃用户，无法删除')
    await prisma.role.delete({ where: { id } })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'role_change', targetId: id, detail: { action: 'delete' } }, ctx.traceId)
  },

  async cloneRole(id: string, newName: string, ctx: AuditCtx) {
    const src = await prisma.role.findUnique({ where: { id }, include: { permissions: true } })
    if (!src) throw errors.notFound('角色不存在')
    const code = `${src.code}_copy_${Date.now().toString(36)}`
    const created = await prisma.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { code, name: newName, description: src.description, scopeValue: src.scopeValue, isSystem: false } })
      if (src.permissions.length > 0) {
        await tx.permission.createMany({ data: src.permissions.map((p) => ({ roleId: role.id, resource: p.resource, action: p.action, scopeType: p.scopeType, scopeValue: p.scopeValue })) })
      }
      return role
    })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'role_change', targetId: created.id, detail: { action: 'clone', from: id } }, ctx.traceId)
    return { id: created.id, code: created.code, name: created.name, description: created.description, isSystem: created.isSystem }
  },

  // ===== 权限 =====
  async listPermissions() {
    const rows = await prisma.permission.findMany({ distinct: ['resource', 'action'], select: { resource: true, action: true }, orderBy: [{ resource: 'asc' }, { action: 'asc' }] })
    return rows.map((r, i) => ({ id: String(i + 1), resource: r.resource, action: r.action }))
  },

  async updateRolePermissions(roleId: string, permissions: { resource: string; action: string }[], ctx: AuditCtx): Promise<void> {
    const role = await prisma.role.findUnique({ where: { id: roleId } })
    if (!role) throw errors.notFound('角色不存在')
    if (role.isSystem) throw errors.forbidden('预置角色权限只读，不可修改')
    await prisma.$transaction(async (tx) => {
      await tx.permission.deleteMany({ where: { roleId } })
      if (permissions.length > 0) {
        await tx.permission.createMany({ data: permissions.map((p) => ({ roleId, resource: p.resource, action: p.action })), skipDuplicates: true })
      }
    })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'permission_change', targetId: roleId }, ctx.traceId)
  },

  // ===== 审计日志 =====
  async listAuditLogs(params: { page: number; pageSize: number; module?: string; action?: string }) {
    const where: Record<string, unknown> = {}
    if (params.module) where.module = params.module
    if (params.action) where.action = params.action
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
      prisma.auditLog.count({ where }),
    ])
    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[]
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
    const nameMap = new Map(users.map((u) => [u.id, u.username]))
    const items = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      username: r.userId ? (nameMap.get(r.userId) ?? r.userId) : '-',
      module: r.module,
      action: r.action,
      detail: r.detail ? JSON.stringify(r.detail) : '',
    }))
    return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },
}
