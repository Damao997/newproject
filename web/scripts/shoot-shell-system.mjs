// 04 / shell-system-v1: 截 React (/_design/antd-style) + Design (pages/shell-system-v1.html) 全页
// 目标：React desktop bytes >= Design desktop bytes
// 用法：node scripts/shoot-shell-system.mjs
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const DESIGN_BASE = 'http://127.0.0.1:8001/pages'
const SLUG = 'shell-system-v1'

const AUTH_SEED = {
  state: {
    user: { id: 'audit-bot', username: 'audit', name: '视觉审计 Bot', role: 'superadmin', permissions: ['dashboard:view','dashboard:export','indicators:view','indicators:export','transactions:view','transactions:import','transactions:create','transactions:update','transactions:export','inventory:view','reports:view','data:browse:view','data:reclassify','data:export','data:import','tools:view','admin:users:view','admin:roles:view'], dataScope: 'all', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    accessToken: 'audit-token', refreshToken: 'audit-refresh', isAuthenticated: true, persistentLoginToken: null,
  },
  version: 0,
}

async function installApiMock(ctx) {
  await ctx.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    let body = { code: 0, data: null, message: 'ok' }
    if (url.includes('/auth/refresh')) body = { code: 0, data: { accessToken: 'audit-token-rotated', refreshToken: 'audit-refresh-rotated' }, message: 'ok' }
    else if (url.includes('/auth/login') || url.includes('/auth/auto-login')) body = { code: 0, data: { accessToken: 'audit-token', refreshToken: 'audit-refresh', user: AUTH_SEED.state.user }, message: 'ok' }
    else if (url.includes('/auth/logout')) body = { code: 0, data: null, message: 'ok' }
    else if (url.includes('/companies') || url.includes('/data/companies')) body = { code: 0, data: [], message: 'ok' }
    else if (url.includes('/indicators/periods') || url.includes('/periods/available')) body = { code: 0, data: { periods: ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08'], fiscalYears: ['2026'], fiscalStartMonth: 1 }, message: 'ok' }
    else if (url.includes('/subjects')) body = { code: 0, data: { items: [], total: 0 }, message: 'ok' }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForReactReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForFunction(() => !document.querySelector('[aria-label="页面加载中"]'), { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=Shell System', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

async function expandLayoutForScreenshot(page) {
  await page.addStyleTag({ content: `html,body{height:auto!important;min-height:0!important;overflow:visible!important}.h-screen{height:auto!important;min-height:0!important}.min-h-screen{min-height:0!important}.overflow-hidden{overflow:visible!important}main,.flex-1{overflow:visible!important;height:auto!important;flex:0 0 auto!important}` })
  await page.waitForTimeout(300)
}

async function waitForDesignReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=Shell', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })

  const browser = await chromium.launch({ headless: true })

  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(`${DESIGN_BASE}/shell-system-v1.html`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
      await waitForDesignReady(page)
      await expandLayoutForScreenshot(page)
      const out = join(AUDIT_DIR, 'design', `${SLUG}-${vp.name}.png`)
      await page.screenshot({ path: out, fullPage: true })
    }
    await ctx.close()
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await installApiMock(ctx)
  await ctx.addInitScript((seed) => { try { localStorage.setItem('auth-storage', JSON.stringify(seed)) } catch (e) {} }, AUTH_SEED)
  const page = await ctx.newPage()
  page.on('pageerror', (err) => console.log('[browser:pageerror]', err.message))

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${REACT_BASE}/__design/antd-style`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await waitForReactReady(page)
  await expandLayoutForScreenshot(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${REACT_BASE}/__design/antd-style`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await waitForReactReady(page)
  await expandLayoutForScreenshot(page)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await page.screenshot({ path: reactMobilePath, fullPage: true })
  const reactMobileBytes = (await stat(reactMobilePath)).size

  const designDesktopBytes = (await stat(join(AUDIT_DIR, 'design', `${SLUG}-desktop.png`))).size
  const designMobileBytes = (await stat(join(AUDIT_DIR, 'design', `${SLUG}-mobile.png`))).size

  await browser.close()

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  const ratio = (r, d) => (d > 0 ? ((r / d) * 100).toFixed(1) + '%' : 'N/A')
  console.log(`===== 04 Shell System / ${SLUG} =====`)
  console.log(`Design desktop : ${fmt(designDesktopBytes)}`)
  console.log(`React  desktop : ${fmt(reactDesktopBytes)}  (${ratio(reactDesktopBytes, designDesktopBytes)} of design)`)
  console.log(`Design mobile  : ${fmt(designMobileBytes)}`)
  console.log(`React  mobile  : ${fmt(reactMobileBytes)}  (${ratio(reactMobileBytes, designMobileBytes)} of design)`)

  if (reactDesktopBytes < designDesktopBytes) { console.log(`[FAIL] desktop React (${reactDesktopBytes} B) < design (${designDesktopBytes} B)`); process.exitCode = 2 } else { console.log(`[PASS] desktop React >= design`) }
  if (reactMobileBytes < designMobileBytes) { console.log(`[FAIL] mobile React (${reactMobileBytes} B) < design (${designMobileBytes} B)`); process.exitCode = 2 } else { console.log(`[PASS] mobile React >= design`) }
}

main().catch((err) => { console.error('[shoot] failed:', err); process.exit(1) })
