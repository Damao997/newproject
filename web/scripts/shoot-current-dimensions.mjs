// Quick: take screenshot of current React page (before rewrite) for reference
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const SLUG = 'data-dimensions-operating'

const AUTH_SEED = {
  state: {
    user: {
      id: 'audit-bot',
      username: 'audit',
      name: '视觉审计 Bot',
      role: 'superadmin',
      permissions: [
        'dashboard:view',
        'dashboard:export',
        'indicators:view',
        'indicators:export',
        'transactions:view',
        'inventory:view',
        'reports:view',
        'data:browse:view',
        'data:subject:view',
        'data:subject:create',
        'data:subject:update',
        'data:subject:delete',
        'data:company:view',
        'data:company:create',
        'data:company:update',
        'data:company:delete',
        'data:metric:view',
        'data:metric:create',
        'data:metric:update',
        'data:metric:delete',
        'data:metric:approve',
        'data:metric:purge',
        'data:metric:convert',
        'data:export',
        'tools:view',
        'admin:users:view',
        'admin:roles:view',
      ],
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
    if (url.includes('/auth/refresh')) {
      body = { code: 0, data: { accessToken: 'audit-token-rotated', refreshToken: 'audit-refresh-rotated' }, message: 'ok' }
    } else if (url.includes('/auth/login') || url.includes('/auth/auto-login')) {
      body = { code: 0, data: { accessToken: 'audit-token', refreshToken: 'audit-refresh', user: AUTH_SEED.state.user }, message: 'ok' }
    } else if (url.includes('/auth/logout')) {
      body = { code: 0, data: null, message: 'ok' }
    } else if (url.includes('/indicators/periods')) {
      body = { code: 0, data: { periods: ['2026-08'], fiscalYears: ['2026'], fiscalStartMonth: 1 }, message: 'ok' }
    } else if (url.includes('/subjects')) {
      body = { code: 0, data: { items: [], total: 0 }, message: 'ok' }
    } else if (url.includes('/subject-tree')) {
      body = { code: 0, data: [], message: 'ok' }
    } else if (url.includes('/companies')) {
      body = { code: 0, data: [], message: 'ok' }
    } else if (url.includes('/dashboard/overview')) {
      body = { code: 0, data: { kpiData: [], trendData: [], alerts: [], availablePeriods: ['2026-08'], lastUpdatedAt: new Date().toISOString(), companyCode: null, companyName: null, companyType: null, degraded: false, period: '2026-08' }, message: 'ok' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await installApiMock(ctx)
  await ctx.addInitScript((seed) => {
    try { localStorage.setItem('auth-storage', JSON.stringify(seed)) } catch (e) {}
  }, AUTH_SEED)
  const page = await ctx.newPage()
  page.on('pageerror', (err) => console.log('[pageerror]', err.message))
  await page.goto(`${REACT_BASE}/data/dimensions/operating`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2000)
  const out = join(AUDIT_DIR, 'react', `${SLUG}-desktop-before.png`)
  await page.screenshot({ path: out, fullPage: true })
  const bytes = (await stat(out)).size
  console.log(`react (before) desktop: ${(bytes / 1024).toFixed(1)} KB (${bytes} B)`)
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
