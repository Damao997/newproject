import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { DataService } from '../services/DataService'
import { AdminService } from '../services/AdminService'
import { FormulaRuleService } from '../services/FormulaRuleService'

/**
 * 数据/权限管理写路径集成测试（真实 DB）。
 * 创建的实体在 afterAll 清理。无 DB 时整组跳过。
 */

let dbReady = false
let adminId = ''
const tempMetricCodes: string[] = []
const tempUsernames: string[] = []
const tempRoleCodes: string[] = []

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const admin = await prisma.user.findUnique({ where: { username: 'admin' }, select: { id: true } })
    dbReady = !!admin
    if (admin) adminId = admin.id
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  const tempMetrics = await basePrisma.metric.findMany({ where: { code: { in: tempMetricCodes } }, select: { id: true } })
  const tempIds = tempMetrics.map((m) => m.id)
  await basePrisma.metricDefinitionHistory.deleteMany({ where: { metricId: { in: tempIds } } }).catch(() => undefined)
  await basePrisma.metric.deleteMany({ where: { code: { in: tempMetricCodes } } }).catch(() => undefined)
  await basePrisma.user.deleteMany({ where: { username: { in: tempUsernames } } }).catch(() => undefined)
  const tempRoles = await basePrisma.role.findMany({ where: { code: { in: tempRoleCodes } }, select: { id: true } })
  const roleIds = tempRoles.map((r) => r.id)
  await basePrisma.permission.deleteMany({ where: { roleId: { in: roleIds } } }).catch(() => undefined)
  await basePrisma.role.deleteMany({ where: { code: { in: tempRoleCodes } } }).catch(() => undefined)
})

const ctx = () => ({ userId: adminId, traceId: 'test' })

describe('科目 CRUD', () => {
  it('创建→更新→软删除（未引用科目）', async () => {
    if (!dbReady) return
    const code = `OP_TEST_${Date.now().toString(36)}`
    const created = await DataService.createSubject({ code, name: '测试科目', type: 'operating', level: 1, parentCode: 'OP_001', isLeaf: true }, ctx())
    expect(created.code).toBe(code)
    const updated = await DataService.updateSubject(created.id, { name: '测试科目改' }, ctx())
    expect(updated.name).toBe('测试科目改')
    await DataService.deleteSubject(created.id, ctx())
    const after = await basePrisma.accountSubject.findUnique({ where: { id: created.id }, select: { status: true } })
    expect(after?.status).toBe('inactive')
    await basePrisma.accountSubject.deleteMany({ where: { code } }).catch(() => undefined)
  })

  it('删除被事实引用的科目 → conflict', async () => {
    if (!dbReady) return
    const ref = await basePrisma.factOperating.findFirst({ select: { accountCode: true } })
    if (!ref) return // 无事实数据则跳过
    const subject = await basePrisma.accountSubject.findFirst({ where: { code: ref.accountCode }, select: { id: true } })
    if (!subject) return
    await expect(DataService.deleteSubject(subject.id, ctx())).rejects.toMatchObject({ code: 409 })
  })

  it('停用被事实引用的科目 → conflict', async () => {
    if (!dbReady) return
    const ref = await basePrisma.factOperating.findFirst({ select: { accountCode: true } })
    if (!ref) return
    const subject = await basePrisma.accountSubject.findFirst({ where: { code: ref.accountCode }, select: { id: true } })
    if (!subject) return
    await expect(DataService.updateSubject(subject.id, { status: 'inactive' }, ctx())).rejects.toMatchObject({ code: 409 })
  })

  it('getSubjectTree 返回 operating 树（含 dataType）', async () => {
    if (!dbReady) return
    const tree = await DataService.getSubjectTree('operating')
    expect(tree.length).toBeGreaterThan(0)
    expect(tree[0]).toHaveProperty('dataType')
    expect(tree.some((s) => s.parentCode === null)).toBe(true)
  })
})

describe('指标 CRUD', () => {
  it('创建 data 指标 → 更新 → 软删除', async () => {
    if (!dbReady) return
    const code = `CALC_M_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    const created = await DataService.createMetric({ code, name: '指标测试', dataType: 'data', category: '自定义' }, ctx())
    expect(created.dataType).toBe('data')
    const updated = await DataService.updateMetric(created.id, { name: '指标测试改' }, ctx())
    expect(updated.name).toBe('指标测试改')
    await DataService.deleteMetric(created.id, ctx())
    const after = await basePrisma.metric.findUnique({ where: { code } })
    expect(after?.status).toBe('inactive')
  })

  it('批量规则生成：命中项可应用落库', async () => {
    if (!dbReady) return
    const results = await FormulaRuleService.batchGenerate({ subjectType: 'operating' })
    const valid = results.filter((r) => r.valid && r.formula).slice(0, 1)
    if (valid.length === 0) return
    const res = await FormulaRuleService.batchApply(valid.map((r) => ({ code: r.code, formula: r.formula as string, dependsOn: r.dependsOn })), adminId, 'test')
    expect(res.applied).toBeGreaterThanOrEqual(1)
    const metric = await basePrisma.metric.findUnique({ where: { code: valid[0].code } })
    expect(metric?.formula).toBe(valid[0].formula)
  })
})

describe('用户与角色', () => {
  it('创建用户 → 停用', async () => {
    if (!dbReady) return
    const username = `test.user.${Date.now().toString(36)}`
    tempUsernames.push(username)
    const created = await AdminService.createUser({ username, name: '测试用户', password: 'Test@123456', role: 'viewer', companyCode: 'EN330059' }, ctx())
    expect(created.role).toBe('viewer')
    expect(created.dataScope).toBe('EN330059')
    await AdminService.disableUser(created.id, ctx())
    const after = await basePrisma.user.findUnique({ where: { username }, select: { status: true } })
    expect(after?.status).toBe('inactive')
  })

  it('创建角色 → 改权限 → 克隆 → 删除', async () => {
    if (!dbReady) return
    const code = `role_${Date.now().toString(36)}`
    tempRoleCodes.push(code)
    const role = await AdminService.createRole({ code, name: '测试角色', scopeValue: '' }, ctx())
    await AdminService.updateRolePermissions(role.id, [{ resource: 'dashboard:view', action: 'view' }], ctx())
    const perms = await basePrisma.permission.count({ where: { roleId: role.id } })
    expect(perms).toBe(1)
    const cloned = await AdminService.cloneRole(role.id, '测试角色副本', ctx())
    tempRoleCodes.push(cloned.code)
    expect(cloned.id).not.toBe(role.id)
    // 预置角色权限只读
    const adminRole = await basePrisma.role.findUnique({ where: { code: 'admin' }, select: { id: true } })
    await expect(AdminService.updateRolePermissions(adminRole!.id, [], ctx())).rejects.toMatchObject({ code: 403 })
  })

  it('权限清单与审计日志分页', async () => {
    if (!dbReady) return
    const perms = await AdminService.listPermissions()
    expect(perms.length).toBeGreaterThan(0)
    const logs = await AdminService.listAuditLogs({ page: 1, pageSize: 10 })
    expect(logs.total).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(logs.items)).toBe(true)
  })
})
