// 只截交易总览（transactions/overview）这一个页面的 React 截图（用于本地验证高保真度，不走 39 页 audit）
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const SLUG = 'transactions-overview'

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
    } else if (url.includes('/transactions/overview')) {
      body = {
        code: 0,
        data: {
          kpi: {
            receivableTotal: 358.2,
            payableTotal: 215.7,
            prepaymentReceivedTotal: 86.3,
            prepaymentPaidTotal: 42.6,
            receivableMoM: 5.6,
            payableMoM: 0.8,
            prepaymentReceivedMoM: -12.4,
            prepaymentPaidMoM: 2.1,
          },
          trend: {
            months: ['3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月'],
            receivableBalance: [420, 380, 360, 340, 310, 290, 270, 250, 230],
            payableBalance: [180, 195, 210, 220, 215, 225, 220, 215, 210],
            receivableAdded: [30, 40, 45, 50, 55, 65, 70, 75, 85, 95],
            receivableReceived: [25, 32, 40, 42, 50, 55, 62, 68, 72, 80],
          },
          aging: {
            buckets: [
              { name: '30 天以内', amounts: { ok: 196.4, d30_60: 0, d60_90: 0, d90_180: 0, d180p: 0 }, pct: '55%' },
              { name: '31-60 天', amounts: { ok: 0, d30_60: 88.3, d60_90: 0, d90_180: 0, d180p: 0 }, pct: '25%' },
              { name: '61-90 天', amounts: { ok: 0, d30_60: 0, d60_90: 42.1, d90_180: 0, d180p: 0 }, pct: '12%' },
              { name: '91-180 天', amounts: { ok: 0, d30_60: 0, d60_90: 0, d90_180: 19.7, d180p: 0 }, pct: '5%' },
              { name: '180 天以上', amounts: { ok: 0, d30_60: 0, d60_90: 0, d90_180: 0, d180p: 11.7 }, pct: '3%' },
            ],
            overdueOver90: 31.4,
          },
          efficiency: {
            collectionRate: { value: 78, display: '78%', chip: '↑ 4.2 pp', note: '目标 ≥ 80%' },
            recoveryRate: { value: 67, display: '67%', chip: '↑ 1.8 pp', note: '重点关注行业均值 72%' },
            longAgingRatio: { value: 32, display: '32%', chip: '↑ 3.5 pp', note: '> 90 天 / 总应收' },
            dso: { value: 25, display: '25 天', chip: '↓ 2.1 天', note: '应收账款周转天数' },
          },
          topCustomers: [
            { rank: 1, name: '杭州绿城物业管理有限公司', desc: '物业服务 · 2025-12 入账', amount: '¥ 48.6 万' },
            { rank: 2, name: '宁波雅戈尔置业有限公司', desc: '工程款 · 2026-01 入账', amount: '¥ 36.4 万' },
            { rank: 3, name: '金华万科物业服务公司', desc: '增值服务 · 2026-02 入账', amount: '¥ 28.2 万' },
            { rank: 4, name: '温州龙湖智慧服务公司', desc: '物业服务 · 2026-03 入账', amount: '¥ 24.5 万' },
            { rank: 5, name: '绍兴碧桂园生活服务集团', desc: '增值服务 · 2026-04 入账', amount: '¥ 21.8 万' },
            { rank: 6, name: '嘉兴招商局物业有限公司', desc: '工程款 · 2026-04 入账', amount: '¥ 18.6 万' },
            { rank: 7, name: '湖州保利物业管理有限公司', desc: '物业服务 · 2026-05 入账', amount: '¥ 16.2 万' },
            { rank: 8, name: '台州世茂天成物业服务', desc: '增值服务 · 2026-05 入账', amount: '¥ 14.8 万' },
            { rank: 9, name: '丽水绿城生活服务公司', desc: '商品销售 · 2026-06 入账', amount: '¥ 12.4 万' },
            { rank: 10, name: '衢州龙湖智慧服务公司', desc: '物业服务 · 2026-06 入账', amount: '¥ 10.5 万' },
          ],
          period: '2026-08',
          companyName: '浙江壹品慧生活服务集团',
        },
        message: 'ok',
      }
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
  await page.waitForSelector('text=交易总览', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=应收账款合计', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=应收 / 应付月度趋势', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=关键效率指标', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=应收 Top 10 客户', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1200)
}

async function captureFullPage(page, path, targetWidth) {
  // 主布局 <main> 是 overflow-y-auto 固定高度滚动容器，fullPage 只截视口。
  // 暴力：把视口高度拉到 4200 让所有内容一次进入视口，再去掉 main 滚动限制保证全文档高度一致。
  await page.setViewportSize({ width: targetWidth, height: 4200 })
  await page.evaluate(() => {
    const m = document.querySelector('main')
    if (m) {
      m.style.overflow = 'visible'
      m.style.height = 'auto'
    }
    document.documentElement.style.height = 'auto'
    document.body.style.height = 'auto'
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path, fullPage: true })
}

async function makePage(ctx) {
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
  return page
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })

  const browser = await chromium.launch({ headless: true })

  // React desktop (DPR=1, 1440 宽)
  const dctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  const dpage = await makePage(dctx)
  await dpage
    .goto(`${REACT_BASE}/transactions/overview`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(dpage)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await captureFullPage(dpage, reactDesktopPath, 1440)
  const reactDesktopBytes = (await stat(reactDesktopPath)).size
  await dctx.close()

  // React mobile (DPR=2, 390 宽 → 物理像素 780，对齐设计稿 755 宽)
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  })
  const mpage = await makePage(mctx)
  await mpage
    .goto(`${REACT_BASE}/transactions/overview`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForPageReady(mpage)
  const reactMobilePath = join(AUDIT_DIR, 'react', `${SLUG}-mobile.png`)
  await captureFullPage(mpage, reactMobilePath, 390)
  const reactMobileBytes = (await stat(reactMobilePath)).size
  await mctx.close()

  await browser.close()

  const fmt = (n) => (n / 1024).toFixed(1) + ' KB (' + n + ' B)'
  console.log('===== 交易总览 / transactions-overview =====')
  console.log('React desktop :', fmt(reactDesktopBytes))
  console.log('React mobile  :', fmt(reactMobileBytes))
  console.log('Target desktop ≥ 137147 B (设计稿基准)')
  console.log('Target mobile  ≥ 154164 B (设计稿基准)')
  if (reactDesktopBytes < 137147) {
    console.log('[WARN] desktop screenshot below design baseline (137147 B)')
    process.exitCode = 2
  }
  if (reactMobileBytes < 154164) {
    console.log('[WARN] mobile screenshot below design baseline (154164 B)')
    process.exitCode = 2
  }
}

main().catch((err) => {
  console.error('[shoot] failed:', err)
  process.exit(1)
})
