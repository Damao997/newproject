import { describe, it, expect, beforeAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { IndicatorsService } from '../services/IndicatorsService'
import { DashboardService } from '../services/DashboardService'
import { resolveCompanyCodes } from '../services/AggregationService'
import { DataService } from '../services/DataService'
import { AdminService } from '../services/AdminService'

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
  it('公司主体 = 19（13 单体 + 6 在用汇总）', async () => {
    if (!dbReady) return
    // 基准演进：种子快照 20（10 单体 + ET0001~ET0010）；2026-08-03 主数据维护新增 EN330057/EN330061
    // 两家单体，并停用 ET0003/ET0007/ET0008/ET0009 四家无映射成员的空壳汇总（审计日志可溯）；
    // 2026-08-05 又新增 EN330073 单体（13 单体 + 6 在用汇总 = 19）
    const companies = await DataService.listCompanies()
    expect(companies.length).toBe(19)
    expect(companies.some((c) => c.code.startsWith('EN'))).toBe(true)
    expect(companies.some((c) => c.code.startsWith('ET'))).toBe(true)
  })

  it('汇总映射已导入（company_aggregation_map 行数 > 0）', async () => {
    if (!dbReady) return
    const count = await prisma.companyAggregationMap.count()
    expect(count).toBeGreaterThan(0)
  })

  it('经营科目树根节点 8 个，首个为「回款」', async () => {
    if (!dbReady) return
    const tree = (await IndicatorsService.getTree('operating')) as { name: string }[]
    expect(tree.length).toBe(8)
    expect(tree[0].name).toBe('回款')
  })

  it('经营指标：admin 全量 152 行、公司数 = 单体数', async () => {
    if (!dbReady) return
    const data = await IndicatorsService.getOperating(ADMIN_SCOPE, {})
    expect(data.total).toBe(152)
    const singles = await prisma.company.count({ where: { entityType: 'single', status: 'active' } })
    expect(data.companyCount).toBe(singles)
    const revenue = data.items.find((r) => r.name === '收入')
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
    // superadmin 独占高危码：admin 不含 purge，superadmin 包含
    const superadmin = roles.find((r) => r.code === 'superadmin')
    expect(superadmin).toBeTruthy()
    expect(superadmin!.permissions.some((p) => p.resource === 'data:company:purge')).toBe(true)
    expect(admin!.permissions.some((p) => p.resource.endsWith(':purge'))).toBe(false)
  })

  it('导出经营指标为合法 xlsx（PK 头）', async () => {
    if (!dbReady) return
    const buf = await IndicatorsService.exportIndicators(ADMIN_SCOPE, 'operating', {})
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf[0]).toBe(0x50) // P
    expect(buf[1]).toBe(0x4b) // K
  })
})
