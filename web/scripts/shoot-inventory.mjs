// 截 /inventory 路由的 React 截图（视觉保真度验证 1:1 还原 antd-style-design/pages/inventory.html）
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const DESIGN_BASE = 'http://127.0.0.1:8001/pages'
const SLUG = 'inventory'

const AUTH_SEED = {
  state: {
    user: {
      id: 'audit-bot',
      username: 'audit',
      name: '视觉审计 Bot',
      role: 'superadmin',
      permissions: [
        'dashboard:view', 'dashboard:export',
        'indicators:view', 'indicators:export',
        'transactions:view', 'inventory:view',
        'reports:view', 'data:browse:view',
        'tools:view', 'admin:users:view', 'admin:roles:view',
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
    } else if (url.includes('/dashboard/overview')) {
      body = { code: 0, data: { kpiData: [], trendData: [], alerts: [], availablePeriods: ['2026-08'], lastUpdatedAt: new Date().toISOString(), companyCode: null, companyName: null, companyType: null, degraded: false, period: '2026-08' }, message: 'ok' }
    } else if (url.includes('/indicators/periods')) {
      body = { code: 0, data: { periods: ['2026-08'], fiscalYears: ['2026'], fiscalStartMonth: 1 }, message: 'ok' }
    } else if (url.includes('/inventory/')) {
      body = { code: 0, data: null, message: 'ok' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForReactReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(() => !document.querySelector('[aria-label="页面加载中"]'), { timeout: 30000 })
    .catch(() => {})
  await page.waitForSelector('text=库存总额', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=品类占比', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=存货明细表', { timeout: 30000 }).catch(() => {})
  // 关键：MainLayout 用 h-screen + overflow-hidden + main overflow-y-auto，
  // fullPage 截图只能拿到视口高度。需要把 main 的 overflow 临时改成 visible，
  // 并把根 h-screen 撑开，让 document 高度等于内容实际高度。
  await page.evaluate(() => {
    const root = document.querySelector('.flex.h-screen.overflow-hidden')
    if (root) {
      root.classList.remove('h-screen', 'overflow-hidden')
      root.style.height = 'auto'
      root.style.minHeight = '100vh'
    }
    document.querySelectorAll('main').forEach((m) => {
      m.classList.remove('overflow-y-auto')
      m.style.overflow = 'visible'
      m.style.height = 'auto'
    })
  })
  await page.waitForTimeout(400)
  await page.waitForSelector('text=智能音箱 Mini', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(600)
}

async function waitForDesignReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForSelector('text=库存总额', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })

  const browser = await chromium.launch({ headless: true })

  // React
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  await installApiMock(ctx)
  await ctx.addInitScript((seed) => {
    try { localStorage.setItem('auth-storage', JSON.stringify(seed)) } catch (e) {}
  }, AUTH_SEED)
  const page = await ctx.newPage()
  page.on('pageerror', (err) => console.log('[browser:pageerror]', err.message))
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('[browser:console.error]', msg.text()) })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${REACT_BASE}/inventory`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await waitForReactReady(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${REACT_BASE}/inventory`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await waitForReactReady(page)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await page.screenshot({ path: reactMobilePath, fullPage: true })
  const reactMobileBytes = (await stat(reactMobilePath)).size

  await browser.close()

  // Design
  const dBrowser = await chromium.launch({ headless: true })
  const dCtx = await dBrowser.newContext({ viewport: { width: 1440, height: 900 } })
  const dPage = await dCtx.newPage()
  const designUrl = `${DESIGN_BASE}/inventory.html`

  await dPage.setViewportSize({ width: 1440, height: 900 })
  await dPage.goto(designUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await waitForDesignReady(dPage)
  const designDesktopPath = join(AUDIT_DIR, 'design', `${SLUG}-desktop.png`)
  await dPage.screenshot({ path: designDesktopPath, fullPage: true })
  const designDesktopBytes = (await stat(designDesktopPath)).size

  await dPage.setViewportSize({ width: 390, height: 844 })
  await dPage.goto(designUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await waitForDesignReady(dPage)
  const designMobilePath = join(AUDIT_DIR, 'design', `${SLUG}-mobile.png`)
  await dPage.screenshot({ path: designMobilePath, fullPage: true })
  const designMobileBytes = (await stat(designMobilePath)).size

  await dBrowser.close()

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  const ratio = (r, d) => (d === 0 ? 'inf' : ((r / d) * 100).toFixed(1) + '%')
  console.log('===== 存货管理 / inventory =====')
  console.log('Design  desktop :', fmt(designDesktopBytes))
  console.log('React   desktop :', fmt(reactDesktopBytes), '   ratio =', ratio(reactDesktopBytes, designDesktopBytes))
  console.log('Design  mobile  :', fmt(designMobileBytes))
  console.log('React   mobile  :', fmt(reactMobileBytes), '   ratio =', ratio(reactMobileBytes, designMobileBytes))
  console.log('Target  : desktop ratio >= 100%')
  if (designDesktopBytes > 0 && reactDesktopBytes < designDesktopBytes) {
    console.log('[WARN] desktop screenshot below design baseline')
    process.exitCode = 2
  }
}

main().catch((err) => {
  console.error('[shoot] failed:', err)
  process.exit(1)
})
