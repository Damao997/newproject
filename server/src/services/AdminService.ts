import type { PermissionAction } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { hashPassword } from '../lib/password'
import { buildExcel } from '../lib/excel'

/**
 * 权限管理服务：用户 / 角色 / 权限 / 审计日志。
 * 预置角色（is_system）权限只读；停用角色前校验活跃用户绑定。
 * 防越级提权：目标角色权限集必须是操作者权限集的子集（不硬编码角色名）。
 */

interface AuditCtx { userId: string; traceId?: string; actorRoleId?: string }

interface UserRow {
  id: string; username: string; displayName: string; companyCode: string | null
  dataScopeCodes?: unknown
  status: string; createdAt: Date; updatedAt: Date; role: { code: string; scopeValue: string }
}

function userDto(u: UserRow) {
  const codes = Array.isArray(u.dataScopeCodes) ? (u.dataScopeCodes as string[]) : []
  let dataScope: string
  if (codes.length > 0) dataScope = codes.join(',')
  else if (u.companyCode) dataScope = u.companyCode
  else if (u.role.scopeValue === '*') dataScope = '全部'
  else dataScope = '无'
  return {
    id: u.id, username: u.username, name: u.displayName, role: u.role.code, dataScope,
    dataScopeCodes: codes,
    status: u.status, createdAt: u.createdAt.toISOString(), updatedAt: u.updatedAt.toISOString(),
  }
}

const USER_INCLUDE = { role: { select: { code: true, scopeValue: true } } } as const

/** 密码规则（与 auth 改密 updatePasswordSchema 一致）：至少 8 位且含字母与数字 */
function assertPasswordRule(password: string): void {
  if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw errors.badRequest('密码至少 8 位，且需同时包含字母与数字')
  }
}

/**
 * 校验并归一化多选数据范围：去重后逐一核对 company 表存在且启用。
 * 汇总主体编码不直接落库：按 CompanyAggregationMap 自动展开为其成员单体（与手动勾选的单体去重合并），
 * 无映射成员的汇总主体 → 400（与 resolveScope 默认拒绝口径一致）；汇总可见性由「全有或全无」机制运行时推导。
 * 未提供时返回 undefined（不触碰）；空数组表示清空（回退到角色 scopeValue）。
 */
async function normalizeDataScopeCodes(codes: unknown): Promise<string[] | undefined> {
  if (codes === undefined || codes === null) return undefined
  if (!Array.isArray(codes) || codes.some((c) => typeof c !== 'string')) {
    throw errors.badRequest('数据范围格式不正确，应为公司编码数组')
  }
  const unique = [...new Set((codes as string[]).map((c) => c.trim()).filter(Boolean))]
  if (unique.length === 0) return []
  const found = await prisma.company.findMany({
    where: { code: { in: unique }, status: 'active' },
    select: { code: true, entityType: true },
  })
  const foundMap = new Map(found.map((c) => [c.code, c.entityType]))
  const invalid = unique.filter((c) => !foundMap.has(c))
  if (invalid.length > 0) throw errors.badRequest(`数据范围包含无效的公司编码：${invalid.join('、')}`)
  // 汇总主体 → 展开为成员单体后落库；单体直接保留
  const singles = new Set(unique.filter((c) => foundMap.get(c) === 'single'))
  const summaries = unique.filter((c) => foundMap.get(c) === 'summary')
  if (summaries.length > 0) {
    const maps = await prisma.companyAggregationMap.findMany({
      where: { summaryCompanyCode: { in: summaries } },
      select: { summaryCompanyCode: true, singleCompanyCode: true },
    })
    const membersBySummary = new Map<string, string[]>()
    for (const m of maps) {
      const list = membersBySummary.get(m.summaryCompanyCode) ?? []
      list.push(m.singleCompanyCode)
      membersBySummary.set(m.summaryCompanyCode, list)
    }
    const empty = summaries.filter((s) => !membersBySummary.has(s) || membersBySummary.get(s)!.length === 0)
    if (empty.length > 0) {
      throw errors.badRequest(`数据范围包含无成员映射的汇总主体：${empty.join('、')}`)
    }
    for (const s of summaries) for (const member of membersBySummary.get(s)!) singles.add(member)
  }
  return [...singles]
}

