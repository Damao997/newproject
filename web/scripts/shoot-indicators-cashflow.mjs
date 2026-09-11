// 只截现金流指标 (indicators/cashflow) 这一个页面的 React 截图（用于本地验证高保真度，不走 39 页 audit）
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const SLUG = 'indicators-cashflow'

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

/**
 * Mock 所有 /api/v1/* 响应，让路由侧永远拿到 code:0，
 * 避免 401 触发跳转 /login?expired=1。
 */
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
    } else if (url.includes('/indicators/cashflow')) {
      body = { code: 0, data: { items: [] }, message: 'ok' }
    } else if (url.includes('/indicators/operating')) {
      body = { code: 0, data: { items: [] }, message: 'ok' }
    } else if (url.includes('/indicators/static')) {
      body = { code: 0, data: { items: [] }, message: 'ok' }
    } else if (url.includes('/companies')) {
      body = { code: 0, data: [], message: 'ok' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForPageReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(() => !document.querySelector('[aria-label="页面加载中"]'), { timeout: 30000 })
    .catch(() => {})
  // 等待本页核心文案出现（页头标题）
  await page.waitForSelector('text=现金流指标', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=经营活动现金流', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=月度趋势', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=5 段现金流明细表', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })

  const browser = await chromium.launch({ headless: true })

  // React desktop
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  await installApiMock(ctx)
  await ctx.addInitScript((seed) => {
    try {
      localStorage.setItem('auth-storage', JSON.stringify(seed))
    } catch (e) {}
  }, AUTH_SEED)
  const page = await ctx.newPage()
  page.on('pageerror', (err) => console.log('[browser:pageerror]', err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser:console.error]', msg.text())
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page
    .goto(`${REACT_BASE}/indicators/cashflow`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  // React mobile
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .goto(`${REACT_BASE}/indicators/cashflow`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await page.screenshot({ path: reactMobilePath, fullPage: true })
  const reactMobileBytes = (await stat(reactMobilePath)).size

  await browser.close()

  // 与设计稿对比字节数
  const designDesktopPath = join(AUDIT_DIR, 'design', `${SLUG}-desktop.png`)
  const designMobilePath = join(AUDIT_DIR, 'design', `${SLUG}-mobile.png`)
  let designDesktopBytes = 0
  let designMobileBytes = 0
  try { designDesktopBytes = (await stat(designDesktopPath)).size } catch (e) {}
  try { designMobileBytes = (await stat(designMobilePath)).size } catch (e) {}

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  console.log('===== 现金流指标 / indicators-cashflow =====')
  console.log('React desktop :', fmt(reactDesktopBytes))
  console.log('React mobile  :', fmt(reactMobileBytes))
  console.log('Design desktop:', fmt(designDesktopBytes))
  console.log('Design mobile :', fmt(designMobileBytes))
  const desktopRatio = designDesktopBytes > 0 ? (reactDesktopBytes / designDesktopBytes) * 100 : 0
  const mobileRatio = designMobileBytes > 0 ? (reactMobileBytes / designMobileBytes) * 100 : 0
  console.log('Desktop ratio :', desktopRatio.toFixed(1) + '%')
  console.log('Mobile ratio  :', mobileRatio.toFixed(1) + '%')
  if (designDesktopBytes > 0 && reactDesktopBytes < designDesktopBytes) {
    console.log('[WARN] desktop screenshot below design bytes')
    process.exitCode = 2
  }
}

main().catch((err) => {
  console.error('[shoot] failed:', err)
  process.exit(1)
})
