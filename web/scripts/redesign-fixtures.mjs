// 独立预览与页面回归共用模拟接口，所有数字、身份、联系信息均为测试数据。
import { createPersonalFixtures } from './personal-fixtures.mjs'
import { readFileSync } from 'node:fs'
const permissionSource = readFileSync(new URL('../src/lib/permissions.ts', import.meta.url), 'utf8')
export const permissions = [...new Set([...permissionSource.matchAll(/'([a-z][\w-]*(?::[a-z][\w-]*){1,2})'/g)].map((match) => match[1]))]
export const user = { id: 'preview-user', username: 'preview', name: '预览账号', role: 'superadmin', permissions, dataScope: 'all', status: 'active', mustChangePassword: false, createdAt: '2026-01-01T00:00:00Z' }
export const auth = { state: { user, accessToken: 'mock-redesign-token', refreshToken: 'mock-redesign-refresh', isAuthenticated: true }, version: 0 }
export const companies = [
  { id: 'company-1', code: 'EN330001', name: '壹品慧杭州分公司（模拟）', shortName: '杭州分公司', type: 'entity', entityType: 'single', status: 'active' },
  { id: 'company-2', code: 'EN330002', name: '壹品慧宁波分公司（模拟）', shortName: '宁波分公司', type: 'entity', entityType: 'single', status: 'active' },
  { id: 'company-3', code: 'ET0001', name: '浙江汇总主体（模拟）', shortName: '浙江汇总', type: 'summary', entityType: 'summary', status: 'active' },
]
const stamp = '2026-09-30T08:30:00Z'
const scope = { period: '2026-09', companyCode: null, companyName: null, companyType: null, degraded: false }
const metric = (n) => ({ budget: n * 12, monthBudget: n, monthActual: n * .93, monthSame: n * .85, monthRate: 93, monthYoy: .094, ytdActual: n * 8.4, ytdSame: n * 7.5, ytdBudget: n * 9, ytdRate: 70, ytdCumRate: 93.33, ytdYoy: .12, monthPrev: n * .88, monthMom: .057 })
const group = (n) => ({ ...metric(n), annualBudget: n * 12, annualRate: 70, monthChange: n * .08, monthMomChange: n * .05, ytdChange: n * .9 })
const trend = Array.from({ length: 12 }, (_, i) => {
  const n = [740, 810, 770, 920, 940, 1010, 980, 1150, 1220, 1160, 1340, 1430][i]
  return { period: `2026-${String(i + 1).padStart(2, '0')}`, revenueActual: n, revenueSame: n * .86, revenueBudget: 1050, revenueYtdActual: n * (i + 1), revenueYtdSame: n * .86 * (i + 1), revenueYtdBudget: 1050 * (i + 1), profitActual: n * .23, profitSame: n * .21, profitBudget: 250, profitYtdActual: n * .23 * (i + 1), profitYtdSame: n * .21 * (i + 1), profitYtdBudget: 250 * (i + 1), netProfitActual: n * .07, netProfitSame: n * .06, netProfitBudget: 80, netProfitYtdActual: n * .07 * (i + 1), netProfitYtdSame: n * .06 * (i + 1), netProfitYtdBudget: 80 * (i + 1), collectionActual: n * .94 }
})
const kpis = ['收入', '毛利', '净利润', '回款'].map((title, i) => ({ title, monthActual: [1220.48, 283.21, 83.72, 1176.38][i], monthRate: [96.8, 90.1, 68.7, 104.3][i], ytdActual: [9847.38, 2320.18, 710.26, 9401.12][i], ytdRate: [78.6, 77.2, 64.3, 80.1][i], yoy: [.128, .084, -.057, .162][i], ytdYoy: [.0984, .1248, .1426, .0754][i], monthMom: [.0528, -.0214, 0, null][i], monthMomReason: i === 3 ? 'zero-base' : null, trend: trend.map((row) => row.revenueActual / (i + 1)) }))
const alerts = [
  { id: 'alert-1', severity: 'warning', title: '回款进度需关注', message: '部分客商存在逾期余额，建议查看应收账龄并跟进催收计划。', createdAt: stamp },
  { id: 'alert-2', severity: 'error', title: '费用预算偏离', message: '两项费用超过月度预算，请核对口径和实际支出。', createdAt: stamp },
  { id: 'alert-3', severity: 'info', title: '存货结构变化', message: '重点品类存货占比上升，可进入存货管理查看明细。', createdAt: stamp },
]
const categories = ['燃气具', '净水产品', '家用电器', '生活优选'].map((name, i) => ({ code: `CAT0${i + 1}`, name, current: [780, 520, 310, 190][i], yearStart: [740, 550, 280, 170][i], samePeriod: [710, 480, 290, 180][i], lastYearStart: 160, share: [780, 520, 310, 190][i] / 18, yoy: 8.4, rank: i + 1 }))
const inventory = { companyCount: 2, period: '2026-09', fiscalYear: '2026', total: { current: 1800, yearStart: 1740, samePeriod: 1660, lastYearStart: 1600 }, turnoverDays: { current: 47, samePeriod: 52 }, categories, companies: companies.slice(0, 2).map((c, i) => ({ ...c, current: 900 + i * 100, yearStart: 850, samePeriod: 820 })) }
const operating = ['壹品慧收入', '壹品慧毛利', '经营成果', '壹品慧回款'].map((name, i) => ({ code: ['PL02', 'PL04', 'PL06', 'PL01'][i], name, category: name, level: 0, dataType: 'calc', valueType: 'amount', budget: 12500 / (i + 1), actual: 1220 / (i + 1), samePeriod: 1100 / (i + 1), ytd: 9847 / (i + 1), samePeriodYtd: 8700 / (i + 1), children: ['燃气具', '净水产品', '其他业务'].map((child, j) => ({ code: `${['PL02', 'PL04', 'PL06', 'PL01'][i]}0${j + 1}`, name: `${child}${i === 1 ? '毛利' : '收入'}`, category: name, level: 1, dataType: 'data', valueType: 'amount', budget: 3000 / (i + 1), actual: 410 / (i + 1), samePeriod: 380 / (i + 1), ytd: 2800 / (i + 1), samePeriodYtd: 2460 / (i + 1), children: [] })) }))
const staticRows = ['总资产', '总负债', '净资产', '现金及现金等价物'].map((name, i) => ({ code: `BS0${i + 1}`, name, category: name, level: 0, dataType: 'data', valueType: 'amount', current: 4300 / (i + 1), samePeriod: 3800 / (i + 1), yearStart: 3980 / (i + 1), lastYearStart: 3680 / (i + 1), children: [] }))
const cashflow = ['经营活动', '投资活动', '筹资活动'].map((activity, i) => {
  const net = [430, -120, 80][i]
  const makeRow = (name, current, index) => ({
    ...staticRows[i], code: `CF0${i + 1}${index}`, name, category: activity,
    current, samePeriod: current * .9, ytd: current * 8, samePeriodYtd: current * 7,
    yoy: 11.1, ytdYoy: 14.3, children: [],
  })
  return { ...makeRow(`${activity}产生的现金流量`, net, 0), children: [
    makeRow(`${activity}产生的现金流入`, 600 / (i + 1), 1),
    makeRow(`${activity}产生的现金流出`, 600 / (i + 1) - net, 2),
  ] }
})
cashflow.push({ ...staticRows[3], code: 'CF04', name: '自由现金流', category: '自由现金流', current: 310, ytd: 2480, samePeriodYtd: 2170 })
const flatSubjects = [...operating, ...operating.flatMap((item) => item.children)].map((row, i) => ({ ...row, id: `subject-${i}`, isLeaf: !row.children.length, status: 'active', parentCode: row.level ? row.code.slice(0, -2) : null }))
const roles = [{ id: 'role-preview', code: 'superadmin', name: '超级管理员', description: '模拟角色', isSystem: true, permissions: permissions.map((code, i) => ({ id: `perm-${i}`, resource: code.split(':').slice(0, -1).join(':'), action: code.split(':').at(-1) })) }]
export const report = { id: 'preview-report', title: '浙江壹品慧九月经营分析（模拟）', fiscalYear: '2026', period: '2026-09', companyScope: { type: 'company', code: companies[0].code, name: companies[0].name }, status: 'draft', currentVersion: 3, createdBy: user.name, createdAt: stamp, updatedAt: stamp, sections: [
  { id: 'section-1', orderNo: 1, title: '经营概览', analysisId: null, source: null, missing: false, content: '<p>本期收入保持增长，毛利与回款进度较为稳定。下阶段重点关注费用偏离与逾期应收款。</p><h3>关键指标</h3><table><tbody><tr><th>指标</th><th>本月实际（万元）</th><th>月度达成率</th></tr><tr><td>收入</td><td>1,220.48</td><td>96.80%</td></tr><tr><td>毛利</td><td>283.21</td><td>90.10%</td></tr></tbody></table>' },
  { id: 'section-2', orderNo: 2, title: '重点关注与行动', analysisId: null, source: null, missing: false, content: '<p>加强重点客商回款跟进，按周核对催收计划；复核费用预算，分析偏离原因。</p><ul><li>核对逾期客商与责任业务员。</li><li>复核重点品类库存和周转天数。</li></ul>' },
] }
const versions = [3, 2, 1].map((versionNo) => ({ id: `version-${versionNo}`, versionNo, changeSummary: ['初稿', '补充费用说明', '更新经营结论'][versionNo - 1], changedBy: user.name, changedAt: stamp }))
const logs = Array.from({ length: 10 }, (_, i) => ({ id: `log-${i}`, type: i % 2 ? 'company' : 'subject_adjust', templateType: 'operating', sourceCompany: companies[0].code, targetCompany: companies[1].code, sourceSubject: 'PL0201', targetSubject: 'PL0202', period: '2026-09', periodFrom: null, periodTo: null, affectedRows: 12, operator: user.name, createdAt: stamp, revertedAt: i === 2 ? stamp : null, revertedBy: null, invalidatedAt: null, invalidatedReason: null, invalidation: null, revertible: i !== 2, detail: { transferMode: 'amount', transferValue: 5, adjustMode: 'both', decreaseAmount: 5, increaseAmount: 8, netChange: 3, reason: '模拟调整原因，检查长正文与预览布局。' } }))
const auditLogs = logs.map((log, i) => ({ id: log.id, createdAt: stamp, username: user.name, module: i % 2 ? 'data' : 'auth', action: i % 2 ? 'import' : 'login', detail: '模拟记录：用于检查时间线、详情与搜索布局', ip: '127.0.0.1', userAgent: '模拟浏览器', targetId: null }))
const periods = { periods: ['2026-08', '2026-09'], fiscalYears: ['2026'], fiscalStartMonth: 1 }
const aging = ['应收账款', '应付账款'].map((transactionType, i) => ({ transactionType, companyCode: companies[i].code, companyName: companies[i].name, counterpartyCode: `C0${i}`, counterpartyName: `模拟客商${i + 1}`, accountCode: '1122', accountDesc: '应收账款', closingBalance: 7800000, openingBalance: 7100000, aging: { '1个月': 4800000, '2个月': 1200000, '3个月': 800000, '4-6月': 400000, '半年以上': 300000, '1年至2年': 200000, '2年至3年': 50000, '3年以上': 50000 }, partyType: 'external', isInternal: false }))

