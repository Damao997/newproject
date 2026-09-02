// 只截「维度/科目体系 / 经营科目」这一个页面的 React 截图（用于本地验证高保真度）
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
        'data:dimension:view',
        'data:dimension:edit',
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
    } else if (url.includes('/dimension') || url.includes('/subject') || url.includes('/account')) {
      // 任何维度/科目相关请求统一回空数据（页面已用静态 mock，无需远端数据）
      body = { code: 0, data: { items: [], list: [], total: 0 }, message: 'ok' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForPageReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(() => !document.querySelector('[aria-label="页面加载中"]'), { timeout: 30000 })
    .catch(() => {})
  // 等待本页核心文案出现（设计稿标题 + 树表表头 + 至少一个根级行）
  await page.waitForSelector('text=维度与科目体系', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=经营科目', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=收入类', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

/**
 * 主布局 h-screen + overflow-hidden 会把 document.body 锁到 viewport 高度，
 * fullPage:true 只会截到 body.scrollHeight（=844px 移动端）。注入 CSS 解锁以捕获完整内容。
 */
async function unlockBodyOverflow(page) {
  await page
    .addStyleTag({
      content: `
        html, body, #root { height: auto !important; min-height: 0 !important; overflow: visible !important; }
        body { overflow-y: visible !important; }
        [class*="h-screen"] { height: auto !important; }
        main[class*="overflow-y-auto"], main[class*="overflow-auto"] { overflow: visible !important; height: auto !important; }
        div[class*="flex"][class*="h-screen"] { display: block !important; overflow: visible !important; height: auto !important; }
      `,
    })
    .catch(() => {})
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
    .goto(`${REACT_BASE}/data/dimensions/operating`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  await unlockBodyOverflow(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  // React mobile
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .goto(`${REACT_BASE}/data/dimensions/operating`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  await unlockBodyOverflow(page)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await page.screenshot({ path: reactMobilePath, fullPage: true })
  const reactMobileBytes = (await stat(reactMobilePath)).size

  await browser.close()

  // 读 design 端基线做对比
  const designDesktopBytes = (await stat(join(AUDIT_DIR, 'design', `${SLUG}-desktop.png`))).size
  const designMobileBytes = (await stat(join(AUDIT_DIR, 'design', `${SLUG}-mobile.png`))).size

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  console.log('===== 维度与科目体系 / 经营科目 / data-dimensions-operating =====')
  console.log('React desktop :', fmt(reactDesktopBytes), '| design:', fmt(designDesktopBytes), '|', (reactDesktopBytes / designDesktopBytes * 100).toFixed(1) + '%')
  console.log('React mobile  :', fmt(reactMobileBytes), '| design:', fmt(designMobileBytes), '|', (reactMobileBytes / designMobileBytes * 100).toFixed(1) + '%')
  if (reactDesktopBytes < designDesktopBytes) {
    console.log('[WARN] react desktop bytes < design desktop bytes')
    process.exitCode = 2
  }
  if (reactMobileBytes < designMobileBytes) {
    console.log('[WARN] react mobile bytes < design mobile bytes')
    process.exitCode = 3
  }
}

main().catch((err) => {
  console.error('[shoot] failed:', err)
  process.exit(1)
})
