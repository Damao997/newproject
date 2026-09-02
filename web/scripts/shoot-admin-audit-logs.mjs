import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const REACT_BASE = 'http://127.0.0.1:5173'
const DESIGN_BASE = 'http://127.0.0.1:8001/pages'
const SLUG = 'admin-audit-logs'

const AUTH_SEED = {
  state: {
    user: {
      id: 'audit-bot',
      username: 'audit',
      name: '视觉审计 Bot',
      role: 'superadmin',
      permissions: [
        'dashboard:view','dashboard:export',
        'indicators:view','indicators:export',
        'transactions:view','inventory:view',
        'reports:view','data:browse:view','data:reclassify','data:export','data:import',
        'tools:view','admin:users:view','admin:roles:view',
        'admin:audit:view','admin:audit:export',
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

const AUDIT_USERS = ['张伟', '陈勇', '王芳', '李娜', '赵敏', '周涛', '孙宇', '系统']
const AUDIT_MODULES = ['auth', 'admin', 'data', 'data', 'data', 'permission', 'data']
const AUDIT_ACTIONS = ['login', 'login_failed', 'logout', 'create', 'update', 'delete', 'export', 'role_change', 'permission_change', 'denied', 'rule_change', 'import_rollback', 'user_create', 'user_disable']
const DETAIL_TEMPLATES = [
  '导入 8 月经营数据（1,248 条） · 来源：ERP 凭证同步',
  '管理费用-办公费 ¥12,500 → 管理费用-差旅费（已生效）',
  '财务经理「存货」模块由「仅查看」改为「查看+编辑」',
  '应收账款-A公司 ¥86,000 → 应收账款-B公司（待复核）',
  '通过 SSO 单点登录 · 浏览器 Chrome 128 · IP 10.20.3.45',
  'A 公司科目映射缺失 · 影响 1 个科目 · 已自动告警',
  '销售费用-广告 ¥200,000 → ¥260,000（审批中）',
  '通过 SSO 单点登录 · 浏览器 Edge 128 · IP 10.20.3.62',
  '赵敏（销售员）→「业务经理」 · 影响 12 个模块',
  '每日定时同步任务 · 8 个主体 · 成功 7 · 失败 1（A 公司）',
  '通过 SSO 单点登录 · 浏览器 Chrome 128 · IP 10.20.3.78',
  '系统正常启动 · 加载 8 个主体 · 配置 3 个汇总主体',
  '导出 7 月应收账款明细（486 行） · CSV',
  '删除废弃主体「测试 B 公司」 · 关联 0 单据',
  '创建新用户「孙宇」 · 默认角色：销售员',
  '停用用户「周婷」 · 关联 4 个审批流程',
  '越权拦截：尝试访问 /admin/permissions（无权限）',
  '公式规则变更：毛利率 = (收入-成本)/收入',
  '批次回滚：BATCH-2026-0820-007 撤销 86 条凭证',
  '权限角色新增：业务观察员（只读 8 模块）',
]

function buildAuditItems(count) {
  const items = []
  const base = new Date('2026-08-27T14:23:08+08:00').getTime()
  for (let i = 0; i < count; i++) {
    const user = AUDIT_USERS[i % AUDIT_USERS.length]
    const module = AUDIT_MODULES[i % AUDIT_MODULES.length]
    const action = AUDIT_ACTIONS[i % AUDIT_ACTIONS.length]
    const detail = DETAIL_TEMPLATES[i % DETAIL_TEMPLATES.length]
    const t = new Date(base - i * 1000 * 60 * 7)
    items.push({
      id: `AL-${String(i + 1).padStart(5, '0')}`,
      createdAt: t.toISOString(),
      username: user,
      module,
      action,
      detail,
    })
  }
  return items
}

const AUDIT_ITEMS = buildAuditItems(60)

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
    } else if (url.includes('/admin/audit-logs')) {
      const u = new URL(url)
      const page = Number(u.searchParams.get('page') || '1')
      const pageSize = Number(u.searchParams.get('pageSize') || '20')
      const start = (page - 1) * pageSize
      const slice = AUDIT_ITEMS.slice(start, start + pageSize)
      body = { code: 0, data: { items: slice, total: AUDIT_ITEMS.length, page, pageSize }, message: 'ok' }
    } else if (url.includes('/admin/roles')) {
      body = { code: 0, data: [
        { code: 'superadmin', name: '超级管理员' },
        { code: 'finance_director', name: '财务总监' },
        { code: 'finance_manager', name: '财务经理' },
        { code: 'sales', name: '销售员' },
        { code: 'observer', name: '业务观察员' },
      ], message: 'ok' }
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
  await page.waitForSelector('text=审计日志', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=时间线流', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=审计详情', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=全部日志', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}

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
  await page.waitForSelector('text=审计日志', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=时间线流', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('text=审计详情', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
}

async function main() {
  await mkdir(join(AUDIT_DIR, 'react'), { recursive: true })
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })

  const browser = await chromium.launch({ headless: true })

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
        .goto(`${DESIGN_BASE}/admin-audit-logs.html`, { waitUntil: 'networkidle', timeout: 30000 })
        .catch(() => {})
      await waitForDesignReady(page)
      await expandLayoutForScreenshot(page)
      const out = join(AUDIT_DIR, 'design', `${SLUG}-${vp.name}.png`)
      await page.screenshot({ path: out, fullPage: true })
    }
    await ctx.close()
  }

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
    .goto(`${REACT_BASE}/admin/audit-logs`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
  await waitForReactReady(page)
  await expandLayoutForScreenshot(page)
  const reactDesktopPath = join(AUDIT_DIR, 'react', `${SLUG}-desktop.png`)
  await page.screenshot({ path: reactDesktopPath, fullPage: true })
  const reactDesktopBytes = (await stat(reactDesktopPath)).size

  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .goto(`${REACT_BASE}/admin/audit-logs`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {})
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
  console.log(`===== 审计日志 / ${SLUG} =====`)
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
