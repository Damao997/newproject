// 登录页（v6 精简门面）React + Design 双截图（用于本地验证高保真度）
// - React: 走 http://127.0.0.1:5173/login（Vite dev server）
// - Design: 走 http://127.0.0.1:8001/pages/login-v6.html（design static server）
// 用法：node scripts/shoot-login.mjs
// 产物：audit/screenshots/{design,react}/login-v6-{desktop,mobile}.png
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
const SLUG = 'login-v6'

/**
 * Mock 所有 /api/v1/* 响应：登录页是入口，不需业务数据，只需保证 /auth/login 成功
 * 避免任何 API 失败触发错误条/跳转，干扰视觉对照。
 */
async function installApiMock(ctx) {
  await ctx.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    let body = { code: 0, data: null, message: 'ok' }
    if (url.includes('/auth/login') || url.includes('/auth/auto-login')) {
      body = {
        code: 0,
        data: {
          accessToken: 'audit-token',
          refreshToken: 'audit-refresh',
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
        },
        message: 'ok',
      }
    } else if (url.includes('/auth/refresh')) {
      body = {
        code: 0,
        data: { accessToken: 'audit-token-rotated', refreshToken: 'audit-refresh-rotated' },
        message: 'ok',
      }
    } else if (url.includes('/auth/logout')) {
      body = { code: 0, data: null, message: 'ok' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForReactReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('.login-shell', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('.login-brand-mark', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('.login-pitch h1', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('.login-form-h', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('.login-submit', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
}

/**
 * 解除 login-shell 的 h-screen/overflow-hidden 锁定，让 document.scrollHeight 反映实际内容高度。
 */
async function expandLayoutForScreenshot(page) {
  await page.addStyleTag({
    content: `
      html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; }
      .login-shell { height: auto !important; min-height: 0 !important; }
      .min-h-screen { min-height: 0 !important; }
      .overflow-hidden { overflow: visible !important; }
    `,
  })
  await page.waitForTimeout(300)
}

async function waitForDesignReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('.login-shell', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('.login-brand-mark', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('.login-pitch h1', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('.login-form-h', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })

  const browser = await chromium.launch({ headless: true })

  // ─── Design 截图 ───
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
        .goto(`${DESIGN_BASE}/login-v6.html`, { waitUntil: 'networkidle', timeout: 30000 })
        .catch(() => {})
      await waitForDesignReady(page)
      await expandLayoutForScreenshot(page)
      const out = join(AUDIT_DIR, 'design', `${SLUG}-${vp.name}.png`)
      await page.screenshot({ path: out, fullPage: true })
    }
    await ctx.close()
  }

  // ─── React 截图 ───
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  await installApiMock(ctx)
  // 登录页是入口：不写 auth-storage（页面无论如何都会渲染登录表单）
  const page = await ctx.newPage()
  page.on('pageerror', (err) => console.log('[browser:pageerror]', err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser:console.error]', msg.text())
  })

  // React desktop
  await page.setViewportSize({ width: 1440, height: 900 })
  await page
    .goto(`${REACT_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForReactReady(page)
  await expandLayoutForScreenshot(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  // React mobile
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .goto(`${REACT_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
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
  console.log(`===== 登录 / ${SLUG} =====`)
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
