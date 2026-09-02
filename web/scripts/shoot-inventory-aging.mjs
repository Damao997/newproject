// 只截存货库龄页这一个页面的 React / 设计稿对比图
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const DESIGN_BASE = 'http://127.0.0.1:8001/pages'
const SLUG = 'inventory-aging'

const SUPERAUTH_PERMISSIONS = [
  'dashboard:view', 'dashboard:export',
  'indicators:view', 'indicators:export',
  'transactions:view', 'transactions:create', 'transactions:update', 'transactions:delete', 'transactions:import', 'transactions:export',
  'transactions:salesmen:view', 'transactions:salesmen:create', 'transactions:salesmen:update', 'transactions:salesmen:delete',
  'inventory:view', 'inventory:create', 'inventory:update', 'inventory:delete', 'inventory:import', 'inventory:export',
  'reports:view', 'reports:create', 'reports:update', 'reports:delete', 'reports:export',
  'data:browse:view', 'data:import:upload',
  'data:metric:create', 'data:metric:update', 'data:metric:delete',
  'data:company:create', 'data:company:update', 'data:company:delete',
  'data:subject:create', 'data:subject:update', 'data:subject:delete',
  'data:reclassify:company', 'data:reclassify:subject',
  'data:export',
  'tools:view',
  'admin:users:view', 'admin:users:create', 'admin:users:update', 'admin:users:delete', 'admin:users:reset-password', 'admin:users:export',
  'admin:roles:view', 'admin:roles:create', 'admin:roles:update', 'admin:roles:delete',
  'admin:permissions:view', 'admin:permissions:update',
  'data:metric:approve', 'data:import:rollback', 'data:import:archive', 'data:import:purge',
  'data:company:purge', 'data:subject:purge', 'data:metric:purge', 'data:metric:convert', 'admin:users:purge',
]

const AUTH_SEED = {
  state: {
    user: {
      id: 'audit-bot',
      username: 'audit',
      name: '视觉审计 Bot',
      role: 'superadmin',
      permissions: SUPERAUTH_PERMISSIONS,
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

async function installApiMock(ctx) {
  await ctx.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    let body = { code: 0, data: null, message: 'ok' }
    if (url.includes('/dashboard/analysis/key-metrics')) {
      body = { code: 0, data: { period: '2024-08', groups: [], rows: [] }, message: 'ok' }
    } else if (url.includes('/dashboard/overview')) {
      body = { code: 0, data: { kpiData: [], trendData: [], alerts: [], availablePeriods: ['2024-08'], lastUpdatedAt: new Date().toISOString(), companyCode: null, companyName: null, companyType: null, degraded: false, period: '2024-08' }, message: 'ok' }
    } else if (url.includes('/indicators/periods')) {
      body = { code: 0, data: { periods: ['2024-08'], fiscalYears: ['2024'], fiscalStartMonth: 1 }, message: 'ok' }
    } else if (url.includes('/auth/refresh')) {
      body = { code: 0, data: { accessToken: 'audit-token-rotated', refreshToken: 'audit-refresh-rotated' }, message: 'ok' }
    } else if (url.includes('/auth/login') || url.includes('/auth/auto-login')) {
      body = { code: 0, data: { accessToken: 'audit-token', refreshToken: 'audit-refresh', user: AUTH_SEED.state.user }, message: 'ok' }
    } else if (url.includes('/auth/logout')) {
      body = { code: 0, data: null, message: 'ok' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForPageReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(
      () => !document.querySelector('[aria-label="页面加载中"]'),
      { timeout: 30000 },
    )
    .catch(() => {})
  await page
    .waitForSelector('text=库龄结构', { timeout: 30000 })
    .catch(() => {})
  await page.waitForTimeout(800)
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })

  const browser = await chromium.launch({ headless: true })

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  await installApiMock(ctx)
  await ctx.addInitScript((seed) => {
    try { localStorage.setItem('auth-storage', JSON.stringify(seed)) } catch (e) {}
  }, AUTH_SEED)
  const reactPage = await ctx.newPage()

  // React desktop
  await reactPage.setViewportSize({ width: 1440, height: 900 })
  await reactPage.goto(`${REACT_BASE}/dashboard/analysis/inventory-aging`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await waitForPageReady(reactPage)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await reactPage.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  // React mobile
  await reactPage.setViewportSize({ width: 390, height: 844 })
  await reactPage.goto(`${REACT_BASE}/dashboard/analysis/inventory-aging`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await waitForPageReady(reactPage)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await reactPage.screenshot({ path: reactMobilePath, fullPage: true })
  const reactMobileBytes = (await stat(reactMobilePath)).size

  // Design desktop
  const designCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const designPage = await designCtx.newPage()
  await designPage.goto(`${DESIGN_BASE}/dashboard-analysis-inventory-aging.html`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await designPage.waitForTimeout(800)
  const designDesktopPath = join(AUDIT_DIR, 'design', `${SLUG}-desktop.png`)
  await designPage.screenshot({ path: designDesktopPath, fullPage: true })
  const designDesktopBytes = (await stat(designDesktopPath)).size

  await browser.close()

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  console.log('===== 存货库龄 / inventory-aging =====')
  console.log('React desktop :', fmt(reactDesktopBytes))
  console.log('React mobile  :', fmt(reactMobileBytes))
  console.log('Design desktop:', fmt(designDesktopBytes))
  const ratio = designDesktopBytes > 0 ? (reactDesktopBytes / designDesktopBytes * 100).toFixed(1) : 'n/a'
  console.log('Ratio desktop :', ratio + '%')
  console.log('Target ≥80 KB')
  if (reactDesktopBytes < 80 * 1024) {
    console.warn('WARN: React desktop < 80KB')
  } else {
    console.log('OK: React desktop ≥ 80KB')
  }
}

main().catch((err) => {
  console.error('[shoot] failed:', err)
  process.exit(1)
})
