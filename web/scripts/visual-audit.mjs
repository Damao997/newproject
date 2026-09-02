#!/usr/bin/env node
// 用 Playwright 把 antd-style-design 的 HTML 设计稿与 web 的 React 路由做对照截图。
// 跑法：node scripts/visual-audit.mjs
// 产物：audit/screenshots/{design,react}/*.png + docs/design/audit/gap-report.md
//
// 关键点（吸取 p0-acceptance.mjs 的经验）：
//   1. 注入 superadmin auth + mock 所有 /api/v1/*，避免 401 跳登录
//   2. permissions 留空 → usePermission 退化到 ROLE_PERMISSIONS[role]，自动拥有全部权限
//   3. 每个视口开新 page（避免共享状态污染 + 移动端布局缓存）
//   4. 每个页面用专属文本选择器等待渲染完成
//   5. fullPage + 高度 1800 视口，让长页一次性可见

import { chromium } from 'playwright'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REPORT_PATH = join(ROOT, 'docs', 'design', 'audit', 'gap-report.md')

const DESIGN_BASE = 'http://127.0.0.1:8001/pages'
const REACT_BASE = 'http://127.0.0.1:5173'

// HTML 文件名 -> React 路由 + 等待文本
const ROUTE_MAP = [
  // P0
  { html: 'dashboard.html', route: '/dashboard', slug: 'dashboard', title: '工作台 / 仪表盘', priority: 'P0', wait: '本月营业收入' },
  { html: 'dashboard-analysis-keymetrics.html', route: '/dashboard/analysis/key-metrics', slug: 'analysis-keymetrics', title: '关键指标分析', priority: 'P0', wait: '关键指标' },
  { html: 'dashboard-analysis-cashflow.html', route: '/dashboard/analysis/cash-flow', slug: 'analysis-cashflow', title: '现金流分析', priority: 'P0', wait: '现金流入' },
  { html: 'dashboard-analysis-category-budget.html', route: '/dashboard/analysis/category-budget', slug: 'analysis-category-budget', title: '类别预算分析', priority: 'P0', wait: '预算执行' },
  { html: 'dashboard-analysis-expense.html', route: '/dashboard/analysis/expense', slug: 'analysis-expense', title: '费用分析', priority: 'P0', wait: '费用' },
  { html: 'dashboard-analysis-inventory-aging.html', route: '/dashboard/analysis/inventory-aging', slug: 'analysis-inventory-aging', title: '库存账龄分析', priority: 'P0', wait: '库存' },
  { html: 'dashboard-analysis-receivable-aging.html', route: '/dashboard/analysis/receivable-aging', slug: 'analysis-receivable-aging', title: '应收账龄分析', priority: 'P0', wait: '应收' },
  { html: 'dashboard-analysis-subject-budget.html', route: '/dashboard/analysis/subject-budget', slug: 'analysis-subject-budget', title: '科目预算分析', priority: 'P0', wait: '主体' },
  // P1
  { html: 'data-board.html', route: '/data/board/category', slug: 'data-board-category', title: '数据看板 - 类别', priority: 'P1', wait: '类别' },
  { html: 'data-browse.html', route: '/data/browse', slug: 'data-browse', title: '数据浏览', priority: 'P1', wait: '数据浏览' },
  { html: 'data-dimensions.html', route: '/data/dimensions/operating', slug: 'data-dimensions-operating', title: '数据维度 - 经营', priority: 'P1', wait: '经营' },
  { html: 'data-import.html', route: '/data/import', slug: 'data-import', title: '数据导入', priority: 'P1', wait: '导入' },
  { html: 'data-reclassify.html', route: '/data/reclassify', slug: 'data-reclassify', title: '数据重分类', priority: 'P1', wait: '重分类' },
  { html: 'data-reclassify-consolidation.html', route: '/data/reclassify/consolidation', slug: 'data-reclassify-consolidation', title: '重分类 - 合并', priority: 'P1', wait: '合并' },
  { html: 'inventory.html', route: '/inventory', slug: 'inventory', title: '库存', priority: 'P1', wait: '库存' },
  { html: 'indicators-cashflow.html', route: '/indicators/cashflow', slug: 'indicators-cashflow', title: '现金流指标', priority: 'P1', wait: '现金流' },
  { html: 'indicators-operating.html', route: '/indicators/operating', slug: 'indicators-operating', title: '经营指标', priority: 'P1', wait: '经营' },
  { html: 'indicators-static.html', route: '/indicators/static', slug: 'indicators-static', title: '静态指标', priority: 'P1', wait: '指标' },
  { html: 'reports-list.html', route: '/reports', slug: 'reports-list', title: '报表列表', priority: 'P1', wait: '报表' },
  { html: 'reports-analyses.html', route: '/reports/analyses', slug: 'reports-analyses', title: '报表分析', priority: 'P1', wait: '分析' },
  { html: 'report-editor.html', route: '/reports/editor/demo', slug: 'report-editor', title: '报表编辑器', priority: 'P1', wait: '编辑器' },
  { html: 'transactions-overview.html', route: '/transactions/overview', slug: 'transactions-overview', title: '交易总览', priority: 'P1', wait: '交易' },
  { html: 'transactions-account-filter.html', route: '/transactions/account-filter', slug: 'transactions-account-filter', title: '交易 - 科目筛选', priority: 'P1', wait: '科目' },
  { html: 'transactions-aging.html', route: '/transactions/aging', slug: 'transactions-aging', title: '交易 - 账龄', priority: 'P1', wait: '账龄' },
  { html: 'transactions-coverage.html', route: '/transactions/coverage', slug: 'transactions-coverage', title: '交易 - 覆盖', priority: 'P1', wait: '覆盖' },
  { html: 'transactions-collections-plans.html', route: '/transactions/collections/plans', slug: 'transactions-collections-plans', title: '收款 - 计划', priority: 'P1', wait: '收款' },
  { html: 'transactions-collections-salesmen.html', route: '/transactions/collections/salesmen', slug: 'transactions-collections-salesmen', title: '收款 - 业务员', priority: 'P1', wait: '业务员' },
  // P2
  { html: 'login-v6.html', route: '/login?demo=1', slug: 'login-v6', title: '登录 v6', priority: 'P2', wait: '登录' },
  { html: 'no-access.html', route: '/no-access', slug: 'no-access', title: '无访问权限', priority: 'P2', wait: '权限' },
  { html: 'enterprise-lookup.html', route: '/tools/enterprise-lookup', slug: 'enterprise-lookup', title: '企业查询', priority: 'P2', wait: '企业' },
  { html: 'admin-users.html', route: '/admin/users', slug: 'admin-users', title: '用户管理', priority: 'P2', wait: '用户' },
  { html: 'admin-roles.html', route: '/admin/roles', slug: 'admin-roles', title: '角色管理', priority: 'P2', wait: '角色' },
  { html: 'admin-audit-logs.html', route: '/admin/audit-logs', slug: 'admin-audit-logs', title: '审计日志', priority: 'P2', wait: '审计' },
  { html: 'color-palette.html', route: '/__design/antd-style#sec-01', slug: 'color-palette', title: '色板', priority: 'P2', wait: '色板' },
  { html: 'component-library.html', route: '/__design/antd-style#sec-03', slug: 'component-library', title: '组件库', priority: 'P2', wait: '组件' },
  { html: 'design-tokens.html', route: '/__design/antd-style#sec-02', slug: 'design-tokens', title: '设计令牌', priority: 'P2', wait: '令牌' },
  { html: 'shell-system-v1.html', route: '/__design/antd-style#sec-04', slug: 'shell-system', title: 'Shell 系统', priority: 'P2', wait: 'Shell' },
  { html: 'responsive-mobile.html', route: '/__design/antd-style#sec-05', slug: 'responsive-mobile', title: '响应式 / 移动端', priority: 'P2', wait: '响应式' },
  { html: 'state-collection.html', route: null, slug: 'state-collection', title: '6 态合集（无 React 路由）', priority: 'P2', wait: null },
]

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1800 },
  { name: 'mobile', width: 390, height: 1800 },
]

