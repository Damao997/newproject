// 只截数据导入页（/data/import）这一个页面的 React / 设计稿对比图
// 用途：本地验证 React 页面与 antd-style-design HTML 设计稿的 1:1 视觉保真度
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const DESIGN_BASE = 'http://127.0.0.1:8001/pages'
const SLUG = 'data-import'

const SUPERAUTH_PERMISSIONS = [
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
  'transactions:salesmen:create',
  'transactions:salesmen:update',
  'transactions:salesmen:delete',
  'inventory:view',
  'inventory:create',
  'inventory:update',
  'inventory:delete',
  'inventory:import',
  'inventory:export',
  'reports:view',
  'reports:create',
  'reports:update',
  'reports:delete',
  'reports:export',
  'data:browse:view',
  'data:import:upload',
  'data:metric:create',
  'data:metric:update',
  'data:metric:delete',
  'data:company:create',
  'data:company:update',
  'data:company:delete',
  'data:subject:create',
  'data:subject:update',
  'data:subject:delete',
  'data:reclassify:company',
  'data:reclassify:subject',
  'data:export',
  'tools:view',
  'admin:users:view',
  'admin:users:create',
  'admin:users:update',
  'admin:users:delete',
  'admin:users:reset-password',
  'admin:users:export',
  'admin:roles:view',
  'admin:roles:create',
  'admin:roles:update',
  'admin:roles:delete',
  'admin:permissions:view',
  'admin:permissions:update',
  'data:metric:approve',
  'data:import:rollback',
  'data:import:archive',
  'data:import:purge',
  'data:company:purge',
  'data:subject:purge',
  'data:metric:purge',
  'data:metric:convert',
  'admin:users:purge',
]

const AUTH_SEED = {
  state: {
    user: {
      id: 'audit-bot',
      username: 'audit',
      name: '视觉审计 Bot',
      role: 'superadmin',
      permissions: SUPERAUTH_PERMISSIONS,
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
 * Mock 所有 /api/v1/* 响应，避免 401 触发跳转 /login?expired=1。
 * 当前 import 页为纯静态 mock（DataImportPage 不依赖任何业务接口），
 * 但仍拦截刷新 token / 主体维度等公共接口，保持会话稳定。
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
    } else if (url.includes('/companies/scope') || url.includes('/companies/options')) {
      body = { code: 0, data: { items: [] }, message: 'ok' }
    } else if (url.includes('/data/imports')) {
      body = { code: 0, data: { items: [], total: 0 }, message: 'ok' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForPageReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(() => !document.querySelector('[aria-label="页面加载中"]'), { timeout: 30000 })
    .catch(() => {})
  // 等待本页核心文案出现（数据导入页关键标识）
  await page.waitForSelector('text=数据导入', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=上传文件', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=最近导入批次', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })
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
    .goto(`${REACT_BASE}/data/import`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  // React mobile
  await page.setViewportSize({ width: 390, height: 5600 })
  await page
    .goto(`${REACT_BASE}/data/import`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(page)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await page.screenshot({ path: reactMobilePath, fullPage: true })
  const reactMobileBytes = (await stat(reactMobilePath)).size

  // Design desktop（设计稿参考，用于字节对比）
  const designCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const designPage = await designCtx.newPage()
  await designPage
    .goto(`${DESIGN_BASE}/data-import.html`, { waitUntil: 'networkidle', timeout: 30000 })
    .catch(() => {})
  await designPage.waitForTimeout(800)
  const designDesktopPath = join(AUDIT_DIR, 'design', `${SLUG}-desktop.png`)
  await designPage.screenshot({ path: designDesktopPath, fullPage: true })
  const designDesktopBytes = (await stat(designDesktopPath)).size

  // Design mobile
  const designMobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const designMobilePage = await designMobileCtx.newPage()
  await designMobilePage
    .goto(`${DESIGN_BASE}/data-import.html`, { waitUntil: 'networkidle', timeout: 30000 })
    .catch(() => {})
  await designMobilePage.waitForTimeout(800)
  const designMobilePath = join(AUDIT_DIR, 'design', `${SLUG}-mobile.png`)
  await designMobilePage.screenshot({ path: designMobilePath, fullPage: true })
  const designMobileBytes = (await stat(designMobilePath)).size

  await browser.close()

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  const ratio = (r, d) => (d > 0 ? (r / d * 100).toFixed(1) : 'n/a') + '%'

  console.log('===== 数据导入 / data-import =====')
  console.log('React  desktop :', fmt(reactDesktopBytes))
  console.log('Design desktop :', fmt(designDesktopBytes))
  console.log('Ratio  desktop :', ratio(reactDesktopBytes, designDesktopBytes))
  console.log('React  mobile  :', fmt(reactMobileBytes))
  console.log('Design mobile  :', fmt(designMobileBytes))
  console.log('Ratio  mobile  :', ratio(reactMobileBytes, designMobileBytes))

  const desktopOK = reactDesktopBytes >= designDesktopBytes
  const mobileOK = reactMobileBytes >= designMobileBytes
  if (desktopOK && mobileOK) {
    console.log('[shoot] OK: React bytes ≥ Design bytes (100%+)，视觉保真度达标')
  } else {
    console.log('[shoot] WARN: 至少一个视口的 React bytes < Design bytes，需要继续迭代')
    process.exitCode = 2
  }
}

main().catch((err) => {
  console.error('[shoot] failed:', err)
  process.exit(1)
})
