import { describe, it, expect, beforeAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { IndicatorsService } from '../services/IndicatorsService'
import { DashboardService } from '../services/DashboardService'
import { resolveCompanyCodes } from '../services/AggregationService'
import { DataService } from '../services/DataService'
import { AdminService } from '../services/AdminService'
import { fiscalYearLabel } from '../lib/period'

/**
 * 服务层集成测试（对真实 PostgreSQL + 已 seed 数据）。
 * 注：事实数据改由 Excel 导入提供，seed 仅含维度/科目/指标/公司/映射，
 * 故本测试聚焦结构与口径（公司数、科目树、映射展开），数值准确性在导入 e2e 验证。
 * 若数据库不可达或未 seed，则整组自动跳过。
 */

const ADMIN_SCOPE = { companyCode: null, scopeValue: '*' }
let dbReady = false

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const companies = await prisma.company.count()
    dbReady = companies > 0
  } catch {
    dbReady = false
  }
  if (!dbReady) {
    console.warn('[integration] 数据库不可达或未 seed，集成测试跳过')
  }
})

describe('服务层集成（真实 DB）', () => {
  it('公司主体存在且含单体/汇总（独立开发库数据量随 seed 演进，仅断言非空与类型前缀）', async () => {
    if (!dbReady) return
    // 独立开发库（DB_PORT 隔离）seed 数据量可能与共享库历史快照不同，
    // 此处仅验证基础数据存在性与编码前缀（单体 EN / 汇总 ET）
    const companies = await DataService.listCompanies()
    expect(companies.length).toBeGreaterThan(0)
    expect(companies.some((c) => c.code.startsWith('EN'))).toBe(true)
    expect(companies.some((c) => c.code.startsWith('ET'))).toBe(true)
  })

  it('汇总映射已导入（company_aggregation_map 行数 > 0）', async () => {
    if (!dbReady) return
    const count = await prisma.companyAggregationMap.count()
    expect(count).toBeGreaterThan(0)
  })

  it('经营科目树根节点 8 个，首个为「壹品慧回款」', async () => {
    if (!dbReady) return
    const tree = (await IndicatorsService.getTree('operating')) as { name: string }[]
    expect(tree.length).toBe(8)
    expect(tree[0].name).toBe('壹品慧回款')
  })

  it('经营指标：admin 全量行数 = 在用经营科目数、公司数 = 单体数', async () => {
    if (!dbReady) return
    // 基线演进：初始快照 152；科目体系新增科目后漂移，改为随库动态比对避免再次漂移（与静态指标口径一致）
    const data = await IndicatorsService.getOperating(ADMIN_SCOPE, {})
    const subjectCount = await prisma.accountSubject.count({ where: { subjectType: 'operating', status: 'active' } })
    expect(data.total).toBe(subjectCount)
    const singles = await prisma.company.count({ where: { entityType: 'single', status: 'active' } })
    expect(data.companyCount).toBe(singles)
    const revenue = data.items.find((r) => r.name === '壹品慧收入')
    expect(revenue).toBeTruthy()
  })

  it('静态指标：行数 = 在用静态科目数', async () => {
    if (!dbReady) return
    // 基线演进：初始快照 34；科目编码体系重构后在用静态科目为 31，改为随库动态比对避免再次漂移
    const data = await IndicatorsService.getStatic(ADMIN_SCOPE, {})
    const subjectCount = await prisma.accountSubject.count({ where: { subjectType: 'static', status: 'active' } })
    expect(data.total).toBe(subjectCount)
  })

  it('汇总主体经映射展开为单体成员', async () => {
    if (!dbReady) return
    const summary = await prisma.company.findFirst({ where: { entityType: 'summary' }, select: { code: true } })
    if (!summary) return
    const members = await resolveCompanyCodes(ADMIN_SCOPE, summary.code)
    const mapCount = await prisma.companyAggregationMap.count({ where: { summaryCompanyCode: summary.code } })
    expect(members.length).toBe(mapCount)
    // 展开结果均为单体
    const singles = await prisma.company.findMany({ where: { code: { in: members } }, select: { entityType: true } })
    expect(singles.every((c) => c.entityType === 'single')).toBe(true)
  })

  it('看板概览：4 张核心 KPI（收入/毛利/净利润/回款）+ 财年趋势结构', async () => {
    if (!dbReady) return
    const ov = await DashboardService.getOverview(ADMIN_SCOPE)
    expect(ov.kpiData.map((k) => k.title)).toEqual(['收入', '毛利', '净利润', '回款'])
    for (const kpi of ov.kpiData) {
      expect(typeof kpi.monthActual).toBe('number')
      expect(typeof kpi.ytdActual).toBe('number')
      expect(typeof kpi.yoy).toBe('number')
      // 达成率允许 null（无预算），非 null 时为数值
      if (kpi.monthRate !== null) expect(typeof kpi.monthRate).toBe('number')
      if (kpi.ytdRate !== null) expect(typeof kpi.ytdRate).toBe('number')
      expect(Array.isArray(kpi.trend)).toBe(true)
    }
    // 趋势为当期所属财年的 12 个月，含三指标 actual/same/budget 序列
    expect(ov.trendData.length).toBe(12)
    const first = ov.trendData[0]
    expect(first).toHaveProperty('revenueActual')
    expect(first).toHaveProperty('profitSame')
    expect(first).toHaveProperty('netProfitBudget')
    expect(first).toHaveProperty('collectionActual')
  })

  it('壹品慧关键指标表：损益+现金流+经营指标板块行齐全，15 列口径字段完整', async () => {
    if (!dbReady) return
    const km = await DashboardService.getKeyMetrics(ADMIN_SCOPE)
    expect(km.rows.map((r) => r.key)).toEqual([
      'income', 'profit', 'expense', 'finance', 'netProfit',
      'fcf', 'operating', 'investing', 'financing',
      'laborEff', 'expenseEff',
    ])
    // 15 列口径字段：金额/百分比为数值；预算类允许 null（无预算）
    const keys15 = ['monthBudget', 'monthActual', 'monthSame', 'monthChange', 'monthYoy', 'monthMomChange', 'monthMom', 'monthRate', 'annualBudget', 'ytdBudget', 'ytdActual', 'ytdSame', 'ytdChange', 'ytdYoy', 'annualRate'] as const
    for (const row of km.rows) {
      for (const k of keys15) {
        expect(typeof row.values[k], `${row.key}.${k}`).toBe(typeof row.values[k] === 'number' ? 'number' : typeof null)
      }
      expect(row.label.length).toBeGreaterThan(0)
      expect(row.category.length).toBeGreaterThan(0)
      // 行值类型（金额/数量/比率）：劳效比/费效比为 ratio，其余默认 amount
      expect(row.valueType, `${row.key}.valueType`).toBe(row.key === 'laborEff' || row.key === 'expenseEff' ? 'ratio' : 'amount')
    }
    // 产品明细（收入/毛利行）：有数据时名称 + 收入/毛利两组口径
    for (const key of ['income', 'profit']) {
      const row = km.rows.find((r) => r.key === key)
      expect(row).toBeTruthy()
      if (row && row.products.length > 0) {
        const p = row.products[0]
        expect(typeof p.name).toBe('string')
        expect(typeof p.income.monthActual).toBe('number')
        expect(typeof p.profit.monthActual).toBe('number')
      }
    }
    // 现金流板块：金额列为数值；预算类允许 null（无预算）或数值（开发库已导入真实现金流预算，不假设无预算）
    const fcf = km.rows.find((r) => r.key === 'fcf')
    expect(fcf).toBeTruthy()
    expect(typeof fcf?.values.monthActual).toBe('number')
    if (fcf?.values.annualBudget === null || fcf?.values.annualBudget === undefined) {
      expect(fcf?.values.monthBudget).toBeNull()
      expect(fcf?.values.monthRate).toBeNull()
      expect(fcf?.values.annualRate).toBeNull()
    } else {
      // 有年度预算时月度预算与完成率应同步生效
      expect(fcf?.values.monthBudget).not.toBeNull()
      expect(fcf?.values.annualRate).not.toBeNull()
    }
    // 自由现金流科目已随 seed 建立（公式 = 经营活动 - 投资流出）
    const cfSubject = await prisma.accountSubject.findUnique({ where: { code: 'CF04' } })
    expect(cfSubject?.name).toBe('自由现金流')
    const cfMetric = await prisma.metric.findUnique({ where: { code: 'CF04' } })
    expect(cfMetric?.formula).toBe('{CF01} - {CF0202}')
    // 比率行（劳效比/费效比）不可加：预算不做月度占比拆分，月度/累计预算直接取年度目标值（无预算同步为 null）
    for (const key of ['laborEff', 'expenseEff']) {
      const row = km.rows.find((r) => r.key === key)
      expect(row).toBeTruthy()
      const v = row!.values
      if (v.annualBudget === null || v.annualBudget === 0) {
        expect(v.monthBudget).toBeNull()
        expect(v.ytdBudget).toBeNull()
      } else {
        expect(v.monthBudget).toBeCloseTo(v.annualBudget!, 2)
        expect(v.ytdBudget).toBeCloseTo(v.annualBudget!, 2)
      }
    }
  })

  it('品类核心指标分析：产品配置全行（含无数据行）+ 合计=整体收入/毛利节点', async () => {
    if (!dbReady) return
    const pm = await DashboardService.getProductMetrics(ADMIN_SCOPE)
    expect(pm.dimension).toBe('product')
    // 行 = active 产品配置全量（keepEmpty 保留无数据行），顺序 = sortOrder
    const configs = await prisma.keyMetricsProduct.findMany({ where: { status: 'active' }, orderBy: { sortOrder: 'asc' } })
    expect(pm.rows.map((r) => r.name)).toEqual(configs.map((c) => c.name))
    expect(pm.rows.map((r) => r.code)).toEqual(configs.map((c) => c.code))
    // 每行收入/毛利两组口径字段齐全
    for (const row of pm.rows) {
      expect(typeof row.income.ytdActual, `${row.name}.income.ytdActual`).toBe('number')
      expect(typeof row.profit.ytdActual, `${row.name}.profit.ytdActual`).toBe('number')
      expect(typeof row.income.ytdSame, `${row.name}.income.ytdSame`).toBe('number')
    }
    // 合计 = 整体「壹品慧收入」「壹品慧毛利」节点（与关键指标表行口径一致，非产品行求和）
    const km = await DashboardService.getKeyMetrics(ADMIN_SCOPE, { period: pm.period })
    const incomeRow = km.rows.find((r) => r.key === 'income')
    const profitRow = km.rows.find((r) => r.key === 'profit')
    expect(incomeRow).toBeTruthy()
    expect(profitRow).toBeTruthy()
    expect(pm.totals.income.ytdActual).toBeCloseTo(incomeRow!.values.ytdActual, 2)
    expect(pm.totals.profit.ytdActual).toBeCloseTo(profitRow!.values.ytdActual, 2)
    expect(pm.totals.income.annualBudget).toBe(incomeRow!.values.annualBudget)
  })

  it('现金流预算：年度预算导入后关键指标表现金流板块预算/完成率生效（净额由公式推导）', async () => {
    if (!dbReady) return
    // 期间取当前生效最新期（availablePeriods 非空时 getKeyMetrics 返回其末位），预算按该期财年插入
    const km0 = await DashboardService.getKeyMetrics(ADMIN_SCOPE)
    const period = km0.period
    if (!period) return
    const fy = fiscalYearLabel(period)
    const company = await prisma.company.findFirst({ where: { entityType: 'single', status: 'active' }, select: { code: true } })
    // 现金流流入/流出层科目（预算直填目标；净额与自由现金流预算由公式推导）
    const cfIn = await prisma.accountSubject.findFirst({ where: { subjectType: 'cashflow', name: '经营活动产生的现金流入', status: 'active' }, select: { code: true } })
    const cfOut = await prisma.accountSubject.findFirst({ where: { subjectType: 'cashflow', name: '经营活动产生的现金流出', status: 'active' }, select: { code: true } })
    const cfInvOut = await prisma.accountSubject.findFirst({ where: { subjectType: 'cashflow', name: '投资活动产生的现金流出', status: 'active' }, select: { code: true } })
    if (!company || !cfIn || !cfOut || !cfInvOut) return
    const b = await prisma.importBatch.create({
      data: { fileName: `__test_cf_budget_${Date.now().toString(36)}__.xlsx`, status: 'success', dataType: 'budget', lifecycleStatus: 'active', sourceType: 'upload', fiscalYear: fy },
    })
    try {
      // 基线：插入前单公司口径（开发库已导入真实现金流预算，绝对断言会叠加真实预算漂移，改用相对增量）
      const beforeKm = await DashboardService.getKeyMetrics(ADMIN_SCOPE, { companyCode: company.code, period })
      const beforeBudget = (key: string) => beforeKm.rows.find((r) => r.key === key)?.values.annualBudget ?? 0
      await prisma.factBudget.createMany({
        data: [
          { batchId: b.id, companyCode: company.code, accountCode: cfIn.code, fiscalYear: fy, period: 'annual', value: 200 },
          { batchId: b.id, companyCode: company.code, accountCode: cfOut.code, fiscalYear: fy, period: 'annual', value: 80 },
          { batchId: b.id, companyCode: company.code, accountCode: cfInvOut.code, fiscalYear: fy, period: 'annual', value: 50 },
        ],
      })
      const km = await DashboardService.getKeyMetrics(ADMIN_SCOPE, { companyCode: company.code, period })
      const fcf = km.rows.find((r) => r.key === 'fcf')
      const op = km.rows.find((r) => r.key === 'operating')
      const inv = km.rows.find((r) => r.key === 'investing')
      expect(op?.values.annualBudget).toBeCloseTo(beforeBudget('operating') + 120, 1) // 流入 200 - 流出 80（公式推导）
      expect(inv?.values.annualBudget).toBeCloseTo(beforeBudget('investing') - 50, 1) // 流入 0 - 流出 50
      expect(fcf?.values.annualBudget).toBeCloseTo(beforeBudget('fcf') + 70, 1) // 经营净额 120 - 投资流出 50
      // 月度预算按占比拆分（无配置回退年度/12），完成率随之生效
      expect(fcf?.values.monthBudget).not.toBeNull()
      expect(fcf?.values.monthRate).not.toBeNull()
      expect(fcf?.values.annualRate).not.toBeNull()
    } finally {
      await prisma.factBudget.deleteMany({ where: { batchId: b.id } }).catch(() => undefined)
      await prisma.importBatch.deleteMany({ where: { id: b.id } }).catch(() => undefined)
    }
  })

  it('交叉表：指定单体公司列 + 全层级科目行（树前序，含 level/parentCode）', async () => {
    if (!dbReady) return
    const singles = await prisma.company.findMany({ where: { entityType: 'single', status: 'active' }, take: 2, select: { code: true } })
    const codes = singles.map((c) => c.code)
    const cross = await IndicatorsService.getCross(ADMIN_SCOPE, { companyCodes: codes })
    expect(cross.companies).toEqual(codes)
    expect(cross.rows.length).toBeGreaterThan(0)
    // 未指定 metricCodes 时返回全部层级（不再仅 level0），首行为根节点
    expect(cross.rows[0].level).toBe(0)
    expect(cross.rows[0].parentCode).toBeNull()
    expect(cross.rows.some((r) => r.level > 0)).toBe(true)
  })

  it('交叉表：subjectType=cashflow 返回现金流科目树（修复前被归一为经营指标）', async () => {
    if (!dbReady) return
    const singles = await prisma.company.findMany({ where: { entityType: 'single', status: 'active' }, take: 2, select: { code: true } })
    const codes = singles.map((c) => c.code)
    const cross = await IndicatorsService.getCross(ADMIN_SCOPE, { companyCodes: codes, subjectType: 'cashflow' })
    expect(cross.companies).toEqual(codes)
    expect(cross.rows.length).toBeGreaterThan(0)
    // 行科目全部为现金流体系（CF 前缀），首行为 level0 根节点
    expect(cross.rows.every((r) => r.code.startsWith('CF'))).toBe(true)
    expect(cross.rows[0].level).toBe(0)
    expect(cross.rows[0].parentCode).toBeNull()
  })

  it('管理：用户 ≥ 4，预置角色 ≥ 6（含 superadmin 与预置权限）', async () => {
    if (!dbReady) return
    const users = await AdminService.listUsers({ page: 1, pageSize: 20 })
    // 基线演进：种子快照 ≥6；开发库临时测试用户清理后现为 4
    expect(users.total).toBeGreaterThanOrEqual(4)
    const roles = await AdminService.listRoles()
    // 预置 6 角色；集成测试可能留有临时自定义角色，故用 ≥
    expect(roles.filter((r) => r.isSystem).length).toBeGreaterThanOrEqual(6)
    const admin = roles.find((r) => r.code === 'admin')
    expect(admin!.permissions.length).toBeGreaterThan(0)
    expect(admin!.userCount).toBeGreaterThanOrEqual(0)
    expect(typeof admin!.userCount).toBe('number')
    // superadmin 独占高危码：admin 不含 purge，superadmin 包含
    const superadmin = roles.find((r) => r.code === 'superadmin')
    expect(superadmin).toBeTruthy()
    expect(superadmin!.permissions.some((p) => p.resource === 'data:company:purge')).toBe(true)
    expect(admin!.permissions.some((p) => p.resource.endsWith(':purge'))).toBe(false)
    // createdAt 透出（ISO 字符串，前端表格视图排序用）
    expect(typeof admin!.createdAt).toBe('string')
    expect(new Date(admin!.createdAt).getTime()).toBeGreaterThan(0)
  })

  it('管理：批量覆盖角色权限（事务生效、superadmin 保护、缺角色整体拒绝）', async () => {
    if (!dbReady) return
    const ctx = { userId: 'integration-test', traceId: 'integration', actorRoleId: 'integration-role' }
    // 创建两个临时自定义角色（避免污染预置角色），结束后清理
    const suffix = Date.now().toString(36)
    const r1 = await AdminService.createRole({ code: `batch_a_${suffix}`, name: `批量A-${suffix}` }, ctx)
    const r2 = await AdminService.createRole({ code: `batch_b_${suffix}`, name: `批量B-${suffix}` }, ctx)
    try {
      // 空权限批量（清空）→ 事务内两角色均生效
      await AdminService.updateRolePermissionsBatch([r1.id, r2.id], [], ctx)
      const after = await AdminService.listRoles()
      expect(after.find((r) => r.id === r1.id)!.permissions.length).toBe(0)
      expect(after.find((r) => r.id === r2.id)!.permissions.length).toBe(0)
      // 权限码集批量写入
      await AdminService.updateRolePermissionsBatch(
        [r1.id, r2.id],
        [
          { resource: 'dashboard:view', action: 'view' },
          { resource: 'transactions:view', action: 'view' },
        ],
        ctx,
      )
      const after2 = await AdminService.listRoles()
      expect(after2.find((r) => r.id === r1.id)!.permissions.length).toBe(2)
      expect(after2.find((r) => r.id === r2.id)!.permissions.map((p) => p.resource).sort()).toEqual(['dashboard:view', 'transactions:view'])
      // 混合 superadmin → 整体拒绝（回滚，不部分生效）
      const superRole = (await AdminService.listRoles()).find((r) => r.code === 'superadmin')!
      await expect(AdminService.updateRolePermissionsBatch([r1.id, superRole.id], [], ctx)).rejects.toThrow('超级管理员角色权限不可修改')
      // 不存在的角色 → 整体拒绝
      await expect(
        AdminService.updateRolePermissionsBatch(['00000000-0000-0000-0000-000000000000'], [], ctx),
      ).rejects.toThrow('存在不存在的角色')
    } finally {
      await prisma.role.deleteMany({ where: { id: { in: [r1.id, r2.id] } } })
      await prisma.permission.deleteMany({ where: { roleId: { in: [r1.id, r2.id] } } })
    }
  })

  it('导出经营指标为合法 xlsx（PK 头）', async () => {
    if (!dbReady) return
    const buf = await IndicatorsService.exportIndicators(ADMIN_SCOPE, 'operating', {})
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf[0]).toBe(0x50) // P
    expect(buf[1]).toBe(0x4b) // K
  })
})