// 注入 zustand persist 用的 superadmin 用户（绕过登录页）
// 关键：permissions 留空 → usePermission 退化到 ROLE_PERMISSIONS[role]，
//   superadmin 自动拥有全部权限码。若传 ['*']，hook 走 serverPermissions 分支
//   但 '*' 不匹配 'dashboard:view' 等具体码，会被 RequirePermission 拒绝。
const AUTH_SEED = {
  state: {
    user: {
      id: 'audit-bot',
      username: 'audit',
      name: '视觉审计 Bot',
      role: 'superadmin',
      permissions: [],
      dataScope: 'all',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    accessToken: 'audit-token',
    refreshToken: 'audit-refresh',
    isAuthenticated: true,
    persistentLoginToken: null,
  },
  version: 0,
}

function log(...args) {
  console.log('[audit]', ...args)
}

async function ensureDirs() {
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })
}

async function installApiMock(ctx) {
  await ctx.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    let body = { code: 0, data: null, message: 'ok' }
    if (url.includes('/auth/refresh')) body = { code: 0, data: { accessToken: 'audit-token-rotated', refreshToken: 'audit-refresh-rotated' }, message: 'ok' }
    else if (url.includes('/auth/login') || url.includes('/auth/auto-login')) body = { code: 0, data: { accessToken: 'audit-token', refreshToken: 'audit-refresh', user: AUTH_SEED.state.user }, message: 'ok' }
    else if (url.includes('/auth/logout')) body = { code: 0, data: null, message: 'ok' }
    else if (url.includes('/dashboard/overview')) body = { code: 0, data: { kpiData: [], trendData: [], alerts: [], availablePeriods: ['2026-08'], lastUpdatedAt: new Date().toISOString(), companyCode: null, companyName: null, companyType: null, degraded: false, period: '2026-08' }, message: 'ok' }
    else if (url.includes('/indicators/periods') || url.includes('/periods/available')) body = { code: 0, data: { periods: ['2026-08'], fiscalYears: ['2026'], fiscalStartMonth: 1 }, message: 'ok' }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function shootDesign(page, html, slug) {
  const url = `${DESIGN_BASE}/${html}`
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.waitForTimeout(300)
    const out = join(AUDIT_DIR, 'design', `${slug}-${vp.name}.png`)
    await page.screenshot({ path: out, fullPage: true })
  }
}

