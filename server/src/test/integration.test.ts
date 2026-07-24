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

const ADMIN_SCOPE = { companyCode: null, orgScopeBu: null, scopeValue: '*' }
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
  it('公司主体 = 20（单体 EN + 汇总 ET）', async () => {
    if (!dbReady) return
    const companies = await DataService.listCompanies()
    expect(companies.length).toBe(20)
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

  it('静态指标：34 行', async () => {
    if (!dbReady) return
    const data = await IndicatorsService.getStatic(ADMIN_SCOPE, {})
    expect(data.total).toBe(34)
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

  it('看板概览：5 个 KPI 结构', async () => {
    if (!dbReady) return
    const ov = await DashboardService.getOverview(ADMIN_SCOPE)
    expect(ov.kpiData.length).toBe(5)
    expect(Array.isArray(ov.trendData)).toBe(true)
  })

  it('交叉表：指定单体公司列 + level0 行', async () => {
    if (!dbReady) return
    const singles = await prisma.company.findMany({ where: { entityType: 'single', status: 'active' }, take: 2, select: { code: true } })
    const codes = singles.map((c) => c.code)
    const cross = await IndicatorsService.getCross(ADMIN_SCOPE, { companyCodes: codes })
    expect(cross.companies).toEqual(codes)
    expect(cross.rows.length).toBeGreaterThan(0)
  })

  it('管理：用户 ≥ 5，角色 = 5（含预置权限）', async () => {
    if (!dbReady) return
    const users = await AdminService.listUsers({ page: 1, pageSize: 20 })
    expect(users.total).toBeGreaterThanOrEqual(5)
    const roles = await AdminService.listRoles()
    expect(roles.length).toBe(5)
    const admin = roles.find((r) => r.code === 'admin')
    expect(admin!.permissions.length).toBeGreaterThan(0)
  })

  it('导出经营指标为合法 xlsx（PK 头）', async () => {
    if (!dbReady) return
    const buf = await IndicatorsService.exportIndicators(ADMIN_SCOPE, 'operating', {})
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf[0]).toBe(0x50) // P
    expect(buf[1]).toBe(0x4b) // K
  })
})
