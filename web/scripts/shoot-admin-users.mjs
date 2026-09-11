// 只截用户管理 / admin-users 一个页面的 React + Design 双截图（用于本地验证高保真度）
// - React: 走 http://127.0.0.1:5173/admin/users（Vite dev server）
// - Design: 走 http://127.0.0.1:8001/pages/admin-users.html（design static server）
// 用法：node scripts/shoot-admin-users.mjs
// 产物：audit/screenshots/{design,react}/admin-users-{desktop,mobile}.png
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
const SLUG = 'admin-users'

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
        'admin:users:edit',
        'admin:users:create',
        'admin:users:delete',
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

const SAMPLE_USERS = [
  { id: 'u-001', name: '张伟', username: 'zhangwei', email: 'zhangwei@company.com', role: '超级管理员', company: '浙江壹品慧生活服务集团', lastLogin: '2026-08-26 09:42', status: 'active' },
  { id: 'u-002', name: '李娜', username: 'lina', email: 'lina@company.com', role: '财务总监', company: '华东大区总部', lastLogin: '2026-08-26 08:15', status: 'active' },
  { id: 'u-003', name: '王晓东', username: 'wangxd', email: 'wangxiaodong@company.com', role: '财务经理', company: '华南大区总部', lastLogin: '2026-08-25 17:38', status: 'active' },
  { id: 'u-004', name: '陈丽华', username: 'chenlh', email: 'chenlh@company.com', role: '业务主管', company: '物业服务-杭州分公司', lastLogin: '2026-08-26 10:05', status: 'active' },
  { id: 'u-005', name: '刘建国', username: 'liujg', email: 'liujg@company.com', role: '业务专员', company: '增值服务-上海分公司', lastLogin: '2026-08-25 14:22', status: 'active' },
  { id: 'u-006', name: '赵敏', username: 'zhaomin', email: 'zhaomin@company.com', role: '审计员', company: '集团审计部', lastLogin: '2026-08-20 11:48', status: 'active' },
  { id: 'u-007', name: '孙志强', username: 'sunzq_ext', email: 'sunzq@partner.com', role: '外部协作', company: '外部: 致同会计师事务所', lastLogin: '2026-08-19 09:30', status: 'active' },
  { id: 'u-008', name: '周晓燕', username: 'zhouxy', email: 'zhouxy@company.com', role: '业务专员', company: '工程业务-广州分公司', lastLogin: '2026-07-12 16:15', status: 'inactive' },
  { id: 'u-009', name: '吴磊', username: 'wulei', email: 'wulei@company.com', role: '业务主管', company: '商品销售-华东大区', lastLogin: '2026-08-26 09:08', status: 'active' },
  { id: 'u-010', name: '郑文博', username: 'zhengwb', email: 'zhengwb@company.com', role: '财务经理', company: '华北大区总部', lastLogin: '2026-08-25 11:55', status: 'active' },
  { id: 'u-011', name: '钱明', username: 'qianming', email: 'qianming@company.com', role: '业务专员', company: '物业服务-苏州分公司', lastLogin: '2026-08-26 08:48', status: 'active' },
  { id: 'u-012', name: '马丽', username: 'mali', email: 'mali@company.com', role: '业务主管', company: '商品销售-华南大区', lastLogin: '2026-08-25 16:20', status: 'active' },
  { id: 'u-013', name: '黄海燕', username: 'huanghy', email: 'huanghy@company.com', role: '业务专员', company: '增值服务-北京分公司', lastLogin: '2026-08-24 11:30', status: 'active' },
  { id: 'u-014', name: '林志远', username: 'linzy', email: 'linzy@company.com', role: '财务经理', company: '华东大区总部', lastLogin: '2026-08-23 09:12', status: 'active' },
  { id: 'u-015', name: '高雪', username: 'gaoxue', email: 'gaoxue@company.com', role: '业务专员', company: '物业服务-南京分公司', lastLogin: '2026-08-22 15:48', status: 'active' },
  { id: 'u-016', name: '韩磊', username: 'hanlei', email: 'hanlei@company.com', role: '业务专员', company: '工程业务-成都分公司', lastLogin: '2026-08-21 10:08', status: 'inactive' },
  { id: 'u-017', name: '冯婷婷', username: 'fengtt', email: 'fengtt@partner.com', role: '外部协作', company: '外部: 普华永道咨询', lastLogin: '2026-08-18 14:25', status: 'active' },
  { id: 'u-018', name: '邓佳', username: 'dengj', email: 'dengj@company.com', role: '审计员', company: '集团审计部', lastLogin: '2026-08-15 09:55', status: 'active' },
]

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
    } else if (url.includes('/admin/users')) {
      body = { code: 0, data: { items: SAMPLE_USERS, total: 186, page: 1, pageSize: 500 }, message: 'ok' }
    } else if (url.includes('/admin/roles')) {
      body = {
        code: 0,
        data: [
          { id: 'r-001', code: 'superadmin', name: '超级管理员', description: '系统所有权限', isSystem: true, permissions: [] },
          { id: 'r-002', code: 'finance_manager', name: '财务经理', description: '财务模块管理', isSystem: false, permissions: [] },
        ],
        message: 'ok',
      }
    } else if (url.includes('/companies') || url.includes('/data/companies')) {
      body = { code: 0, data: [], message: 'ok' }
    } else if (url.includes('/indicators/periods') || url.includes('/periods/available')) {
      body = { code: 0, data: { periods: ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08'], fiscalYears: ['2026'], fiscalStartMonth: 1 }, message: 'ok' }
    } else if (url.includes('/subjects')) {
      body = { code: 0, data: { items: [], total: 0 }, message: 'ok' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function waitForReactReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
  await page
    .waitForFunction(() => !document.querySelector('[aria-label="页面加载中"]'), { timeout: 30000 })
    .catch(() => {})
  await page.waitForSelector('text=用户管理', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=用户列表', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=共 186 条记录', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

/**
 * 解除 MainLayout 的 h-screen/overflow-hidden 锁定，让 document.scrollHeight 反映实际内容高度。
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
  await page.waitForSelector('text=用户管理', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=用户列表', { timeout: 30000 }).catch(() => {})
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
        .goto(`${DESIGN_BASE}/admin-users.html`, { waitUntil: 'networkidle', timeout: 30000 })
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
    .goto(`${REACT_BASE}/admin/users`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForReactReady(page)
  await expandLayoutForScreenshot(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  // React mobile
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .goto(`${REACT_BASE}/admin/users`, { waitUntil: 'domcontentloaded', timeout: 30000 })
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
  console.log(`===== 用户管理 / ${SLUG} =====`)
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