async function shootReact(ctx, route, slug, waitText) {
  const url = `${REACT_BASE}${route}`
  for (const vp of VIEWPORTS) {
    const page = await ctx.newPage()
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    if (waitText) {
      await page.waitForSelector(`text=${waitText}`, { timeout: 15000 }).catch(() => {})
    }
    // 设计快照页用 hash 锚点滚动到对应 section
    if (route.includes('#sec-')) {
      const hash = route.split('#')[1]
      await page.evaluate((id) => {
        const el = document.getElementById(id)
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' })
      }, hash).catch(() => {})
      await page.waitForTimeout(800)
    }
    // 长页（12+ 卡片）需要等懒加载 + 动画完成
    await page.waitForTimeout(2500)
    // 解除 MainLayout 的 h-screen/overflow-hidden 限制，让 fullPage 截到完整内容
    await page.addStyleTag({
      content: `
        html, body { height: auto !important; min-height: 100% !important; overflow: visible !important; }
        .h-screen, [class*="h-screen"] { height: auto !important; min-height: 100vh !important; }
        [class*="overflow-hidden"] { overflow: visible !important; }
        main[class*="overflow-y-auto"] { overflow: visible !important; height: auto !important; }
      `,
    }).catch(() => {})
    await page.waitForTimeout(500)
    const out = join(AUDIT_DIR, 'react', `${slug}-${vp.name}.png`)
    await page.screenshot({ path: out, fullPage: true })
    await page.close()
  }
}

