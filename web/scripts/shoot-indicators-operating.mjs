// 只截经营指标 (indicators/operating) 这一个页面的截图（用于本地验证高保真度，不走 39 页 audit）
// 1) 截 design HTML（file:// 本地文件）
// 2) 截 React 渲染（http://127.0.0.1:5173/indicators/operating）
// 3) 比对 desktop 字节数（目标 React ≥ 100% of design）
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 1 级向上：scripts/ → web/
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
// 设计稿 HTML 绝对路径（D:\flies\fy200-clone\antd-style-design\pages\indicators-operating.html）
const DESIGN_HTML = resolve(ROOT, '..', 'antd-style-design', 'pages', 'indicators-operating.html')
const SLUG = 'indicators-operating'

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
    } else if (url.includes('/indicators/operating')) {
      body = { code: 0, data: { items: [] }, message: 'ok' }
    } else if (url.includes('/indicators/cashflow')) {
      body = { code: 0, data: { items: [] }, message: 'ok' }
    } else if (url.includes('/indicators/static')) {
      body = { code: 0, data: { items: [] }, message: 'ok' }
    } else if (url.includes('/companies')) {
      body = { code: 0, data: [], message: 'ok' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForReactReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(() => !document.querySelector('[aria-label="页面加载中"]'), { timeout: 30000 })
    .catch(() => {})
  await page.waitForSelector('text=经营指标', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=营业收入(本月)', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=收入 / 利润趋势', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=收入构成 Top 5', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=经营指标明细', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=2026 财年热力图', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

/**
 * 主布局有 h-screen + overflow-hidden，fullPage 只能截到 viewport。
 * 注入 CSS 把外层和 main 都解除高度限制，让 fullPage 真正截到完整内容。
 */
async function unlockFullHeight(page) {
  await page.addStyleTag({
    content: `
      html, body { height: auto !important; min-height: 100% !important; overflow: visible !important; }
      body > div, body > div > div, main, [class*="overflow-y-auto"] { height: auto !important; max-height: none !important; overflow: visible !important; }
    `,
  })
}

async function captureDesign(browser, slug) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const url = pathToFileURL(DESIGN_HTML).href
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]
  const out = {}
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(500)
    const file = join(AUDIT_DIR, 'design', `${slug}-${vp.name}.png`)
    await page.screenshot({ path: file, fullPage: true })
    out[vp.name] = (await stat(file)).size
  }
  await ctx.close()
  return out
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })

  const browser = await chromium.launch({ headless: true })

  console.log('[1/2] capturing design baseline...')
  const designBytes = await captureDesign(browser, SLUG)
  console.log(`design desktop: ${(designBytes.desktop / 1024).toFixed(1)} KB (${designBytes.desktop} B)`)
  console.log(`design mobile : ${(designBytes.mobile / 1024).toFixed(1)} KB (${designBytes.mobile} B)`)

  console.log('[2/2] capturing react screenshots...')
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
    .goto(`${REACT_BASE}/indicators/operating`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForReactReady(page)
  await unlockFullHeight(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .goto(`${REACT_BASE}/indicators/operating`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForReactReady(page)
  await unlockFullHeight(page)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await page.screenshot({ path: reactMobilePath, fullPage: true })
  const reactMobileBytes = (await stat(reactMobilePath)).size

  await browser.close()

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  const desktopRatio = (reactDesktopBytes / designBytes.desktop) * 100
  const mobileRatio = (reactMobileBytes / designBytes.mobile) * 100

  console.log('===== 经营指标 / indicators-operating =====')
  console.log('React desktop :', fmt(reactDesktopBytes))
  console.log('React mobile  :', fmt(reactMobileBytes))
  console.log('Design desktop:', fmt(designBytes.desktop))
  console.log('Design mobile :', fmt(designBytes.mobile))
  console.log('Desktop ratio :', desktopRatio.toFixed(1) + '%')
  console.log('Mobile ratio  :', mobileRatio.toFixed(1) + '%')
  console.log('Target        : desktop >= 100% of design bytes')

  if (reactDesktopBytes < designBytes.desktop) {
    console.log(`[WARN] desktop screenshot below 100% target (current: ${desktopRatio.toFixed(1)}%)`)
    process.exitCode = 2
  } else {
    console.log(`[OK] desktop screenshot >= 100% of design (current: ${desktopRatio.toFixed(1)}%)`)
  }
}

main().catch((err) => {
  console.error('[shoot] failed:', err)
  process.exit(1)
})
