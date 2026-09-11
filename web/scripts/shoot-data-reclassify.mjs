// 只截单体重分类这一个页面的 React 截图（用于本地验证高保真度，不走 39 页 audit）
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const SLUG = 'data-reclassify'

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
        'data:browse:export',
        'data:reclassify:company',
        'data:reclassify:subject',
        'data:dimensions:view',
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
  // 等待本页核心文案出现（入口卡标题）
  await page.waitForSelector('text=单体重分类', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=调整记录', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

/**
 * 解除 MainLayout 的 overflow 限制，让 fullPage 截图能捕获 main 内的完整滚动内容
 * （设计 HTML 的 body 自然可滚动 2169px；React 把滚动放在 main 内，导致 body 高度 = 视口）
 */
async function expandScrollForFullCapture(page) {
  await page.addStyleTag({
    content: `
      html, body { height: auto !important; overflow: visible !important; }
      [class*="h-screen"], [class*="overflow-hidden"] { height: auto !important; overflow: visible !important; }
      main, main[class*="overflow-y-auto"] { overflow: visible !important; height: auto !important; }
    `,
  })
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
    .goto(`${REACT_BASE}/data/reclassify`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  await expandScrollForFullCapture(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  // React mobile
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .goto(`${REACT_BASE}/data/reclassify`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  await expandScrollForFullCapture(page)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await page.screenshot({ path: reactMobilePath, fullPage: true })
  const reactMobileBytes = (await stat(reactMobilePath)).size

  await browser.close()

  // 对比 design 基准
  const designDesktopPath = join(AUDIT_DIR, 'design', `${SLUG}-desktop.png`)
  const designMobilePath = join(AUDIT_DIR, 'design', `${SLUG}-mobile.png`)
  const designDesktopBytes = (await stat(designDesktopPath)).size
  const designMobileBytes = (await stat(designMobilePath)).size

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  const pct = (a, b) => (b === 0 ? 0 : ((a / b) * 100).toFixed(1))

  console.log(`===== 单体重分类 / ${SLUG} =====`)
  console.log('React  desktop :', fmt(reactDesktopBytes), `(${pct(reactDesktopBytes, designDesktopBytes)}% of design)`)
  console.log('React  mobile  :', fmt(reactMobileBytes), `(${pct(reactMobileBytes, designMobileBytes)}% of design)`)
  console.log('Design desktop :', fmt(designDesktopBytes))
  console.log('Design mobile  :', fmt(designMobileBytes))

  if (reactDesktopBytes < designDesktopBytes) {
    console.log('[WARN] desktop screenshot below 100% design target')
    process.exitCode = 2
  }
  if (reactMobileBytes < designMobileBytes) {
    console.log('[WARN] mobile screenshot below 100% design target')
    process.exitCode = 2
  }
}

main().catch((err) => {
  console.error('[shoot] failed:', err)
  process.exit(1)
})
