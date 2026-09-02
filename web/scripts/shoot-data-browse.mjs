// 只截交叉浏览 / data-browse 一个页面的 React + Design 双截图（用于本地验证高保真度）
// - React: 走 http://127.0.0.1:5173/data/browse（Vite dev server）
// - Design: 走 http://127.0.0.1:8001/pages/data-browse.html（design static server）
// 用法：node scripts/shoot-data-browse.mjs
// 产物：audit/screenshots/{design,react}/data-browse-{desktop,mobile}.png
// 目标：react desktop bytes >= design desktop bytes（视觉信息密度对齐设计稿）

import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const DESIGN_BASE = 'http://127.0.0.1:8001/pages'
const SLUG = 'data-browse'

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
        'data:reclassify',
        'data:export',
        'data:import',
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
    } else if (url.includes('/companies') || url.includes('/data/companies')) {
      body = { code: 0, data: [], message: 'ok' }
    } else if (url.includes('/indicators/periods') || url.includes('/periods/available')) {
      body = { code: 0, data: { periods: ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08'], fiscalYears: ['2026'], fiscalStartMonth: 1 }, message: 'ok' }
    } else if (url.includes('/subjects')) {
      body = { code: 0, data: { items: [], total: 0 }, message: 'ok' }
    } else if (url.includes('/cross-table') || url.includes('/browse')) {
      body = { code: 0, data: { companies: [], rows: [] }, message: 'ok' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForReactReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(() => !document.querySelector('[aria-label="页面加载中"]'), { timeout: 30000 })
    .catch(() => {})
  // 等待本页核心文案出现（交叉表标题）
  await page.waitForSelector('text=交叉表 · 营业收入', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=交叉浏览', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

/**
 * 解除 MainLayout 的 h-screen/overflow-hidden 锁定，让 document.scrollHeight 反映实际内容高度。
 * 默认布局是 sidebar+header 固定 + main overflow-y-auto，fullPage 截图只能截到 viewport。
 * 截图时通过注入 !important 全局样式强制：h-screen → height:auto, overflow-hidden → visible,
 * main overflow-y-auto → visible + height:auto，让内容自然撑开。
 * 设计稿是纯静态 HTML，无 MainLayout，注入的样式是 no-op（不影响）。
 */
async function expandLayoutForScreenshot(page) {
  await page.addStyleTag({
    content: `
      html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; }
      .h-screen { height: auto !important; min-height: 0 !important; }
      .min-h-screen { min-height: 0 !important; }
      .overflow-hidden { overflow: visible !important; }
      main, .flex-1 { overflow: visible !important; height: auto !important; flex: 0 0 auto !important; }
    `,
  })
  await page.waitForTimeout(300)
}

async function waitForDesignReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=交叉浏览', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })

  const browser = await chromium.launch({ headless: true })

  // ─── Design 截图（与 visual-audit.mjs 一致：只截设计稿静态 HTML） ───
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    })
    const page = await ctx.newPage()
    for (const vp of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page
        .goto(`${DESIGN_BASE}/data-browse.html`, { waitUntil: 'networkidle', timeout: 30000 })
        .catch(() => {})
      await waitForDesignReady(page)
      await expandLayoutForScreenshot(page)
      const out = join(AUDIT_DIR, 'design', `${SLUG}-${vp.name}.png`)
      await page.screenshot({ path: out, fullPage: true })
    }
    await ctx.close()
  }

  // ─── React 截图（注入 superadmin auth + 拦截 API 避免 401） ───
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

  // React desktop
  await page.setViewportSize({ width: 1440, height: 900 })
  await page
    .goto(`${REACT_BASE}/data/browse`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForReactReady(page)
  await expandLayoutForScreenshot(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  // React mobile
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .goto(`${REACT_BASE}/data/browse`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForReactReady(page)
  await expandLayoutForScreenshot(page)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await page.screenshot({ path: reactMobilePath, fullPage: true })
  const reactMobileBytes = (await stat(reactMobilePath)).size

  // 设计稿字节数（已在上面重新截取）
  const designDesktopBytes = (await stat(join(AUDIT_DIR, 'design', `${SLUG}-desktop.png`))).size
  const designMobileBytes = (await stat(join(AUDIT_DIR, 'design', `${SLUG}-mobile.png`))).size

  await browser.close()

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  const ratio = (r, d) => (d > 0 ? ((r / d) * 100).toFixed(1) + '%' : 'N/A')
  console.log(`===== 交叉浏览 / ${SLUG} =====`)
  console.log(`Design desktop : ${fmt(designDesktopBytes)}`)
  console.log(`React  desktop : ${fmt(reactDesktopBytes)}  (${ratio(reactDesktopBytes, designDesktopBytes)} of design)`)
  console.log(`Design mobile  : ${fmt(designMobileBytes)}`)
  console.log(`React  mobile  : ${fmt(reactMobileBytes)}  (${ratio(reactMobileBytes, designMobileBytes)} of design)`)
  console.log(`Target: React desktop >= Design desktop, React mobile >= Design mobile`)

  if (reactDesktopBytes < designDesktopBytes) {
    console.log(`[FAIL] desktop React (${reactDesktopBytes} B) < design (${designDesktopBytes} B)`)
    process.exitCode = 2
  } else {
    console.log(`[PASS] desktop React >= design`)
  }
  if (reactMobileBytes < designMobileBytes) {
    console.log(`[FAIL] mobile React (${reactMobileBytes} B) < design (${designMobileBytes} B)`)
    process.exitCode = 2
  } else {
    console.log(`[PASS] mobile React >= design`)
  }
}

main().catch((err) => {
  console.error('[shoot] failed:', err)
  process.exit(1)
})
