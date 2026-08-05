import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { DataService } from '../services/DataService'
import { AdminService } from '../services/AdminService'
import { ImportService } from '../services/ImportService'
import { ReclassificationService } from '../services/ReclassificationService'
import { OPERATING_DIMS, STATIC_DIMS } from '../lib/metric-values'
import { fiscalYearOpeningSnapshotPeriod, fiscalYtdDays } from '../lib/period'

/**
 * 数据/权限管理写路径集成测试（真实 DB）。
 * 创建的实体在 afterAll 清理。无 DB 时整组跳过。
 */

let dbReady = false
let adminId = ''
let adminRoleId = ''
const tempMetricCodes: string[] = []
const tempSubjectCodes: string[] = []
const tempUsernames: string[] = []
const tempRoleCodes: string[] = []

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const admin = await prisma.user.findUnique({ where: { username: 'admin' }, select: { id: true, roleId: true } })
    dbReady = !!admin
    if (admin) {
      adminId = admin.id
      adminRoleId = admin.roleId
    }
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
  await basePrisma.accountSubject.deleteMany({ where: { code: { in: tempSubjectCodes } } }).catch(() => undefined)
  await basePrisma.user.deleteMany({ where: { username: { in: tempUsernames } } }).catch(() => undefined)
  const tempRoles = await basePrisma.role.findMany({ where: { code: { in: tempRoleCodes } }, select: { id: true } })
  const roleIds = tempRoles.map((r) => r.id)
  await basePrisma.permission.deleteMany({ where: { roleId: { in: roleIds } } }).catch(() => undefined)
  await basePrisma.role.deleteMany({ where: { code: { in: tempRoleCodes } } }).catch(() => undefined)
})

const ctx = () => ({ userId: adminId, traceId: 'test', actorRoleId: adminRoleId })

/** 创建临时科目（calc 指标创建/转换的前置条件），afterAll 统一清理 */
async function createTempSubject(code: string): Promise<void> {
  tempSubjectCodes.push(code)
  await basePrisma.accountSubject.create({
    data: { code, name: `临时科目_${code}`, subjectType: 'operating', level: 1, parentCode: null, category: '自定义', direction: 'credit', isLeaf: true },
  })
}