/**
 * 防越级提权守卫：目标角色的权限集必须是操作者角色权限集的子集。
 * 覆盖场景：分配角色、修改/停用/重置密码/删除高权限账号。
 * 依据《安全与权限规范》§2.1：不硬编码 if(role==='xxx')，统一走权限集合判定。
 */
async function assertRoleAssignable(actorRoleId: string | undefined, targetRoleId: string): Promise<void> {
  if (!actorRoleId) throw errors.forbidden('缺少操作者角色上下文')
  if (actorRoleId === targetRoleId) return
  const [actorPerms, targetPerms] = await Promise.all([
    prisma.permission.findMany({ where: { roleId: actorRoleId }, select: { resource: true, action: true } }),
    prisma.permission.findMany({ where: { roleId: targetRoleId }, select: { resource: true, action: true } }),
  ])
  const actorSet = new Set(actorPerms.map((p) => `${p.resource}#${p.action}`))
  const escalated = targetPerms.some((p) => !actorSet.has(`${p.resource}#${p.action}`))
  if (escalated) throw errors.forbidden('不可操作或分配高于自身权限的角色')
}

/**
 * 系统失管保护：若目标用户是 superadmin 角色下最后一个活跃用户，禁止停用/降级/删除。
 */
async function assertNotLastSuperadmin(targetUserId: string): Promise<void> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, include: USER_INCLUDE })
  if (!target || target.role.code !== 'superadmin' || target.status !== 'active') return
  const activeCount = await prisma.user.count({ where: { role: { code: 'superadmin' }, status: 'active' } })
  if (activeCount <= 1) throw errors.conflict('不可停用或删除最后一个超级管理员')
}

