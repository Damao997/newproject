// 只截分析报告中心 / reports-list 一个页面的 React 截图（用于本地验证高保真度，不走 39 页 audit）
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const SLUG = 'reports-list'

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
        'reports:create',
        'reports:update',
        'reports:export',
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
 * reports-list 页只读静态数据，但保留兼容旧请求 + 切 tab 时的潜在拉取。
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
    } else if (url.includes('/reports') && (url.includes('?') || url.endsWith('/reports'))) {
      // 兼容旧 useReports hook：返回空列表，避免 500
      body = { code: 0, data: { list: [], total: 0, page: 1, pageSize: 20 }, message: 'ok' }
    } else if (url.includes('/companies') && !url.includes('/companies/')) {
      body = { code: 0, data: { items: [], total: 0 }, message: 'ok' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function unlockBodyOverflow(page) {
  // 主布局 h-screen + overflow-hidden 会把 document.body 锁到 viewport 高度，
  // fullPage:true 只会截到 body.scrollHeight（=900px）。注入 CSS 解锁以捕获完整内容。
  await page.addStyleTag({
    content: `
      html, body, #root { height: auto !important; min-height: 0 !important; overflow: visible !important; }
      body { overflow-y: visible !important; }
      [class*="h-screen"] { height: auto !important; }
      main[class*="overflow-y-auto"], main[class*="overflow-auto"] { overflow: visible !important; height: auto !important; }
    `,
  }).catch(() => {})
}

async function waitForPageReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(() => !document.querySelector('[aria-label="页面加载中"]'), { timeout: 30000 })
    .catch(() => {})
  // 等待本页核心文案出现
  await page.waitForSelector('text=分析报告中心', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=2026年8月经营分析月报', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=订阅新报告', { timeout: 30000 }).catch(() => {})
  // 等动画/字体/进度条过渡完成
  await page.waitForTimeout(1200)
  await unlockBodyOverflow(page)
  await page.waitForTimeout(300)
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
    .goto(`${REACT_BASE}/reports`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  // React mobile
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .goto(`${REACT_BASE}/reports`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await page.screenshot({ path: reactMobilePath, fullPage: true })
  const reactMobileBytes = (await stat(reactMobilePath)).size

  await browser.close()

  // 同步对比 design 字节
  const designDesktopPath = join(AUDIT_DIR, 'design', `${SLUG}-desktop.png`)
  const designMobilePath = join(AUDIT_DIR, 'design', `${SLUG}-mobile.png`)
  let designDesktopBytes = 0
  let designMobileBytes = 0
  try { designDesktopBytes = (await stat(designDesktopPath)).size } catch {}
  try { designMobileBytes = (await stat(designMobilePath)).size } catch {}

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  console.log('===== 分析报告中心 / reports-list =====')
  console.log('Design desktop :', fmt(designDesktopBytes))
  console.log('React  desktop :', fmt(reactDesktopBytes))
  console.log('Design mobile  :', fmt(designMobileBytes))
  console.log('React  mobile  :', fmt(reactMobileBytes))

  const ratioDesktop = designDesktopBytes > 0 ? reactDesktopBytes / designDesktopBytes : 0
  const ratioMobile = designMobileBytes > 0 ? reactMobileBytes / designMobileBytes : 0
  console.log('Desktop ratio  :', (ratioDesktop * 100).toFixed(1) + '%')
  console.log('Mobile  ratio  :', (ratioMobile * 100).toFixed(1) + '%')

  if (designDesktopBytes > 0 && reactDesktopBytes < designDesktopBytes) {
    console.log('[WARN] desktop screenshot below design bytes')
    process.exitCode = 2
  }
  if (designMobileBytes > 0 && reactMobileBytes < designMobileBytes) {
    console.log('[WARN] mobile screenshot below design bytes')
    process.exitCode = 2
  }
}

main().catch((err) => {
  console.error('[shoot] failed:', err)
  process.exit(1)
})
