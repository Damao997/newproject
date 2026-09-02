#!/usr/bin/env node
// P0 验收：8 张设计稿 + 8 张 React 桌面/移动
import { chromium } from 'playwright'
import { stat, mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REPORT_PATH = join(ROOT, 'docs', 'design', 'audit', 'p0-acceptance.md')
const DESIGN_BASE = 'http://127.0.0.1:8001/pages'
const REACT_BASE = 'http://127.0.0.1:5173'

const P0 = [
  { html: 'dashboard.html',                          route: '/dashboard',                              slug: 'dashboard',                       title: '工作台 / 仪表盘' },
  { html: 'dashboard-analysis-keymetrics.html',      route: '/dashboard/analysis/key-metrics',          slug: 'analysis-keymetrics',             title: '关键指标分析' },
  { html: 'dashboard-analysis-cashflow.html',        route: '/dashboard/analysis/cash-flow',            slug: 'analysis-cashflow',               title: '现金流分析' },
  { html: 'dashboard-analysis-category-budget.html', route: '/dashboard/analysis/category-budget',     slug: 'analysis-category-budget',        title: '类别预算分析' },
  { html: 'dashboard-analysis-expense.html',         route: '/dashboard/analysis/expense',              slug: 'analysis-expense',                title: '费用分析' },
  { html: 'dashboard-analysis-inventory-aging.html', route: '/dashboard/analysis/inventory-aging',     slug: 'analysis-inventory-aging',        title: '库存账龄分析' },
  { html: 'dashboard-analysis-receivable-aging.html', route: '/dashboard/analysis/receivable-aging',   slug: 'analysis-receivable-aging',       title: '应收账龄分析' },
  { html: 'dashboard-analysis-subject-budget.html',  route: '/dashboard/analysis/subject-budget',      slug: 'analysis-subject-budget',         title: '科目预算分析' },
]

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile',  width: 390,  height: 844 },
]