export const AdminService = {
  // ===== 用户 =====
  async listUsers(params: { page: number; pageSize: number; keyword?: string }) {
    // 后台用户列表需同时展示启用/停用用户（停用后才能彻底删除/重新启用），
    // 显式传 status 以绕过软删除扩展的 active 默认过滤
    const where: Record<string, unknown> = { status: { in: ['active', 'inactive'] } }
    if (params.keyword) where.OR = [{ username: { contains: params.keyword } }, { displayName: { contains: params.keyword } }]
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, include: USER_INCLUDE, orderBy: { createdAt: 'asc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
      prisma.user.count({ where }),
    ])
    return { items: rows.map(userDto), total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },

  async createUser(input: { username: string; name?: string; password: string; role: string; companyCode?: string; dataScopeCodes?: string[] }, ctx: AuditCtx) {
    const exists = await prisma.user.findUnique({ where: { username: input.username } })
    if (exists) throw errors.conflict('用户名已存在')
    const role = await prisma.role.findUnique({ where: { code: input.role } })
    if (!role) throw errors.badRequest('角色不存在')
    await assertRoleAssignable(ctx.actorRoleId, role.id)
    assertPasswordRule(input.password)
    const scopeCodes = await normalizeDataScopeCodes(input.dataScopeCodes)
    const passwordHash = await hashPassword(input.password)
    const created = await prisma.user.create({
      data: {
        username: input.username, displayName: input.name ?? input.username, passwordHash, roleId: role.id,
        // 新用户首次登录须修改初始密码
        mustChangePassword: true,
        // 提供多选范围时由新字段全权接管，companyCode 置空；否则保留旧单值路径
        companyCode: scopeCodes !== undefined ? null : (input.companyCode ?? null),
        dataScopeCodes: scopeCodes !== undefined ? scopeCodes : undefined,
      },
      include: USER_INCLUDE,
    })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'user_create', targetId: created.id }, ctx.traceId)
    return userDto(created)
  },

  async updateUser(id: string, input: { name?: string; role?: string; companyCode?: string | null; dataScopeCodes?: string[]; status?: string }, ctx: AuditCtx) {
    const found = await prisma.user.findUnique({ where: { id } })
    if (!found) throw errors.notFound('用户不存在')
    // 防提权：不可操作高于自身权限的账号
    await assertRoleAssignable(ctx.actorRoleId, found.roleId)
    const scopeCodes = await normalizeDataScopeCodes(input.dataScopeCodes)
    let roleId: string | undefined
    if (input.role) {
      const role = await prisma.role.findUnique({ where: { code: input.role } })
      if (!role) throw errors.badRequest('角色不存在')
      // 防提权：不可分配高于自身权限的角色
      await assertRoleAssignable(ctx.actorRoleId, role.id)
      roleId = role.id
    }
    // 降级角色或停用时，保护最后一个超级管理员
    if ((roleId && roleId !== found.roleId) || input.status === 'inactive') {
      await assertNotLastSuperadmin(id)
    }
    const updated = await prisma.user.update({
      where: { id },
      data: {
        displayName: input.name ?? undefined,
        roleId,
        // 提供多选范围时由新字段全权接管，companyCode 置空；未提供时保留旧单值路径
        companyCode: scopeCodes !== undefined ? null : (input.companyCode === undefined ? undefined : input.companyCode),
        dataScopeCodes: scopeCodes !== undefined ? scopeCodes : undefined,
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
    await assertRoleAssignable(ctx.actorRoleId, found.roleId)
    await assertNotLastSuperadmin(id)
    await prisma.user.update({ where: { id }, data: { status: 'inactive', refreshTokenJtiList: [] } })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'user_disable', targetId: id }, ctx.traceId)
  },

  /**
   * 物理删除用户（高危，仅 superadmin）。
   * 前置条件：目标已停用、非操作者本人、不越级、非最后一个超管。
   * AuditLog.userId 无外键，历史审计保留原始 ID。
   */
  async purgeUser(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.user.findUnique({ where: { id }, include: USER_INCLUDE })
    if (!found) throw errors.notFound('用户不存在')
    if (id === ctx.userId) throw errors.badRequest('不可删除自己的账号')
    if (found.status !== 'inactive') throw errors.badRequest('请先停用该用户再彻底删除')
    await assertRoleAssignable(ctx.actorRoleId, found.roleId)
    try {
      await prisma.user.delete({ where: { id } })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2003') throw errors.conflict('存在关联数据，无法彻底删除')
      throw e
    }
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'user_purge', targetId: id, detail: { username: found.username, role: found.role.code } }, ctx.traceId)
  },

  async resetPassword(id: string, newPassword: string, ctx: AuditCtx): Promise<void> {
    assertPasswordRule(newPassword)
    const found = await prisma.user.findUnique({ where: { id } })
    if (!found) throw errors.notFound('用户不存在')
    await assertRoleAssignable(ctx.actorRoleId, found.roleId)
    const passwordHash = await hashPassword(newPassword)
    await prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, refreshTokenJtiList: [] } })
    await recordAudit({ userId: ctx.userId, module: 'admin', action: 'update', targetId: id, detail: { action: 'reset_password' } }, ctx.traceId)
  },

  async exportUsers(): Promise<Buffer> {
    // 导出同样需包含停用用户，显式传 status 绕过软删除默认过滤
    const rows = await prisma.user.findMany({ where: { status: { in: ['active', 'inactive'] } }, include: USER_INCLUDE, orderBy: { createdAt: 'asc' } })
    return buildExcel('用户列表', [
      { header: '用户名', key: 'username' }, { header: '姓名', key: 'name', width: 20 },
      { header: '角色', key: 'role', width: 20 }, { header: '数据范围', key: 'dataScope', width: 20 },
      { header: '状态', key: 'status' },
    ], rows.map(userDto).map((u) => ({ username: u.username, name: u.name, role: u.role, dataScope: u.dataScope, status: u.status })))
  },

  // ===== 角色 =====
  async listRoles() {
    const rows = await prisma.role.findMany({
      include: { permissions: { select: { id: true, resource: true, action: true } }, _count: { select: { users: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, isSystem: r.isSystem, scopeValue: r.scopeValue, userCount: r._count.users, createdAt: r.createdAt.toISOString(), permissions: r.permissions }))
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

  async updateRolePermissions(roleId: string, permissions: { resource: string; action: PermissionAction }[], ctx: AuditCtx): Promise<void> {
    const role = await prisma.role.findUnique({ where: { id: roleId }, include: { permissions: { select: { resource: true, action: true } } } })
    if (!role) throw errors.notFound('角色不存在')
    // 系统失管保护：superadmin 角色权限集固定为全量，禁止修改；其余角色（含预置）均可编辑
    if (role.code === 'superadmin') throw errors.forbidden('超级管理员角色权限不可修改')
    const keyOf = (p: { resource: string; action: PermissionAction }) => `${p.resource}#${p.action}`
    const beforeKeys = new Set(role.permissions.map(keyOf))
    const afterKeys = new Set(permissions.map(keyOf))
    const added = permissions.filter((p) => !beforeKeys.has(keyOf(p))).map((p) => p.resource)
    const removed = role.permissions.filter((p) => !afterKeys.has(keyOf(p))).map((p) => p.resource)
    await prisma.$transaction(async (tx) => {
      await tx.permission.deleteMany({ where: { roleId } })
      if (permissions.length > 0) {
        await tx.permission.createMany({ data: permissions.map((p) => ({ roleId, resource: p.resource, action: p.action })), skipDuplicates: true })
      }
    })
    // detail 仅记录权限码变更摘要，便于审计追溯
    await recordAudit({
      userId: ctx.userId, module: 'admin', action: 'permission_change', targetId: roleId,
      detail: { role: role.code, before: role.permissions.length, after: permissions.length, added, removed },
    }, ctx.traceId)
  },

  /** 批量覆盖多角色权限：事务内逐角色替换并审计；superadmin 恒受保护，任一角色不存在则整体失败回滚 */
  async updateRolePermissionsBatch(roleIds: string[], permissions: { resource: string; action: PermissionAction }[], ctx: AuditCtx): Promise<void> {
    const roles = await prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, code: true } })
    if (roles.length !== roleIds.length) throw errors.notFound('存在不存在的角色，请刷新后重试')
    const superRole = roles.find((r) => r.code === 'superadmin')
    if (superRole) throw errors.forbidden('超级管理员角色权限不可修改')
    await prisma.$transaction(async (tx) => {
      for (const role of roles) {
        await tx.permission.deleteMany({ where: { roleId: role.id } })
        if (permissions.length > 0) {
          await tx.permission.createMany({ data: permissions.map((p) => ({ roleId: role.id, resource: p.resource, action: p.action })), skipDuplicates: true })
        }
      }
    })
    await recordAudit({
      userId: ctx.userId, module: 'admin', action: 'permission_change', targetId: roles[0].id,
      detail: { action: 'batch', roles: roles.map((r) => r.code), roleCount: roles.length, after: permissions.length },
    }, ctx.traceId)
  },

  // ===== 审计日志 =====
  async listAuditLogs(params: {
    page: number; pageSize: number; module?: string; action?: string; q?: string
    role?: string; username?: string; startDate?: string; endDate?: string
  }) {
    const where: Record<string, unknown> = {}
    if (params.module) where.module = params.module
    if (params.action) where.action = params.action
    // 高级搜索关键词：raw 预筛命中 id（target_id / detail 全文 ILIKE，忽略大小写），
    // 再与主查询其他条件 AND 组合；上限 5000 条防命中集过大（超出静默截断，与导出上限一致）
    if (params.q) {
      const like = `%${params.q}%`
      const hits = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM audit_log
        WHERE target_id ILIKE ${like} OR detail::text ILIKE ${like}
        LIMIT 5000`
      const hitIds = hits.map((h) => h.id)
      where.id = { in: hitIds.length > 0 ? hitIds : ['__no_match__'] }
    }
    // 按操作用户的角色/用户名关键字筛选（关联 user 过滤，自然排除无用户的记录）
    const userWhere: Record<string, unknown> = {}
    if (params.role) userWhere.role = { code: params.role }
    if (params.username) userWhere.username = { contains: params.username, mode: 'insensitive' }
    if (Object.keys(userWhere).length > 0) where.user = userWhere
    // 时间范围：endDate 取当日末尾，保证闭区间语义
    const createdAt: Record<string, Date> = {}
    if (params.startDate) createdAt.gte = new Date(`${params.startDate}T00:00:00`)
    if (params.endDate) createdAt.lte = new Date(`${params.endDate}T23:59:59.999`)
    if (Object.keys(createdAt).length > 0) where.createdAt = createdAt
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
      ip: r.ip,
      userAgent: r.userAgent,
      targetId: r.targetId,
    }))
    return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },

  /** 今日审计统计：总数 + 按 module 分组计数（头部「今日 N 条」与分类 pills 用） */
  async todayAuditStats(): Promise<{ total: number; byModule: Record<string, number> }> {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 1)
    const where = { createdAt: { gte: start, lt: end } }
    const [total, groups] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.groupBy({ by: ['module'], where, _count: { _all: true } }),
    ])
    const byModule: Record<string, number> = {}
    groups.forEach((g) => { byModule[g.module] = g._count._all })
    return { total, byModule }
  },
}
