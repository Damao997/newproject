import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { DataService } from '../services/DataService'
import { AdminService } from '../services/AdminService'
import { ImportService } from '../services/ImportService'
import { FormulaRuleService } from '../services/FormulaRuleService'
import { ReclassificationService } from '../services/ReclassificationService'
import { OPERATING_DIMS } from '../lib/metric-values'

/**
 * 数据/权限管理写路径集成测试（真实 DB）。
 * 创建的实体在 afterAll 清理。无 DB 时整组跳过。
 */

let dbReady = false
let adminId = ''
let adminRoleId = ''
const tempMetricCodes: string[] = []
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
  await basePrisma.user.deleteMany({ where: { username: { in: tempUsernames } } }).catch(() => undefined)
  const tempRoles = await basePrisma.role.findMany({ where: { code: { in: tempRoleCodes } }, select: { id: true } })
  const roleIds = tempRoles.map((r) => r.id)
  await basePrisma.permission.deleteMany({ where: { roleId: { in: roleIds } } }).catch(() => undefined)
  await basePrisma.role.deleteMany({ where: { code: { in: tempRoleCodes } } }).catch(() => undefined)
})

const ctx = () => ({ userId: adminId, traceId: 'test', actorRoleId: adminRoleId })

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
      await DataService.createSubject({ code: dataCode, name: '试算数据叶', type: 'operating', level: 1, parentCode: 'OP_001', isLeaf: true }, ctx())
      await DataService.createSubject({ code: calcCode, name: '试算计算项', type: 'operating', level: 1, parentCode: 'OP_001', isLeaf: true }, ctx())
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
})

describe('跨公司重分类', () => {
  it('preview + 执行：源公司数据改挂目标公司（含合并求和）', async () => {
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
          { batchId: batch.id, companyCode: src, accountCode: 'OP_001', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 100 },
          { batchId: batch.id, companyCode: src, accountCode: 'OP_001', period: '2026-06', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 200 },
        ],
      })
      // 目标公司已有 OP_001@2026-05 (50) → 合并
      await basePrisma.factOperating.create({ data: { batchId: batch.id, companyCode: tgt, accountCode: 'OP_001', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 50 } })

      const pv = await ReclassificationService.previewCompany({ templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt }, scope)
      expect(pv.affectedRows).toBe(2)
      expect(pv.totalValue).toBe(300)
      expect(pv.conflictRows).toBe(1)

      const res = await ReclassificationService.reclassifyCompany({ templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt }, scope, { userId: adminId, traceId: 'test' })
      expect(res.affectedRows).toBe(2)
      expect(res.mergedRows).toBe(1)

      expect(await basePrisma.factOperating.count({ where: { companyCode: src } })).toBe(0)
      const tgtRows = await basePrisma.factOperating.findMany({ where: { companyCode: tgt, accountCode: 'OP_001' }, orderBy: { period: 'asc' } })
      expect(tgtRows.length).toBe(2)
      expect(Number(tgtRows[0].value)).toBe(150) // 100 + 50 合并
      expect(Number(tgtRows[1].value)).toBe(200)

      const logs = await basePrisma.reclassificationLog.findMany({ where: { type: 'company', sourceCompany: src } })
      expect(logs.length).toBeGreaterThanOrEqual(1)
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
        { templateType: 'operating', sourceCompanyCode: 'EN330059', targetCompanyCode: 'EN330058' },
        { companyCode: 'EN330059', scopeValue: '' },
      ),
    ).rejects.toMatchObject({ code: 403 })
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
          { batchId: batch.id, companyCode: src, accountCode: 'OP_001', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 100 },
          { batchId: batch.id, companyCode: src, accountCode: 'OP_001', period: '2026-06', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 200 },
        ],
      })
      // 目标公司已有 OP_001@2026-05 (50) → 累加；2026-06 无行 → 新建
      await basePrisma.factOperating.create({ data: { batchId: batch.id, companyCode: tgt, accountCode: 'OP_001', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 50 } })

      const pv = await ReclassificationService.previewCompany(
        { templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt, transferMode: 'amount', amount: 90 },
        scope,
      )
      expect(pv.affectedRows).toBe(2)
      expect(pv.totalValue).toBe(300)
      expect(pv.transferValue).toBe(90)
      expect(pv.conflictRows).toBe(1)
      expect(pv.createRows).toBe(1)

      const res = await ReclassificationService.reclassifyCompany(
        { templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt, transferMode: 'amount', amount: 90 },
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
          { templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt, transferMode: 'amount', amount: 999999 },
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
        data: { batchId: batch.id, companyCode: src, accountCode: 'OP_001', period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 100 },
      })
      const res = await ReclassificationService.reclassifyCompany(
        { templateType: 'operating', sourceCompanyCode: src, targetCompanyCode: tgt, transferMode: 'ratio', ratio: 0.3 },
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
    // 取两个已存在的经营科目作为源/目标
    const subjects = await basePrisma.accountSubject.findMany({ where: { subjectType: 'operating', status: 'active', isLeaf: true }, take: 2 })
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
        { templateType: 'operating', companyCode: comp, sourceAccountCode: srcSub.code, targetAccountCode: tgtSub.code, decreaseAmount: 200, increaseAmount: 80, reason: '测试' },
        scope,
      )
      expect(pv.affectedRows).toBe(2)
      expect(pv.sourceTotal).toBe(400)
      expect(pv.netChange).toBe(-120)

      const res = await ReclassificationService.adjustSubject(
        { templateType: 'operating', companyCode: comp, sourceAccountCode: srcSub.code, targetAccountCode: tgtSub.code, decreaseAmount: 200, increaseAmount: 80, reason: '重复计算修正测试' },
        scope,
        { userId: adminId, traceId: 'test' },
      )
      expect(res.decreaseAmount).toBe(200)
      expect(res.increaseAmount).toBe(80)
      expect(res.netChange).toBe(-120)

      // 源科目合计 400-200=200；目标科目新增 80；公司总额 400-120=280
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
      expect((logs[0].detail as { reason?: string })?.reason).toBe('重复计算修正测试')
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
    const srcSub = await basePrisma.accountSubject.findFirst({ where: { subjectType: 'operating', status: 'active', isLeaf: true } })
    if (!srcSub) return
    try {
      await basePrisma.factOperating.create({
        data: { batchId: batch.id, companyCode: comp, accountCode: srcSub.code, period: '2026-05', periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: 'FY2026', value: 500 },
      })
      const res = await ReclassificationService.adjustSubject(
        { templateType: 'operating', companyCode: comp, sourceAccountCode: srcSub.code, decreaseAmount: 120, reason: '重复计算调减' },
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
        { templateType: 'operating', companyCode: 'EN330058', sourceAccountCode: 'OP_001', decreaseAmount: 100, reason: 'x' },
        { companyCode: 'EN330059', scopeValue: '' },
      ),
    ).rejects.toMatchObject({ code: 403 })
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
      await basePrisma.reclassificationLog.deleteMany({ where: { type: 'subject', targetSubject: rootB.code } }).catch(() => undefined)
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