async function main() {
  await ensureDirs()
  const browser = await chromium.launch({ headless: true })

  // 设计稿用独立 context（无需 auth）
  const designCtx = await browser.newContext({ viewport: { width: 1440, height: 1800 } })
  const designPage = await designCtx.newPage()

  // React 侧用带 mock + auth 的 context
  const reactCtx = await browser.newContext({
    viewport: { width: 1440, height: 1800 },
    deviceScaleFactor: 1,
  })
  await installApiMock(reactCtx)
  await reactCtx.addInitScript((seed) => {
    try {
      localStorage.setItem('auth-storage', JSON.stringify(seed))
    } catch (e) {}
  }, AUTH_SEED)

  // 未登录 context：用于 /login（已登录态会被登录页重定向走）
  const anonCtx = await browser.newContext({
    viewport: { width: 1440, height: 1800 },
    deviceScaleFactor: 1,
  })
  await installApiMock(anonCtx)
  await anonCtx.addInitScript(() => {
    try {
      localStorage.removeItem('auth-storage')
    } catch (e) {}
  })

  const rows = []

  for (const item of ROUTE_MAP) {
    log(`processing ${item.slug}`)
    const row = {
      slug: item.slug,
      title: item.title,
      priority: item.priority,
      html: item.html,
      route: item.route || '(无路由)',
      hasDesign: false,
      hasReact: false,
      designBytes: { desktop: 0, mobile: 0 },
      reactBytes: { desktop: 0, mobile: 0 },
      notes: [],
    }
    try {
      await shootDesign(designPage, item.html, item.slug)
      row.hasDesign = true
      row.designBytes.desktop = (await stat(join(AUDIT_DIR, 'design', `${item.slug}-desktop.png`))).size
      row.designBytes.mobile = (await stat(join(AUDIT_DIR, 'design', `${item.slug}-mobile.png`))).size
    } catch (e) {
      row.notes.push(`design 截图失败: ${e.message}`)
    }
    if (item.route) {
      try {
        // /login 必须用未登录 context 截（已登录态会被重定向走）
        const ctx = item.route.startsWith('/login') ? anonCtx : reactCtx
        await shootReact(ctx, item.route, item.slug, item.wait)
        row.hasReact = true
        row.reactBytes.desktop = (await stat(join(AUDIT_DIR, 'react', `${item.slug}-desktop.png`))).size
        row.reactBytes.mobile = (await stat(join(AUDIT_DIR, 'react', `${item.slug}-mobile.png`))).size
      } catch (e) {
        row.notes.push(`react 截图失败: ${e.message}`)
      }
    } else {
      row.notes.push('无对应 React 路由')
    }
    rows.push(row)
  }

  await browser.close()

  // 写 gap report
  const lines = []
  lines.push('# 视觉保真度差异报告')
  lines.push('')
  lines.push(`生成时间: ${new Date().toISOString()}`)
  lines.push(`总页数: ${rows.length}，设计稿存在: ${rows.filter(r => r.hasDesign).length}，React 可截: ${rows.filter(r => r.hasReact).length}`)
  lines.push('')
  lines.push('> 评估方法：每页用 Playwright 在 1440×1800（desktop）和 390×1800（mobile）双视口全页截图，')
  lines.push('> 字节数差异大、信息密度显著低于设计稿、关键区域空白均视为 P0。')
  lines.push('')
  lines.push('## 摘要')
  const p0Missing = rows.filter(r => r.priority === 'P0' && !r.hasReact)
  const p0Gap = rows.filter(r => r.priority === 'P0' && r.hasReact && r.hasDesign && r.reactBytes.desktop < r.designBytes.desktop * 0.4)
  lines.push(`- P0（核心分析 / 仪表盘）共 ${rows.filter(r => r.priority === 'P0').length} 页`)
  lines.push(`- P0 中 React 不可访问: ${p0Missing.length} 页`)
  lines.push(`- P0 中 React 截图字节 < 设计稿 40%: ${p0Gap.length} 页（信息密度明显不足）`)
  lines.push('')
  lines.push('## 详细清单')
  lines.push('')
  lines.push('| 优先级 | 页面 | HTML | React 路由 | 设计稿 (desktop KB) | React (desktop KB) | 比率 | 备注 |')
  lines.push('| --- | --- | --- | --- | ---: | ---: | ---: | --- |')
  for (const r of rows) {
    const designKb = r.hasDesign ? (r.designBytes.desktop / 1024).toFixed(1) : '-'
    const reactKb = r.hasReact ? (r.reactBytes.desktop / 1024).toFixed(1) : '-'
    const ratio = r.hasReact && r.hasDesign && r.designBytes.desktop > 0
      ? ((r.reactBytes.desktop / r.designBytes.desktop) * 100).toFixed(0) + '%'
      : '-'
    const note = r.notes.join('; ') || ''
    lines.push(`| ${r.priority} | ${r.title} | ${r.html} | ${r.route} | ${designKb} | ${reactKb} | ${ratio} | ${note} |`)
  }
  lines.push('')
  lines.push('## 重写顺序建议')
  lines.push('1. **P0**：`/dashboard` + 7 个 `/dashboard/analysis/*`（核心数据可视化和决策入口）')
  lines.push('2. **P1**：报表中心 `/reports/*`、交易中心 `/transactions/*`、数据中心 `/data/*`、指标中心 `/indicators/*`')
  lines.push('3. **P2**：管理后台 `/admin/*`、登录、工具页、设计快照')
  lines.push('')
  lines.push('## 截图文件')
  lines.push('- 设计稿：`audit/screenshots/design/*.png`')
  lines.push('- React 实际：`audit/screenshots/react/*.png`')
  lines.push('')

  await writeFile(REPORT_PATH, lines.join('\n'), 'utf8')
  log(`done. report: ${REPORT_PATH}`)
}

main().catch((err) => {
  console.error('[audit] failed:', err)
  process.exit(1)
})