export function resolveFixture(input, method = 'GET', scenario = 'success') {
  const url = new URL(input, 'http://127.0.0.1')
  const path = url.pathname.replace('/api/v1', '')
  const selectedCompany = companies.find(company => company.code === url.searchParams.get('companyCode')) ?? companies[2]
  const analysisScope = { ...scope, companyCode: selectedCompany.code, companyName: selectedCompany.name, companyType: selectedCompany.type === 'summary' ? 'summary' : 'single' }
  const paged = (items) => ({ items, total: items.length, page: Number(url.searchParams.get('page') || 1), pageSize: Number(url.searchParams.get('pageSize') || 10), totalPages: 1 })
  const ok = (data) => ({ code: 0, data, message: '模拟数据预览', traceId: 'preview-only' })
  if (scenario === 'error' && !path.startsWith('/auth') && !path.includes('/periods') && path !== '/data/companies') return { code: 1, data: null, message: '模拟请求失败，请重试', traceId: 'preview-only' }
  if (['/auth/login', '/auth/refresh', '/auth/auto-login'].includes(path)) return ok({ user, accessToken: auth.state.accessToken, refreshToken: auth.state.refreshToken })
  if (['/auth/me', '/auth/profile'].includes(path)) return ok(user)
  if (path === '/auth/logout') return ok(null)
  if (method !== 'GET' && path !== '/reports/chart-data') return { code: 1, data: null, message: '模拟预览不写入数据', traceId: 'preview-only' }
  if (path === '/data/companies') return ok(companies)
  if (path === '/data/aggregation-map') return ok(companies.slice(0, 2).map((company, i) => ({ id: `map-${i}`, summaryCompanyCode: 'ET0001', summaryCompanyName: companies[2].name, singleCompanyCode: company.code, singleCompanyName: company.name, isInternalElimination: false })))
  if (path === '/indicators/periods') return ok(periods)
  if (path === '/data/subjects/tree') return ok(flatSubjects)
  if (path === '/data/subjects') return ok(paged(flatSubjects))
  if (/^\/indicators\/(operating|static|cashflow)$/.test(path)) return ok({ ...paged(scenario === 'empty' ? [] : path.endsWith('static') ? staticRows : path.endsWith('cashflow') ? cashflow : operating), skippedReclassifyLogs: 0 })
  if (path === '/dashboard/overview' || path === '/dashboard/drill') return ok({ ...scope, kpiData: scenario === 'empty' ? [] : kpis, trendData: trend, alerts, lastUpdatedAt: stamp, availablePeriods: periods.periods })
  if (path === '/dashboard/trend') return ok(scenario === 'empty' ? [] : trend)
  if (path === '/dashboard/alerts') return ok(scenario === 'empty' ? [] : alerts)
  if (path === '/dashboard/receivables') return ok({ period: '2026-09', rows: companies.slice(0, 2).map((company, i) => ({ ...company, companyCode: company.code, companyName: company.name, balance: [730, 580][i], closingBalance: [730, 580][i], samePeriod: 650, yoy: .12 })) })
  if (path === '/dashboard/expense-analysis') return ok({ ...analysisScope, rows: ['人工费用', '营销费用', '租赁费用', '物流费用', '其他费用'].map((name, i) => ({ ...metric(70 / (i + 1)), code: `E0${i}`, name })) })
  if (path === '/dashboard/product-budget') return ok({ ...analysisScope, rows: categories.map((category) => ({ category: category.name, income: metric(category.current), profit: metric(category.current * .23) })) })
  if (path === '/dashboard/subject-budget') return ok({ period: '2026-09', mode: 'single', rows: companies.slice(0, 2).map((company) => ({ ...company, income: metric(900), profit: metric(210), netProfit: metric(75) })) })
  if (path === '/dashboard/analysis/key-metrics') return ok({ ...analysisScope, rows: operating.map((row, i) => ({ key: ['income', 'profit', 'netProfit', 'operating'][i], label: row.name, category: row.category, valueType: 'amount', products: [], values: group(1220 / (i + 1)) })) })
  if (path === '/dashboard/analysis/product-metrics') return ok({ ...analysisScope, dimension: 'product', rows: categories.map((row) => ({ code: row.code, name: row.name, income: group(row.current), profit: group(row.current * .23) })), totals: { income: group(1800), profit: group(450) } })
  if (path === '/inventory/overview') return ok(scenario === 'empty' ? { ...inventory, categories: [], companies: [] } : inventory)
  if (path === '/inventory/details') return ok({ period: '2026-09', rows: categories.map((category) => ({ companyCode: companies[0].code, companyName: companies[0].name, categoryCode: category.code, categoryName: category.name, accountCode: 'BS0103', accountName: category.name, current: category.current, yearStart: category.yearStart, samePeriod: category.samePeriod, lastYearStart: category.lastYearStart, companyShortName: '杭州分公司' })), totals: inventory.total })
  if (path === '/inventory/trend') return ok({ fiscalYear: '2026', months: trend.map((row) => row.period), total: trend.map((row) => row.revenueActual), byCompany: companies.slice(0, 2).map((company) => ({ code: company.code, name: company.name, values: trend.map((row) => row.revenueActual / 2) })) })
  if (path === '/transactions/overview') return ok(['应收账款', '其他应收款', '预收账款', '应付账款', '其他应付款', '预付账款'].map((transactionType, i) => {
    const row = aging[i % aging.length]
    return { transactionType, direction: ['预收账款', '应付账款', '其他应付款'].includes(transactionType) ? 'AP' : 'AR',
      totalClosingBalance: row.closingBalance, totalOpeningBalance: row.openingBalance, totalDebit: 800000,
      totalCredit: 100000, recordCount: 12, internalCount: 2, externalCount: 10, aging: row.aging }
  }))
  if (path === '/transactions/aging') return ok(scenario === 'empty' ? [] : aging)
  if (path === '/transactions/accounts') return ok([{ accountCode: '1122', accountDesc: '应收账款', hasData: true }])
  if (path === '/transactions/accounts/manage') return ok([{ code: '1122', name: '应收账款', transactionType: '应收账款', direction: 'AR', status: 'active', hasData: true }])
  if (path === '/transactions/counterparties') return ok([])
  if (path === '/transactions/periods' || path === '/transactions/fiscal-years') return ok(path.endsWith('periods') ? periods.periods : ['2026'])
  if (path === '/transactions/latest-cutoff') return ok({ period: '2026-09', cutoffDate: '2026-09-30' })
  if (path === '/transactions/trend') return ok({ periods: periods.periods, series: [] })
  if (path === '/transactions/import/coverage') return ok({ periods: periods.periods, companies, types: ['应收账款', '应付账款'], cells: [], summary: { expected: 12, active: 10, empty: 0, draft: 0, missing: 2, coverageRate: 83.33 }, draftBatches: [] })
  if (path === '/transactions/salesmen/manage') return ok(paged(logs.map((row, i) => ({ id: row.id, name: `模拟业务员 ${i + 1}`, companyCodes: [companies[0].code], companyNames: [companies[0].name], phone: '模拟联系方式', remark: '模拟预览', status: 'active' }))))
  if (path === '/transactions/salesmen') return ok([])
  if (path === '/transactions/collections/customers') return ok({ ...paged(aging.map((row, i) => ({ ...row, overdueAmount: 1000, billedUncollectedAmount: 240000, salesmanId: null, salesmanName: '模拟业务员', plannedDate: '2026-10-10', method: 'phone', actualAmount: 120000, planStatus: 'partial', planId: `plan-${i}` }))), stats: { byStatus: { partial: 2 }, totalBalance: 15600000 } })
  if (path === '/transactions/collections') return ok({ ...paged([]), stats: { byStatus: {}, totalOverdue: 0 } })
  if (path === '/data/reclassify/logs') return ok(paged(url.searchParams.get('type') === 'subject' ? [] : logs))
  if (path === '/data/consolidation/adjustments') return ok(paged(logs.map((row) => ({ ...row, summaryCompanyCode: 'ET0001', summaryCompanyName: companies[2].name, accountCode: 'PL0201', accountName: '燃气具收入', amount: 8, reason: '模拟抵消原因' }))))
  if (path === '/admin/users') return ok(paged([{ ...user, dataScopeCodes: [] }]))
  if (path === '/admin/roles') return ok(roles)
  if (path === '/admin/permissions') return ok(roles[0].permissions)
  if (path === '/admin/audit-logs') return ok(paged(auditLogs))
  if (path === '/admin/audit-logs/today-stats') return ok({ total: 10, byCategory: { login: 5, data: 5, perm: 0, sys: 0, other: 0 } })
  if (path === '/reports') return ok(paged([report]))
  if (path === '/reports/templates') return ok([])
  if (path === '/reports/analyses') return ok(paged([]))
  if (/^\/reports\/shared\//.test(path)) return ok({ ...report, status: 'published' })
  if (/^\/reports\/[^/]+\/versions$/.test(path)) return ok({ items: versions })
  if (/^\/reports\/[^/]+\/versions\/\d+$/.test(path)) return ok({ ...versions[0], snapshot: report })
  if (/^\/reports\/[^/]+\/share$/.test(path)) return ok({ enabled: false, url: null, token: null })
  if (path === '/reports/chart-data') return ok({ name: '模拟图表', actual: 1220, samePeriod: 1100, budget: 1300, current: 1220, yearStart: 1160 })
  if (/^\/reports\/[^/]+$/.test(path)) return ok(report)
  if (path === '/data/cross-table') return ok({ subjects: [], companies: [], rows: [], items: [], columns: [], values: {} })
  if (path === '/data/metrics' || path === '/data/imports') return ok(paged([]))
  if (/\/check$/.test(path)) return ok({ categories: [], products: [], mappings: [], candidates: [], uncoveredSubjects: [], brokenKeywords: [], missingProfitMirror: [], brokenCodes: [] })
  if (path === '/data/budget-ratios' || /\/budget-ratios\//.test(path)) return ok({ fiscalYear: url.searchParams.get('fiscalYear') || 'FY2026', ratios: Array(12).fill(100 / 12), annualTotal: 12500, monthlyAmounts: Array(12).fill(12500 / 12) })
  if (/history/.test(path)) return ok(paged([]))
  if (/product-categories|expense-mappings|subject-budget|key-metrics-products|templates|history/.test(path)) return ok([])
  return { code: 1, data: null, message: '该接口在模拟预览中未提供数据', traceId: 'preview-only' }
}

const browserPersonalFixtures = new WeakMap()
export function configureBrowserFixture(context, initial) { browserPersonalFixtures.set(context, createPersonalFixtures(initial)) }
export function resolveBrowserFixture(route, scenario = 'success') {
  const request = route.request()
  const context = request.frame().page().context()
  if (!browserPersonalFixtures.has(context)) browserPersonalFixtures.set(context, createPersonalFixtures())
  let body = {}
  if (request.headers()['content-type']?.includes('application/json')) {
    try { body = request.postDataJSON() ?? {} } catch { body = {} }
  }
  return browserPersonalFixtures.get(context)(request.url(), request.method(), body) ?? resolveFixture(request.url(), request.method(), scenario)
}