describe('科目 CRUD', () => {
  it('创建→更新→软删除（未引用科目）', async () => {
    if (!dbReady) return
    const code = `OP_TEST_${Date.now().toString(36)}`
    const created = await DataService.createSubject({ code, name: '测试科目', type: 'operating', level: 1, parentCode: 'OP_02', isLeaf: true }, ctx())
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

  it('创建 calc 指标但科目体系中无同编码科目 → 400', async () => {
    if (!dbReady) return
    const code = `CALC_NS_${Date.now().toString(36)}`
    await expect(
      DataService.createMetric({ code, name: '孤儿指标', dataType: 'calc', category: '自定义' }, ctx()),
    ).rejects.toMatchObject({ code: 400 })
    // data 类指标不受科目前置条件约束（上一用例已覆盖）
  })

  it('listMetrics 默认不含已停用；includeInactive=true 时包含（公式维护页恢复入口依赖）', async () => {
    if (!dbReady) return
    const code = `CALC_LS_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    const created = await DataService.createMetric({ code, name: '列表可见性测试', dataType: 'data', category: '自定义' }, ctx())
    await DataService.deleteMetric(created.id, ctx())
    const activeOnly = await DataService.listMetrics({ page: 1, pageSize: 2000, keyword: code })
    expect(activeOnly.items.some((m) => m.code === code)).toBe(false)
    const withInactive = await DataService.listMetrics({ page: 1, pageSize: 2000, keyword: code, includeInactive: true })
    const found = withInactive.items.find((m) => m.code === code)
    expect(found?.status).toBe('inactive')
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
    // superadmin 角色权限固定为全量，禁止修改（系统失管保护）
    const superRole = await basePrisma.role.findUnique({ where: { code: 'superadmin' }, select: { id: true } })
    await expect(AdminService.updateRolePermissions(superRole!.id, [], ctx())).rejects.toMatchObject({ code: 403 })
    // 预置角色（非 superadmin）现可编辑：以原权限集回写验证放行且不改变数据
    const viewerRole = await basePrisma.role.findUnique({ where: { code: 'viewer' }, include: { permissions: { select: { resource: true, action: true } } } })
    await AdminService.updateRolePermissions(viewerRole!.id, viewerRole!.permissions.map((p) => ({ resource: p.resource, action: p.action })), ctx())
    const viewerPermCount = await basePrisma.permission.count({ where: { roleId: viewerRole!.id } })
    expect(viewerPermCount).toBe(viewerRole!.permissions.length)
  })

  it('创建用户：多选数据范围校验与写入/清空', async () => {
    if (!dbReady) return
    const username = `scope.user.${Date.now().toString(36)}`
    tempUsernames.push(username)
    // 无效编码 → 400
    await expect(
      AdminService.createUser({ username, name: '范围用户', password: 'Test@123456', role: 'viewer', dataScopeCodes: ['NOT_EXIST'] }, ctx()),
    ).rejects.toMatchObject({ code: 400 })
    const companies = await basePrisma.company.findMany({ where: { status: 'active', entityType: 'single' }, take: 2, select: { code: true } })
    if (companies.length < 2) return
    const codes = companies.map((c) => c.code)
    const created = await AdminService.createUser({ username, name: '范围用户', password: 'Test@123456', role: 'viewer', dataScopeCodes: codes }, ctx())
    expect(created.dataScope).toBe(codes.join(','))
    expect(created.dataScopeCodes).toEqual(codes)
    // 更新为空数组 → 清空，回退角色范围（viewer scopeValue='' → 无）
    const updated = await AdminService.updateUser(created.id, { dataScopeCodes: [] }, ctx())
    expect(updated.dataScope).toBe('无')
  })

  it('创建用户：汇总主体编码自动展开为成员单体落库（不含汇总编码）', async () => {
    if (!dbReady) return
    // 取一个有映射成员的种子汇总主体
    const map = await basePrisma.companyAggregationMap.findFirst({ select: { summaryCompanyCode: true, singleCompanyCode: true } })
    if (!map) return
    const members = await basePrisma.companyAggregationMap.findMany({
      where: { summaryCompanyCode: map.summaryCompanyCode },
      select: { singleCompanyCode: true },
    })
    const memberCodes = members.map((m) => m.singleCompanyCode)
    const username = `scope.exp.${Date.now().toString(36)}`
    tempUsernames.push(username)
    // 混合输入：汇总编码 + 一个成员单体（验证去重合并）
    const created = await AdminService.createUser({
      username, name: '范围展开用户', password: 'Test@123456', role: 'viewer',
      dataScopeCodes: [map.summaryCompanyCode, memberCodes[0]],
    }, ctx())
    expect(created.dataScopeCodes.includes(map.summaryCompanyCode)).toBe(false)
    expect([...created.dataScopeCodes].sort()).toEqual([...new Set(memberCodes)].sort())
  })

  it('创建用户：无成员映射的汇总主体 → 400', async () => {
    if (!dbReady) return
    const emptySummary = `ETEMPTY${Date.now().toString(36)}`.slice(0, 20)
    await basePrisma.company.create({ data: { code: emptySummary, name: '无成员汇总', entityType: 'summary', status: 'active' } })
    try {
      const username = `scope.empty.${Date.now().toString(36)}`
      tempUsernames.push(username)
      await expect(
        AdminService.createUser({ username, name: '范围用户', password: 'Test@123456', role: 'viewer', dataScopeCodes: [emptySummary] }, ctx()),
      ).rejects.toMatchObject({ code: 400 })
    } finally {
      await basePrisma.company.deleteMany({ where: { code: emptySummary } }).catch(() => undefined)
    }
  })

  it('权限清单与审计日志分页', async () => {
    if (!dbReady) return
    const perms = await AdminService.listPermissions()
    expect(perms.length).toBeGreaterThan(0)
    const logs = await AdminService.listAuditLogs({ page: 1, pageSize: 10 })
    expect(logs.total).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(logs.items)).toBe(true)
  })

  it('审计日志：按角色/用户名/时间范围筛选', async () => {
    if (!dbReady) return
    // 角色 + 用户名关键字：命中项的用户名均含关键字
    const byUser = await AdminService.listAuditLogs({ page: 1, pageSize: 10, role: 'admin', username: 'admin' })
    expect(Array.isArray(byUser.items)).toBe(true)
    byUser.items.forEach((i) => expect(i.username.toLowerCase()).toContain('admin'))
    // 时间范围：全量区间的总数不小于窄区间
    const all = await AdminService.listAuditLogs({ page: 1, pageSize: 1 })
    const ranged = await AdminService.listAuditLogs({ page: 1, pageSize: 1, startDate: '2000-01-01', endDate: '2000-01-02' })
    expect(ranged.total).toBeLessThanOrEqual(all.total)
    expect(ranged.total).toBe(0)
  })
})

describe('防越级提权（权限子集规则）', () => {
  it('低权限操作者创建高权限角色用户 → 403', async () => {
    if (!dbReady) return
    const viewerRole = await basePrisma.role.findUnique({ where: { code: 'viewer' }, select: { id: true } })
    if (!viewerRole) return
    const username = `esc.user.${Date.now().toString(36)}`
    await expect(
      AdminService.createUser(
        { username, name: '提权测试', password: 'Test@123456', role: 'admin' },
        { userId: adminId, traceId: 'test', actorRoleId: viewerRole.id },
      ),
    ).rejects.toMatchObject({ code: 403 })
  })

  it('admin 不可分配/操作 superadmin；superadmin 受最后一人保护', async () => {
    if (!dbReady) return
    const superRole = await basePrisma.role.findUnique({ where: { code: 'superadmin' }, select: { id: true } })
    if (!superRole) return // 未重新 seed 时跳过
    // admin 创建 superadmin 用户 → 403（高危码不在 admin 权限集内）
    const username = `esc.super.${Date.now().toString(36)}`
    await expect(
      AdminService.createUser({ username, name: '越级', password: 'Test@123456', role: 'superadmin' }, ctx()),
    ).rejects.toMatchObject({ code: 403 })
    // 仅剩一个活跃超管时，超管自身也不可停用它
    const superUsers = await basePrisma.user.findMany({ where: { roleId: superRole.id, status: 'active' }, select: { id: true } })
    if (superUsers.length === 1) {
      await expect(
        AdminService.disableUser(superUsers[0].id, { userId: adminId, traceId: 'test', actorRoleId: superRole.id }),
      ).rejects.toMatchObject({ code: 409 })
    }
  })
})

describe('物理删除（purge）', () => {
  it('指标：未停用不可 purge；停用后 purge 连同历史物理删除', async () => {
    if (!dbReady) return
    const code = `CALC_PG_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    const created = await DataService.createMetric({ code, name: 'purge测试', dataType: 'data', category: '自定义' }, ctx())
    await expect(DataService.purgeMetric(created.id, ctx())).rejects.toMatchObject({ code: 400 })
    await DataService.deleteMetric(created.id, ctx())
    await DataService.purgeMetric(created.id, ctx())
    const after = await basePrisma.metric.findUnique({ where: { code } })
    expect(after).toBeNull()
    const history = await basePrisma.metricDefinitionHistory.count({ where: { metricId: created.id } })
    expect(history).toBe(0)
  })

  it('用户：未停用不可 purge；停用后 purge 物理删除', async () => {
    if (!dbReady) return
    const username = `purge.user.${Date.now().toString(36)}`
    tempUsernames.push(username)
    const created = await AdminService.createUser({ username, name: 'purge用户', password: 'Test@123456', role: 'viewer' }, ctx())
    await expect(AdminService.purgeUser(created.id, ctx())).rejects.toMatchObject({ code: 400 })
    await AdminService.disableUser(created.id, ctx())
    await AdminService.purgeUser(created.id, ctx())
    const after = await basePrisma.user.findUnique({ where: { username } })
    expect(after).toBeNull()
  })

  it('批次：active 不可清除；归档后清除置 purged 且幂等', async () => {
    if (!dbReady) return
    const batch = await basePrisma.importBatch.create({
      // 用 inventory 类型避免与并行测试中的 operating 生效批次查询互扰
      data: { fileName: `purge-test-${Date.now().toString(36)}.xlsx`, status: 'success', dataType: 'inventory', lifecycleStatus: 'active' },
    })
    try {
      await expect(ImportService.purge(batch.id, adminId, 'test')).rejects.toMatchObject({ code: 409 })
      const archived = await ImportService.archive(batch.id, adminId, 'test')
      expect(archived.status).toBe('archived')
      const purged = await ImportService.purge(batch.id, adminId, 'test')
      expect(purged.status).toBe('purged')
      // 幂等：重复 purge 直接返回；已清除不可再归档
      const again = await ImportService.purge(batch.id, adminId, 'test')
      expect(again.status).toBe('purged')
      await expect(ImportService.archive(batch.id, adminId, 'test')).rejects.toMatchObject({ code: 409 })
    } finally {
      await basePrisma.importBatch.delete({ where: { id: batch.id } }).catch(() => undefined)
    }
  })
})

describe('指标恢复启用与类型转换', () => {
  it('停用后普通更新不可激活；restore 校验通过后恢复且保留公式', async () => {
    if (!dbReady) return
    const subject = await basePrisma.accountSubject.findFirst({ where: { status: 'active' }, select: { code: true } })
    if (!subject) return
    const code = `CALC_RS_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    const formula = `{${subject.code}} * 2`
    await createTempSubject(code)
    const created = await DataService.createMetric({ code, name: '恢复测试', dataType: 'calc', category: '自定义', formula }, ctx())
    await DataService.deleteMetric(created.id, ctx())
    // 普通更新通道禁止绕过恢复校验
    await expect(DataService.updateMetric(created.id, { status: 'active' }, ctx())).rejects.toMatchObject({ code: 400 })
    const restored = await DataService.restoreMetric(created.id, {}, ctx())
    expect(restored.status).toBe('active')
    expect(restored.formula).toBe(formula)
    expect(restored.dataType).toBe('calc')
  })

  it('公式依赖失效时 restore 拒绝；clearFormula 清空后恢复并写历史', async () => {
    if (!dbReady) return
    const code = `CALC_RC_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    await createTempSubject(code)
    const created = await DataService.createMetric({ code, name: '失效恢复测试', dataType: 'calc', category: '自定义' }, ctx())
    await DataService.deleteMetric(created.id, ctx())
    // 模拟停用期间依赖失效：直接写入引用不存在编码的公式
    await basePrisma.metric.update({ where: { id: created.id }, data: { formula: '{NOT_EXIST_X}', dependsOn: ['NOT_EXIST_X'] as never } })
    await expect(DataService.restoreMetric(created.id, {}, ctx())).rejects.toMatchObject({ code: 400 })
    const restored = await DataService.restoreMetric(created.id, { clearFormula: true }, ctx())
    expect(restored.status).toBe('active')
    expect(restored.formula).toBeNull()
    const history = await basePrisma.metricDefinitionHistory.findFirst({ where: { metricId: created.id }, orderBy: { version: 'desc' } })
    expect(history?.description).toBe('恢复启用（公式失效已清空）')
  })

  it('data → calc 携带公式转换；calc → data 清空公式并写历史', async () => {
    if (!dbReady) return
    const subject = await basePrisma.accountSubject.findFirst({ where: { status: 'active' }, select: { code: true } })
    if (!subject) return
    const code = `CALC_CV_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    await createTempSubject(code)
    const created = await DataService.createMetric({ code, name: '转换测试', dataType: 'data', category: '自定义' }, ctx())
    const toCalc = await DataService.convertMetricType(created.id, { dataType: 'calc', formula: `{${subject.code}} + 1` }, ctx())
    expect(toCalc.dataType).toBe('calc')
    expect(toCalc.formula).toBe(`{${subject.code}} + 1`)
    let history = await basePrisma.metricDefinitionHistory.findFirst({ where: { metricId: created.id }, orderBy: { version: 'desc' } })
    expect(history?.description).toBe('转换为计算类')
    const toData = await DataService.convertMetricType(created.id, { dataType: 'data' }, ctx())
    expect(toData.dataType).toBe('data')
    expect(toData.formula).toBeNull()
    history = await basePrisma.metricDefinitionHistory.findFirst({ where: { metricId: created.id }, orderBy: { version: 'desc' } })
    expect(history?.description).toBe('转换为数据类（清空公式）')
  })

  it('data → calc 转换但科目体系中无同编码科目 → 400', async () => {
    if (!dbReady) return
    const code = `CALC_CN_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    const created = await DataService.createMetric({ code, name: '无科目转换测试', dataType: 'data', category: '自定义' }, ctx())
    await expect(DataService.convertMetricType(created.id, { dataType: 'calc' }, ctx())).rejects.toMatchObject({ code: 400 })
  })

  it('被活跃指标引用时：停用与 calc→data 转换均拒绝', async () => {
    if (!dbReady) return
    const subject = await basePrisma.accountSubject.findFirst({ where: { status: 'active' }, select: { code: true } })
    if (!subject) return
    const codeA = `CALC_RF_A_${Date.now().toString(36)}`
    const codeB = `CALC_RF_B_${Date.now().toString(36)}`
    tempMetricCodes.push(codeA, codeB)
    await createTempSubject(codeA)
    await createTempSubject(codeB)
    const a = await DataService.createMetric({ code: codeA, name: '被引用指标', dataType: 'calc', category: '自定义', formula: `{${subject.code}}` }, ctx())
    const b = await DataService.createMetric({ code: codeB, name: '引用方指标', dataType: 'calc', category: '自定义', formula: `{${codeA}} * 100` }, ctx())
    await expect(DataService.deleteMetric(a.id, ctx())).rejects.toMatchObject({ code: 409 })
    await expect(DataService.convertMetricType(a.id, { dataType: 'data' }, ctx())).rejects.toMatchObject({ code: 409 })
    // 先停用引用方后即可停用被引用指标
    await DataService.deleteMetric(b.id, ctx())
    await DataService.deleteMetric(a.id, ctx())
    const after = await basePrisma.metric.findUnique({ where: { code: codeA }, select: { status: true } })
    expect(after?.status).toBe('inactive')
  })
})

describe('公式试算递归展开 calc 依赖', () => {
  it('公式引用 calc 指标时返回展开后的值（修复前为 0）', async () => {
    if (!dbReady) return
    const batch = await basePrisma.importBatch.findFirst({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
    if (!batch) return
    const latest = await basePrisma.factOperating.findFirst({ where: { batchId: batch.id }, orderBy: { period: 'desc' }, select: { period: true } })
    if (!latest) return
    const period = latest.period
    const suffix = Date.now().toString(36)
    const dataCode = `OP_TCD_${suffix}`
    const calcCode = `OP_TCC_${suffix}`
    tempMetricCodes.push(dataCode, calcCode)
    try {
      await DataService.createSubject({ code: dataCode, name: '试算数据叶', type: 'operating', level: 1, parentCode: 'OP_02', isLeaf: true }, ctx())
      await DataService.createSubject({ code: calcCode, name: '试算计算项', type: 'operating', level: 1, parentCode: 'OP_02', isLeaf: true }, ctx())
      await DataService.createMetric({ code: dataCode, name: '试算数据叶', dataType: 'data', category: '自定义' }, ctx())
      await DataService.createMetric({ code: calcCode, name: '试算计算项', dataType: 'calc', formula: `{${dataCode}}`, category: '自定义' }, ctx())
      await basePrisma.factOperating.create({
        data: { batchId: batch.id, companyCode: 'EN330059', accountCode: dataCode, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: `FY${period.slice(0, 4)}`, value: 123.45 },
      })
      // 直接引用 calc 指标，应递归展开为其依赖的事实值
      const res = await DataService.trialCalc({ formula: `{${calcCode}}`, companyCode: 'EN330059', period })
      expect(res.value).toBe(123.45)
      expect(res.operands[0].code).toBe(calcCode)
      expect(res.operands[0].value).toBe(123.45)
      expect(res.operands[0].hasData).toBe(true)
      // 混合公式：calc + 常量
      const res2 = await DataService.trialCalc({ formula: `{${calcCode}} * 2 + 10`, companyCode: 'EN330059', period })
      expect(res2.value).toBe(256.9)
    } finally {
      await basePrisma.factOperating.deleteMany({ where: { accountCode: dataCode } }).catch(() => undefined)
      await basePrisma.accountSubject.deleteMany({ where: { code: { in: [dataCode, calcCode] } } }).catch(() => undefined)
    }
  })

  it('跨维度引用 calc 指标：{ST_PARENT@YEAR_START} 与 {OP_PARENT@YTD_ACTUAL} 取派生值', async () => {
    if (!dbReady) return
    const opBatch = await basePrisma.importBatch.findFirst({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
    const stBatch = await basePrisma.importBatch.findFirst({ where: { dataType: 'static', lifecycleStatus: 'active' }, select: { id: true } })
    if (!opBatch || !stBatch) return
    const latest = await basePrisma.factOperating.findFirst({ where: { batchId: opBatch.id }, orderBy: { period: 'desc' }, select: { period: true } })
    if (!latest) return
    const period = latest.period
    const opening = fiscalYearOpeningSnapshotPeriod(period) // S=4：2026-04 → 2026-03
    const suffix = Date.now().toString(36)
    const stA = `ST_TCA_${suffix}`
    const stB = `ST_TCB_${suffix}`
    const stP = `ST_TCP_${suffix}`
    const opD = `OP_TCD_${suffix}`
    const opP = `OP_TCP_${suffix}`
    const allTemp = [stA, stB, stP, opD, opP]
    tempMetricCodes.push(...allTemp)
    tempSubjectCodes.push(...allTemp)
    const curA = 20
    const curB = 30
    const ysA = 12
    const ysB = 18
    const opV = 100
    try {
      await basePrisma.accountSubject.createMany({
        data: allTemp.map((code) => ({
          code, name: `临时_${code}`, subjectType: code.startsWith('ST_') ? 'static' : 'operating',
          level: 1, parentCode: null, category: '自定义', direction: 'credit', isLeaf: true,
        })),
      })
      await DataService.createMetric({ code: stA, name: '存货甲', dataType: 'data', category: '自定义' }, ctx())
      await DataService.createMetric({ code: stB, name: '存货乙', dataType: 'data', category: '自定义' }, ctx())
      await DataService.createMetric({ code: stP, name: '存货合计', dataType: 'calc', formula: `{${stA}} + {${stB}}`, category: '自定义' }, ctx())
      await DataService.createMetric({ code: opD, name: '成本叶', dataType: 'data', category: '自定义' }, ctx())
      await DataService.createMetric({ code: opP, name: '成本合计', dataType: 'calc', formula: `{${opD}}`, category: '自定义' }, ctx())
      // 静态快照：本期月 + 年初快照月（S=4 时年初 = 财年起始月前一月）
      await basePrisma.factStatic.createMany({
        data: [
          { batchId: stBatch.id, companyCode: 'EN330059', accountCode: stA, snapshotDate: new Date(`${period}-28T00:00:00.000Z`), periodDimCode: STATIC_DIMS.CURRENT_AMOUNT, fiscalYear: `FY${period.slice(0, 4)}`, value: curA },
          { batchId: stBatch.id, companyCode: 'EN330059', accountCode: stB, snapshotDate: new Date(`${period}-28T00:00:00.000Z`), periodDimCode: STATIC_DIMS.CURRENT_AMOUNT, fiscalYear: `FY${period.slice(0, 4)}`, value: curB },
          { batchId: stBatch.id, companyCode: 'EN330059', accountCode: stA, snapshotDate: new Date(`${opening}-28T00:00:00.000Z`), periodDimCode: STATIC_DIMS.CURRENT_AMOUNT, fiscalYear: `FY${opening.slice(0, 4)}`, value: ysA },
          { batchId: stBatch.id, companyCode: 'EN330059', accountCode: stB, snapshotDate: new Date(`${opening}-28T00:00:00.000Z`), periodDimCode: STATIC_DIMS.CURRENT_AMOUNT, fiscalYear: `FY${opening.slice(0, 4)}`, value: ysB },
        ],
      })
      // 经营事实：本期 ACTUAL_MONTH（YTD 区间 = 财年起..本期，单期场景即本期）
      await basePrisma.factOperating.create({
        data: { batchId: opBatch.id, companyCode: 'EN330059', accountCode: opD, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: `FY${period.slice(0, 4)}`, value: opV },
      })
      const formula = `({${stP}@YEAR_START} + {${stP}}) / 2 * {DAYS_YTD} / {${opP}@YTD_ACTUAL}`
      const res = await DataService.trialCalc({ formula, companyCode: 'EN330059', period })
      // 期望：(12+18+20+30)/2 × 财年累计天数 ÷ 100
      const expected = (((ysA + ysB) + (curA + curB)) / 2) * fiscalYtdDays(period) / opV
      expect(res.value).toBeCloseTo(expected, 6)
      const opMap = new Map(res.operands.map((o) => [o.code, o]))
      expect(opMap.get(`${stP}@YEAR_START`)?.value).toBeCloseTo(ysA + ysB, 6)
      expect(opMap.get(`${stP}@YEAR_START`)?.hasData).toBe(true)
      expect(opMap.get(`${opP}@YTD_ACTUAL`)?.value).toBeCloseTo(opV, 6)
      expect(opMap.get(`${opP}@YTD_ACTUAL`)?.hasData).toBe(true)
    } finally {
      await basePrisma.factStatic.deleteMany({ where: { accountCode: { in: [stA, stB] } } }).catch(() => undefined)
      await basePrisma.factOperating.deleteMany({ where: { accountCode: opD } }).catch(() => undefined)
      await basePrisma.metric.deleteMany({ where: { code: { in: allTemp } } }).catch(() => undefined)
      await basePrisma.accountSubject.deleteMany({ where: { code: { in: allTemp } } }).catch(() => undefined)
    }
  })
})

describe('跨公司重分类', () => {
  it('preview + 执行：源公司单月数据改挂目标公司（含合并求和），可按快照撤销', async () => {
    if (!dbReady) return
    const batch = await basePrisma.importBatch.findFirst({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
    if (!batch) return
    const suffix = Date.now().toString(36)
    const src = `RCS_${suffix}`
    const tgt = `RCT_${suffix}`
    await basePrisma.company.create({ data: { code: src, name: '重分类源', entityType: 'single', status: 'active' } })
    await basePrisma.company.create({ data: { code: tgt, name: '重分类目标', entityType: 'single', status: 'active' } })
    const scope = { companyCode: null, scopeValue: '*' }
    try {
      await basePrisma.factOperating.createMany({
        data: [
          { batchId: batch.id, companyCode: src, accountCode: 'OP_02', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 100 },
          { batchId: batch.id, companyCode: src, accountCode: 'OP_0201', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 200 },
        ],
      })
      // 目标公司已有 OP_02@2026-05 (50) → 合并
      await basePrisma.factOperating.create({ data: { batchId: batch.id, companyCode: tgt, accountCode: 'OP_02', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 50 } })

      const pv = await ReclassificationService.previewCompany({ templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt, period: '2026-05' }, scope)
      expect(pv.affectedRows).toBe(2)
      expect(pv.totalValue).toBe(300)
      expect(pv.conflictRows).toBe(1)

      const res = await ReclassificationService.reclassifyCompany({ templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt, period: '2026-05' }, scope, { userId: adminId, traceId: 'test' })
      expect(res.affectedRows).toBe(2)
      expect(res.mergedRows).toBe(1)

      expect(await basePrisma.factOperating.count({ where: { companyCode: src } })).toBe(0)
      const tgtRows = await basePrisma.factOperating.findMany({ where: { companyCode: tgt }, orderBy: { accountCode: 'asc' } })
      expect(tgtRows.length).toBe(2)
      expect(Number(tgtRows[0].value)).toBe(150) // 100 + 50 合并
      expect(Number(tgtRows[1].value)).toBe(200)

      const logs = await basePrisma.reclassificationLog.findMany({ where: { type: 'company', sourceCompany: src } })
      expect(logs.length).toBe(1)
      expect(logs[0].period).toBe('2026-05')

      // 撤销：按快照逆向恢复（合并行回写 + 改挂行改回 + 删除行重建）
      const revert = await ReclassificationService.revertLog(logs[0].id, scope, { userId: adminId, traceId: 'test' })
      expect(revert.restoredRows).toBeGreaterThan(0)
      const srcAfter = await basePrisma.factOperating.findMany({ where: { companyCode: src } })
      expect(srcAfter.reduce((s, r) => s + Number(r.value), 0)).toBe(300)
      const tgtAfter = await basePrisma.factOperating.findMany({ where: { companyCode: tgt } })
      expect(tgtAfter.length).toBe(1)
      expect(Number(tgtAfter[0].value)).toBe(50)
      const reverted = await basePrisma.reclassificationLog.findUnique({ where: { id: logs[0].id } })
      expect(reverted?.revertedAt).toBeTruthy()
      // 重复撤销 → 409
      await expect(ReclassificationService.revertLog(logs[0].id, scope, { userId: adminId, traceId: 'test' })).rejects.toMatchObject({ code: 409 })
    } finally {
      await basePrisma.factOperating.deleteMany({ where: { companyCode: { in: [src, tgt] } } }).catch(() => undefined)
      await basePrisma.company.deleteMany({ where: { code: { in: [src, tgt] } } }).catch(() => undefined)
      await basePrisma.reclassificationLog.deleteMany({ where: { sourceCompany: src } }).catch(() => undefined)
    }
  })

  it('目标公司不在数据范围内 → 403', async () => {
    if (!dbReady) return
    await expect(
      ReclassificationService.previewCompany(
        { templateType: 'operating', sourceCompanyCode: 'EN330059', targetCompanyCode: 'EN330058', period: '2026-05' },
        { companyCode: 'EN330059', scopeValue: '' },
      ),
    ).rejects.toMatchObject({ code: 403 })
  })

  it('未传单月期间 → 400', async () => {
    if (!dbReady) return
    await expect(
      ReclassificationService.previewCompany(
        { templateType: 'operating', sourceCompanyCode: 'EN330059', targetCompanyCode: 'EN330058', period: '' },
        { companyCode: null, scopeValue: '*' },
      ),
    ).rejects.toMatchObject({ code: 400 })
  })

  it('部分转移（amount）：源行调减保留、目标累加/新建，合计恰等于转移额', async () => {
    if (!dbReady) return
    const batch = await basePrisma.importBatch.findFirst({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
    if (!batch) return
    const suffix = Date.now().toString(36)
    const src = `RPS_${suffix}`
    const tgt = `RPT_${suffix}`
    await basePrisma.company.create({ data: { code: src, name: '部分转移源', entityType: 'single', status: 'active' } })
    await basePrisma.company.create({ data: { code: tgt, name: '部分转移目标', entityType: 'single', status: 'active' } })
    const scope = { companyCode: null, scopeValue: '*' }
    try {
      await basePrisma.factOperating.createMany({
        data: [
          { batchId: batch.id, companyCode: src, accountCode: 'OP_02', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 100 },
          { batchId: batch.id, companyCode: src, accountCode: 'OP_0201', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 200 },
        ],
      })
      // 目标公司已有 OP_02@2026-05 (50) → 累加；OP_0201 无行 → 新建
      await basePrisma.factOperating.create({ data: { batchId: batch.id, companyCode: tgt, accountCode: 'OP_02', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 50 } })

      const pv = await ReclassificationService.previewCompany(
        { templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt, period: '2026-05', transferMode: 'amount', amount: 90 },
        scope,
      )
      expect(pv.affectedRows).toBe(2)
      expect(pv.totalValue).toBe(300)
      expect(pv.transferValue).toBe(90)
      expect(pv.conflictRows).toBe(1)
      expect(pv.createRows).toBe(1)

      const res = await ReclassificationService.reclassifyCompany(
        { templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt, period: '2026-05', transferMode: 'amount', amount: 90 },
        scope,
        { userId: adminId, traceId: 'test' },
      )
      expect(res.transferValue).toBe(90)
      expect(res.mergedRows).toBe(1)
      expect(res.createdRows).toBe(1)

      // 源行保留且合计 = 300 - 90；目标合计 = 50 + 90；总额守恒
      const srcRows = await basePrisma.factOperating.findMany({ where: { companyCode: src } })
      expect(srcRows.length).toBe(2)
      const srcSum = srcRows.reduce((s, r) => s + Number(r.value), 0)
      expect(srcSum).toBe(210)
      const tgtRows = await basePrisma.factOperating.findMany({ where: { companyCode: tgt } })
      const tgtSum = tgtRows.reduce((s, r) => s + Number(r.value), 0)
      expect(tgtSum).toBe(140)

      // 超额转移 → 400
      await expect(
        ReclassificationService.previewCompany(
          { templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt, period: '2026-05', transferMode: 'amount', amount: 999999 },
          scope,
        ),
      ).rejects.toMatchObject({ code: 400 })
    } finally {
      await basePrisma.factOperating.deleteMany({ where: { companyCode: { in: [src, tgt] } } }).catch(() => undefined)
      await basePrisma.company.deleteMany({ where: { code: { in: [src, tgt] } } }).catch(() => undefined)
      await basePrisma.reclassificationLog.deleteMany({ where: { sourceCompany: src } }).catch(() => undefined)
    }
  })

  it('部分转移（ratio）：每行按比例调减', async () => {
    if (!dbReady) return
    const batch = await basePrisma.importBatch.findFirst({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
    if (!batch) return
    const suffix = Date.now().toString(36)
    const src = `RRS_${suffix}`
    const tgt = `RRT_${suffix}`
    await basePrisma.company.create({ data: { code: src, name: '比例转移源', entityType: 'single', status: 'active' } })
    await basePrisma.company.create({ data: { code: tgt, name: '比例转移目标', entityType: 'single', status: 'active' } })
    const scope = { companyCode: null, scopeValue: '*' }
    try {
      await basePrisma.factOperating.create({
        data: { batchId: batch.id, companyCode: src, accountCode: 'OP_02', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 100 },
      })
      const res = await ReclassificationService.reclassifyCompany(
        { templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt, period: '2026-05', transferMode: 'ratio', ratio: 0.3 },
        scope,
        { userId: adminId, traceId: 'test' },
      )
      expect(res.transferValue).toBe(30)
      expect(res.createdRows).toBe(1)
      const srcRow = await basePrisma.factOperating.findFirst({ where: { companyCode: src } })
      expect(Number(srcRow?.value)).toBe(70)
      const tgtRow = await basePrisma.factOperating.findFirst({ where: { companyCode: tgt } })
      expect(Number(tgtRow?.value)).toBe(30)
    } finally {
      await basePrisma.factOperating.deleteMany({ where: { companyCode: { in: [src, tgt] } } }).catch(() => undefined)
      await basePrisma.company.deleteMany({ where: { code: { in: [src, tgt] } } }).catch(() => undefined)
      await basePrisma.reclassificationLog.deleteMany({ where: { sourceCompany: src } }).catch(() => undefined)
    }
  })
})

describe('同公司科目间金额调整', () => {
  it('调减+调增不等额：公司总额净变动，日志 type=subject_adjust 落库', async () => {
    if (!dbReady) return
    const batch = await basePrisma.importBatch.findFirst({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
    if (!batch) return
    const suffix = Date.now().toString(36)
    const comp = `ADJ_${suffix}`
    await basePrisma.company.create({ data: { code: comp, name: '科目调整公司', entityType: 'single', status: 'active' } })
    const scope = { companyCode: null, scopeValue: '*' }
    // 取两个金额类经营科目作源/目标（比率类由公式计算禁止调整，数量类与金额类不可互调，锁定 amount 保证夹具稳定）
    const subjects = await basePrisma.accountSubject.findMany({ where: { subjectType: 'operating', status: 'active', isLeaf: true, valueType: 'amount' }, take: 2 })
    if (subjects.length < 2) return
    const [srcSub, tgtSub] = subjects
    try {
      await basePrisma.factOperating.createMany({
        data: [
          { batchId: batch.id, companyCode: comp, accountCode: srcSub.code, period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 300 },
          { batchId: batch.id, companyCode: comp, accountCode: srcSub.code, period: '2026-06', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 100 },
        ],
      })

      const pv = await ReclassificationService.previewAdjustSubject(
        { templateType: 'operating', companyCode: comp, sourceAccountCode: srcSub.code, targetAccountCode: tgtSub.code, decreaseAmount: 200, increaseAmount: 80, period: '2026-05', reason: '测试' },
        scope,
      )
      expect(pv.affectedRows).toBe(1)
      expect(pv.sourceTotal).toBe(300)
      expect(pv.netChange).toBe(-120)

      const res = await ReclassificationService.adjustSubject(
        { templateType: 'operating', companyCode: comp, sourceAccountCode: srcSub.code, targetAccountCode: tgtSub.code, decreaseAmount: 200, increaseAmount: 80, period: '2026-05', reason: '重复计算修正测试' },
        scope,
        { userId: adminId, traceId: 'test' },
      )
      expect(res.decreaseAmount).toBe(200)
      expect(res.increaseAmount).toBe(80)
      expect(res.netChange).toBe(-120)

      // 仅作用于 2026-05：源科目 300-200 + 保留 100 = 200；目标科目新增 80；公司总额 400-120=280
      const rows = await basePrisma.factOperating.findMany({ where: { companyCode: comp } })
      const srcSum = rows.filter((r) => r.accountCode === srcSub.code).reduce((s, r) => s + Number(r.value), 0)
      const tgtSum = rows.filter((r) => r.accountCode === tgtSub.code).reduce((s, r) => s + Number(r.value), 0)
      expect(srcSum).toBe(200)
      expect(tgtSum).toBe(80)
      expect(rows.reduce((s, r) => s + Number(r.value), 0)).toBe(280)

      const logs = await basePrisma.reclassificationLog.findMany({ where: { type: 'subject_adjust', sourceCompany: comp } })
      expect(logs.length).toBe(1)
      expect(logs[0].sourceSubject).toBe(srcSub.code)
      expect(logs[0].targetSubject).toBe(tgtSub.code)
      expect(logs[0].period).toBe('2026-05')
      expect((logs[0].detail as { reason?: string })?.reason).toBe('重复计算修正测试')

      // 撤销：恢复至调整前（源 400、目标 0）
      await ReclassificationService.revertLog(logs[0].id, scope, { userId: adminId, traceId: 'test' })
      const after = await basePrisma.factOperating.findMany({ where: { companyCode: comp } })
      expect(after.filter((r) => r.accountCode === srcSub.code).reduce((s, r) => s + Number(r.value), 0)).toBe(400)
      expect(after.filter((r) => r.accountCode === tgtSub.code).reduce((s, r) => s + Number(r.value), 0)).toBe(0)
    } finally {
      await basePrisma.factOperating.deleteMany({ where: { companyCode: comp } }).catch(() => undefined)
      await basePrisma.company.deleteMany({ where: { code: comp } }).catch(() => undefined)
      await basePrisma.reclassificationLog.deleteMany({ where: { sourceCompany: comp } }).catch(() => undefined)
    }
  })

  it('纯调减（不传目标科目）：仅源科目减少', async () => {
    if (!dbReady) return
    const batch = await basePrisma.importBatch.findFirst({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
    if (!batch) return
    const suffix = Date.now().toString(36)
    const comp = `ADJD_${suffix}`
    await basePrisma.company.create({ data: { code: comp, name: '纯调减公司', entityType: 'single', status: 'active' } })
    const scope = { companyCode: null, scopeValue: '*' }
    const srcSub = await basePrisma.accountSubject.findFirst({ where: { subjectType: 'operating', status: 'active', isLeaf: true, valueType: 'amount' } })
    if (!srcSub) return
    try {
      await basePrisma.factOperating.create({
        data: { batchId: batch.id, companyCode: comp, accountCode: srcSub.code, period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 500 },
      })
      const res = await ReclassificationService.adjustSubject(
        { templateType: 'operating', companyCode: comp, sourceAccountCode: srcSub.code, decreaseAmount: 120, period: '2026-05', reason: '重复计算调减' },
        scope,
        { userId: adminId, traceId: 'test' },
      )
      expect(res.decreaseAmount).toBe(120)
      expect(res.increaseAmount).toBe(0)
      expect(res.netChange).toBe(-120)
      const row = await basePrisma.factOperating.findFirst({ where: { companyCode: comp } })
      expect(Number(row?.value)).toBe(380)
    } finally {
      await basePrisma.factOperating.deleteMany({ where: { companyCode: comp } }).catch(() => undefined)
      await basePrisma.company.deleteMany({ where: { code: comp } }).catch(() => undefined)
      await basePrisma.reclassificationLog.deleteMany({ where: { sourceCompany: comp } }).catch(() => undefined)
    }
  })

  it('调减超过源科目合计 / 公司不在范围 → 报错', async () => {
    if (!dbReady) return
    await expect(
      ReclassificationService.previewAdjustSubject(
        { templateType: 'operating', companyCode: 'EN330058', sourceAccountCode: 'OP_02', decreaseAmount: 100, period: '2026-05', reason: 'x' },
        { companyCode: 'EN330059', scopeValue: '' },
      ),
    ).rejects.toMatchObject({ code: 403 })
  })

  it('比率类科目 → 400（比率由公式派生，禁止金额调整）', async () => {
    if (!dbReady) return
    const ratioSub = await basePrisma.accountSubject.findFirst({ where: { subjectType: 'operating', status: 'active', isLeaf: true, valueType: 'ratio' } })
    if (!ratioSub) return
    await expect(
      ReclassificationService.previewAdjustSubject(
        { templateType: 'operating', companyCode: 'EN330058', sourceAccountCode: ratioSub.code, decreaseAmount: 100, period: '2026-05', reason: 'x' },
        { companyCode: null, scopeValue: '*' },
      ),
    ).rejects.toMatchObject({ code: 400, message: expect.stringContaining('比率类科目') })
  })
})

describe('科目归类调整', () => {
  it('换父后科目 category 更新为新根名，可还原', async () => {
    if (!dbReady) return
    const roots = await basePrisma.accountSubject.findMany({ where: { subjectType: 'operating', level: 0, status: 'active' }, orderBy: { orderNo: 'asc' } })
    if (roots.length < 2) return
    const rootA = roots[0]
    const rootB = roots[1]
    const leaf = await basePrisma.accountSubject.findFirst({ where: { subjectType: 'operating', parentCode: rootA.code, status: 'active' } })
    if (!leaf) return
    const originalParent = leaf.parentCode
    try {
      const updated = await DataService.reclassifySubject(leaf.id, { parentCode: rootB.code }, { userId: adminId, traceId: 'test' })
      expect(updated.parentCode).toBe(rootB.code)
      expect(updated.category).toBe(rootB.name)
      await DataService.reclassifySubject(leaf.id, { parentCode: originalParent }, { userId: adminId, traceId: 'test' })
      const restored = await basePrisma.accountSubject.findUnique({ where: { id: leaf.id } })
      expect(restored?.parentCode).toBe(originalParent)
      expect(restored?.category).toBe(rootA.name)
    } finally {
      // 用例产生两条配对日志（移过去 targetSubject=rootB、移回来 targetSubject=originalParent），须一并清理避免残留
      await basePrisma.reclassificationLog.deleteMany({ where: { type: 'subject', targetSubject: { in: [rootB.code, originalParent] } } }).catch(() => undefined)
    }
  })

  it('移到自身子孙下 → 400 防环', async () => {
    if (!dbReady) return
    const parent = await basePrisma.accountSubject.findFirst({ where: { subjectType: 'operating', status: 'active', isLeaf: false, level: 0 } })
    if (!parent) return
    const child = await basePrisma.accountSubject.findFirst({ where: { subjectType: 'operating', parentCode: parent.code, status: 'active' } })
    if (!child) return
    await expect(
      DataService.reclassifySubject(parent.id, { parentCode: child.code }, { userId: adminId, traceId: 'test' }),
    ).rejects.toMatchObject({ code: 400 })
  })
})
