// 只截「往来分析 · 科目过滤」这一个页面的 React 截图（用于本地验证高保真度，不走 39 页 audit）
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const DESIGN_BASE = 'http://127.0.0.1:8001/pages'
const SLUG = 'transactions-account-filter'

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
        'transactions:create',
        'transactions:update',
        'transactions:delete',
        'transactions:import',
        'transactions:export',
        'transactions:salesmen:view',
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
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForPageReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(() => !document.querySelector('[aria-label="页面加载中"]'), { timeout: 30000 })
    .catch(() => {})
  // 等待本页核心文案出现（科目过滤 / 命中明细表）
  await page.waitForSelector('text=科目过滤', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=命中明细表', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

/**
 * 解除 main-layout 的 overflow-hidden / h-screen 限制，
 * 让 fullPage 截图能真正捕获 main 内部滚动的全部内容。
 * 必须在每次 goto 后、截图前调用。
 */
async function expandForFullScreenshot(page) {
  await page.addStyleTag({
    content: `
      html, body, #root { height: auto !important; min-height: 100vh; overflow: visible !important; }
      body > div, body > div > div, main, [data-main-scroll] { height: auto !important; max-height: none !important; overflow: visible !important; }
    `,
  })
  await page.evaluate(() => {
    const root = document.getElementById('root')
    if (root) {
      root.style.height = 'auto'
      root.style.minHeight = '100vh'
      root.style.overflow = 'visible'
    }
    document.querySelectorAll('main, [class*="overflow"]').forEach((el) => {
      if (el instanceof HTMLElement) {
        el.style.overflow = 'visible'
        el.style.maxHeight = 'none'
        el.style.height = 'auto'
      }
    })
  })
  await page.waitForTimeout(200)
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })

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
    .goto(`${REACT_BASE}/transactions/account-filter`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  await expandForFullScreenshot(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  // React mobile
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .goto(`${REACT_BASE}/transactions/account-filter`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  await expandForFullScreenshot(page)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await page.screenshot({ path: reactMobilePath, fullPage: true })
  const reactMobileBytes = (await stat(reactMobilePath)).size

  // Design desktop（用于字节数对比）
  const designCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const designPage = await designCtx.newPage()
  await designPage
    .goto(`${DESIGN_BASE}/transactions-account-filter.html`, { waitUntil: 'networkidle', timeout: 30000 })
    .catch(() => {})
  await designPage.waitForTimeout(800)
  const designDesktopPath = join(AUDIT_DIR, 'design', `${SLUG}-desktop.png`)
  await designPage.screenshot({ path: designDesktopPath, fullPage: true })
  const designDesktopBytes = (await stat(designDesktopPath)).size

  await browser.close()

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  console.log('===== 科目过滤 / transactions-account-filter =====')
  console.log('React desktop :', fmt(reactDesktopBytes))
  console.log('React mobile  :', fmt(reactMobileBytes))
  console.log('Design desktop:', fmt(designDesktopBytes))
  const ratio = designDesktopBytes > 0 ? (reactDesktopBytes / designDesktopBytes * 100).toFixed(1) : 'n/a'
  console.log('Ratio desktop :', ratio + '%')
  console.log('Target ≥ 100% of design bytes')
  if (designDesktopBytes > 0 && reactDesktopBytes < designDesktopBytes) {
    console.warn(`WARN: React desktop (${reactDesktopBytes} B) < Design desktop (${designDesktopBytes} B)`)
    process.exitCode = 2
  } else {
    console.log('OK: React desktop ≥ Design desktop')
  }
}

main().catch((err) => {
  console.error('[shoot] failed:', err)
  process.exit(1)
})
