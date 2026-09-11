// 调试：截屏 + 抓 HTML / 错误
import { chromium } from 'playwright'
import { writeFile, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const REACT_BASE = 'http://127.0.0.1:5173'
const OUT_DIR = join(ROOT, 'audit', 'screenshots', 'react')
const SLUG = 'analysis-keymetrics'

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
    user: { id: 'audit-bot', username: 'audit', name: '视觉审计 Bot', role: 'superadmin', permissions: SUPERAUTH_PERMISSIONS, dataScope: 'all', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    accessToken: 'audit-token', refreshToken: 'audit-refresh', isAuthenticated: true, persistentLoginToken: null,
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

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await installApiMock(ctx)
  await ctx.addInitScript((seed) => { try { localStorage.setItem('auth-storage', JSON.stringify(seed)) } catch (e) {} }, AUTH_SEED)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 300)) })
  try {
    await page.goto(`${REACT_BASE}/dashboard/analysis/key-metrics`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  } catch (e) { errs.push('goto: ' + e.message) }
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(
      () => !document.querySelector('[aria-label="页面加载中"]'),
      { timeout: 30000 },
    )
    .catch((e) => errs.push('skeleton-timeout: ' + e.message))
  await page
    .waitForSelector('text=月度变化热力', { timeout: 30000 })
    .catch((e) => errs.push('content-timeout: ' + e.message))
  await page.waitForTimeout(800)
  const url = page.url()
  const html = await page.content()
  const bodyText = await page.locator('body').innerText().catch(() => '(innerText err)')
  const mainHtml = await page.locator('main').innerHTML().catch(() => '(no main)')
  await page.screenshot({ path: join(OUT_DIR, `${SLUG}-desktop.png`), fullPage: true })
  await writeFile(join(OUT_DIR, `${SLUG}-debug.html`), html, 'utf8')
  await writeFile(join(OUT_DIR, `${SLUG}-main.html`), mainHtml.slice(0, 50000), 'utf8')
  await writeFile(join(OUT_DIR, `${SLUG}-debug.txt`), bodyText, 'utf8')
  await writeFile(join(OUT_DIR, `${SLUG}-errs.txt`), errs.slice(0, 10).join('\n'), 'utf8')
  const ssz = (await stat(join(OUT_DIR, `${SLUG}-desktop.png`)).catch(() => ({ size: 0 }))).size
  await browser.close()
  console.log('---- URL ----', url)
  console.log('---- ERRORS (first 10) ----')
  console.log(errs.slice(0, 10).join('\n') || '(none)')
  console.log('---- screenshot size ----', ssz)
  console.log('---- BODY TEXT (first 2000) ----')
  console.log(bodyText.slice(0, 2000) || '(empty)')
  console.log('---- MAIN HTML (first 1000) ----')
  console.log(mainHtml.slice(0, 1000) || '(empty)')
}

main().catch((err) => { console.error('failed:', err); process.exit(1) })