const AUTH_SEED = {
  state: {
    user: {
      id: 'audit-bot', username: 'audit', name: '视觉审计 Bot', role: 'superadmin',
      permissions: [
        'dashboard:view', 'dashboard:export',
        'indicators:view', 'indicators:export',
        'transactions:view', 'inventory:view',
        'reports:view', 'data:browse:view',
        'tools:view', 'admin:users:view', 'admin:roles:view',
      ], dataScope: 'all', status: 'active',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    accessToken: 'audit-token', refreshToken: 'audit-refresh', isAuthenticated: true, persistentLoginToken: null,
  },
  version: 0,
}

async function installApiMock(ctx) {
  await ctx.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    let body = { code: 0, data: null, message: 'ok' }
    if (url.includes('/auth/refresh')) body = { code: 0, data: { accessToken: 'audit-token-rotated', refreshToken: 'audit-refresh-rotated' }, message: 'ok' }
    else if (url.includes('/auth/login') || url.includes('/auth/auto-login')) body = { code: 0, data: { accessToken: 'audit-token', refreshToken: 'audit-refresh', user: AUTH_SEED.state.user }, message: 'ok' }
    else if (url.includes('/auth/logout')) body = { code: 0, data: null, message: 'ok' }
    else if (url.includes('/dashboard/overview')) body = { code: 0, data: { kpiData: [], trendData: [], alerts: [], availablePeriods: ['2026-08'], lastUpdatedAt: new Date().toISOString(), companyCode: null, companyName: null, companyType: null, degraded: false, period: '2026-08' }, message: 'ok' }
    else if (url.includes('/indicators/periods')) body = { code: 0, data: { periods: ['2026-08'], fiscalYears: ['2026'], fiscalStartMonth: 1 }, message: 'ok' }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForPageReady(page, slug) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForFunction(() => !document.querySelector('[aria-label="页面加载中"]'), { timeout: 30000 }).catch(() => {})
  // 等待 KPI 磁贴出现
  const selectors = {
    'dashboard': 'text=本月营收',
    'analysis-keymetrics': 'text=关键指标',
    'analysis-cashflow': 'text=现金流入合计',
    'analysis-category-budget': 'text=预算执行',
    'analysis-expense': 'text=费用总额',
    'analysis-inventory-aging': 'text=库存总额',
    'analysis-receivable-aging': 'text=应收账款',
    'analysis-subject-budget': 'text=主体公司',
  }
  await page.waitForSelector(selectors[slug] || 'body', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

async function shootDesign(page, html, slug) {
  await page.goto(`${DESIGN_BASE}/${html}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(AUDIT_DIR, 'design', `${slug}-${vp.name}.png`), fullPage: true })
  }
}

async function shootReact(ctx, route, slug) {
  for (const vp of VIEWPORTS) {
    const page = await ctx.newPage()
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto(`${REACT_BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await waitForPageReady(page, slug)
    await page.screenshot({ path: join(AUDIT_DIR, 'react', `${slug}-${vp.name}.png`), fullPage: true })
    await page.close()
  }
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const designCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const designPage = await designCtx.newPage()

  const reactCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await installApiMock(reactCtx)
  await reactCtx.addInitScript((seed) => { try { localStorage.setItem('auth-storage', JSON.stringify(seed)) } catch (e) {} }, AUTH_SEED)

  const rows = []
  for (const item of P0) {
    process.stdout.write(`[P0] ${item.slug} ... `)
    const row = { slug: item.slug, title: item.title, html: item.html, route: item.route, design: { desktop: 0, mobile: 0 }, react: { desktop: 0, mobile: 0 }, notes: [] }
    try {
      await shootDesign(designPage, item.html, item.slug)
      row.design.desktop = (await stat(join(AUDIT_DIR, 'design', `${item.slug}-desktop.png`))).size
      row.design.mobile  = (await stat(join(AUDIT_DIR, 'design', `${item.slug}-mobile.png`))).size
    } catch (e) { row.notes.push(`design: ${e.message}`) }
    try {
      await shootReact(reactCtx, item.route, item.slug)
      row.react.desktop = (await stat(join(AUDIT_DIR, 'react', `${item.slug}-desktop.png`))).size
      row.react.mobile  = (await stat(join(AUDIT_DIR, 'react', `${item.slug}-mobile.png`))).size
    } catch (e) { row.notes.push(`react: ${e.message}`) }
    const ratio = row.design.desktop > 0 ? ((row.react.desktop / row.design.desktop) * 100).toFixed(0) : '-'
    console.log(`设计 ${(row.design.desktop/1024).toFixed(1)}KB / React ${(row.react.desktop/1024).toFixed(1)}KB (${ratio}%)`)
    rows.push(row)
  }

  await browser.close()

  const lines = []
  lines.push('# P0 视觉保真度验收报告')
  lines.push('')
  lines.push(`生成时间: ${new Date().toISOString()}`)
  lines.push(`设计稿服务器: ${DESIGN_BASE} (静态根 = D:\\flies\\fy200-clone\\antd-style-design)`)
  lines.push(`React 服务器 : ${REACT_BASE}`)
  lines.push(`视口: desktop 1440×900 + mobile 390×844`)
  lines.push('')
  lines.push('## 验收结论')
  const pass = rows.filter(r => r.design.desktop > 0 && r.react.desktop >= r.design.desktop * 0.7).length
  const fail = rows.filter(r => r.design.desktop > 0 && r.react.desktop < r.design.desktop * 0.7).length
  const avg = (rows.reduce((s, r) => s + (r.design.desktop > 0 ? r.react.desktop / r.design.desktop : 0), 0) / rows.length * 100).toFixed(0)
  lines.push(`- P0 共 8 页：✅ 达标 (≥70% 信息密度) ${pass} 页 / ❌ 未达标 ${fail} 页`)
  lines.push(`- 平均比率: ${avg}%`)
  lines.push('')
  lines.push('## 详细数据')
  lines.push('')
  lines.push('| 页面 | 路由 | 设计稿 desktop | React desktop | 比率 | 设计稿 mobile | React mobile | 状态 |')
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |')
  for (const r of rows) {
    const ratio = r.design.desktop > 0 ? ((r.react.desktop / r.design.desktop) * 100).toFixed(0) + '%' : '-'
    const status = r.design.desktop > 0 && r.react.desktop >= r.design.desktop * 0.7 ? '✅' : (r.design.desktop > 0 ? '❌' : '⚠️')
    lines.push(`| ${r.title} | ${r.route} | ${(r.design.desktop/1024).toFixed(1)} KB | ${(r.react.desktop/1024).toFixed(1)} KB | ${ratio} | ${(r.design.mobile/1024).toFixed(1)} KB | ${(r.react.mobile/1024).toFixed(1)} KB | ${status} |`)
  }
  lines.push('')
  await writeFile(REPORT_PATH, lines.join('\n'), 'utf8')
  console.log(`\nreport: ${REPORT_PATH}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
