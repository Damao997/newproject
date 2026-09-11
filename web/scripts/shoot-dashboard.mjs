// 视觉验证脚本：截取改造后的首页看板 React 页 desktop 视图。
// 策略：注入 superadmin auth + 拦截 dashboard 关键 API 返回 mock 数据，
//   避免 401 跳转 /login，使页面在仅有 seed token 的情况下也能正常渲染。
// 用法：node scripts/shoot-dashboard.mjs
// 产物：audit/screenshots/react/dashboard-desktop.png

import { chromium } from 'playwright'

// 注意：permissions 留空 → usePermission 退化到 ROLE_PERMISSIONS[role]，
//   角色为 superadmin 时自动拥有全部权限码（含 dashboard:view）。
//   若传 ['*']，hook 走 serverPermissions 分支但 '*' 不匹配 'dashboard:view'，
//   会被 RequirePermission 拒绝而渲染「无访问权限」。
const AUTH_SEED = {
  state: {
    user: {
      id: 'audit-bot',
      username: 'audit',
      name: '视觉审计 Bot',
      role: 'superadmin',
      permissions: [],
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

const MOCK_KPI = [
  {
    title: '本月营业收入',
    monthActual: 1284.6,
    monthRate: 67.2,
    ytdActual: 8970.5,
    yoy: 0.124,
    ytdRate: 58.6,
    trend: [820, 850, 880, 910, 950, 1000, 1050, 1100, 1150, 1200, 1240, 1284.6],
  },
  {
    title: '累计毛利',
    monthActual: 384.5,
    monthRate: 29.9,
    ytdActual: 2680.2,
    yoy: 0.087,
    ytdRate: 47.5,
    trend: [240, 252, 268, 285, 302, 318, 335, 348, 360, 372, 380, 384.5],
  },
  {
    title: '应收账款',
    monthActual: 358.2,
    monthRate: 18.7,
    ytdActual: 358.2,
    yoy: -0.045,
    ytdRate: 18.7,
    trend: [420, 410, 402, 398, 392, 385, 378, 372, 368, 364, 360, 358.2],
  },
  {
    title: '预算完成率',
    monthActual: 67.2,
    monthRate: 67.2,
    ytdActual: 58.6,
    yoy: 0.043,
    ytdRate: 58.6,
    trend: [40, 45, 50, 53, 56, 58, 60, 62, 64, 65, 66, 67.2],
  },
]

const MOCK_TREND = Array.from({ length: 12 }, (_, i) => ({
  period: `2025-${String(i + 1).padStart(2, '0')}`,
  revenue: 820 + i * 45 + Math.round(Math.sin(i / 2) * 30),
  profit: 240 + i * 14 + Math.round(Math.cos(i / 3) * 10),
  cashflow: 180 + i * 11 + Math.round(Math.sin(i / 4) * 15),
}))

const MOCK_OVERVIEW = {
  kpiData: MOCK_KPI,
  trendData: MOCK_TREND,
  alerts: [],
  lastUpdatedAt: new Date().toISOString(),
  period: '2025-08',
  availablePeriods: [
    '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
    '2025-07', '2025-08',
  ],
  companyCode: null,
  companyName: '集团汇总',
  companyType: 'summary',
  degraded: false,
}

const MOCK_RECEIVABLES = {
  period: '2025-08',
  rows: [
    { companyCode: 'C001', companyName: '上海分公司', balance: 128.4, ratio: 35.9, due30: 70.2, due60: 32.1, due90: 18.4, over90: 7.7 },
    { companyCode: 'C002', companyName: '北京分公司', balance: 96.8, ratio: 27.0, due30: 52.4, due60: 24.6, due90: 12.8, over90: 7.0 },
    { companyCode: 'C003', companyName: '广州分公司', balance: 76.5, ratio: 21.4, due30: 41.2, due60: 19.3, due90: 9.8, over90: 6.2 },
    { companyCode: 'C004', companyName: '深圳分公司', balance: 56.5, ratio: 15.7, due30: 30.2, due60: 14.5, due90: 7.2, over90: 4.6 },
  ],
}

const MOCK_INVENTORY = {
  period: '2025-08',
  total: 245.8,
  rows: [
    { category: '原材料', amount: 86.4, ratio: 35.2, color: '#1677ff' },
    { category: '在产品', amount: 58.6, ratio: 23.8, color: '#52c41a' },
    { category: '产成品', amount: 62.3, ratio: 25.4, color: '#faad14' },
    { category: '低值易耗品', amount: 22.1, ratio: 9.0, color: '#722ed1' },
    { category: '其他', amount: 16.4, ratio: 6.6, color: '#8c8c8c' },
  ],
}

function ok(body) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ code: 0, message: 'ok', data: body }),
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  // 使用更高的视口高度以一次性看到 main 滚动容器中的全部内容（main-layout 用 h-screen + overflow-y-auto 限制外层）
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1800 },
    deviceScaleFactor: 1,
  })
  await ctx.addInitScript((seed) => {
    try {
      localStorage.setItem('auth-storage', JSON.stringify(seed))
    } catch (e) {}
  }, AUTH_SEED)

  // 兜底：其它可能命中但本次截图不需要的接口，统一返回空结构以避免 401 链
  // 必须先注册（晚注册的路由会覆盖先注册的，Playwright 用 last-match 语义）
  await ctx.route('**/api/v1/**', (route) => {
    const url = route.request().url()
    if (url.includes('/auth/')) return route.fulfill(ok({}))
    return route.fulfill(ok([]))
  })

  // 具体路由：必须后注册以覆盖上面的兜底
  await ctx.route('**/api/v1/dashboard/overview**', (route) => {
    return route.fulfill(ok(MOCK_OVERVIEW))
  })
  await ctx.route('**/api/v1/dashboard/receivables**', (route) => {
    return route.fulfill(ok(MOCK_RECEIVABLES))
  })
  await ctx.route('**/api/v1/dashboard/inventory**', (route) => {
    return route.fulfill(ok(MOCK_INVENTORY))
  })
  await ctx.route('**/api/v1/inventory/overview**', (route) => {
    return route.fulfill(ok(MOCK_INVENTORY))
  })
  // 看板筛选依赖：返回数组
  await ctx.route('**/api/v1/data/companies**', (route) => {
    return route.fulfill(ok([]))
  })
  await ctx.route('**/api/v1/companies**', (route) => {
    return route.fulfill(ok([]))
  })
  // 期间候选：返回对象结构
  await ctx.route('**/api/v1/indicators/periods**', (route) => {
    return route.fulfill(ok({
      periods: MOCK_OVERVIEW.availablePeriods,
      fiscalYears: ['2025'],
      fiscalStartMonth: 1,
    }))
  })
  await ctx.route('**/api/v1/periods/available**', (route) => {
    return route.fulfill(ok({
      periods: MOCK_OVERVIEW.availablePeriods,
      fiscalYears: ['2025'],
      fiscalStartMonth: 1,
    }))
  })

  const page = await ctx.newPage()
  page.on('console', (msg) => console.log(`[browser ${msg.type()}]`, msg.text()))
  page.on('pageerror', (err) => console.log(`[pageerror]`, err.message))

  const url = 'http://127.0.0.1:5173/dashboard'
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => console.log('goto err:', e.message))
  // 等 ECharts 完成首屏渲染 + 所有 useEffect 跑完
  await page.waitForTimeout(3500)
  // 触发懒加载：滚动到底部再回顶，让所有 section 触发渲染
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y)
      await sleep(80)
    }
    window.scrollTo(0, 0)
    await sleep(300)
  })
  await page.waitForTimeout(800)
  console.log('URL after wait:', page.url())
  console.log('Title:', await page.title())
  const rootHTML = await page.evaluate(() => document.getElementById('root')?.innerHTML?.length ?? -1)
  console.log('Root innerHTML length:', rootHTML)
  const docHeight = await page.evaluate(() => document.body.scrollHeight)
  console.log('Document height:', docHeight)
  const cardCount = await page.evaluate(() => document.querySelectorAll('[class*="rounded-card"], [class*="rounded-md"][class*="border"]').length)
  console.log('Card-like elements:', cardCount)
  const sectionTitles = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('h1, h2, h3, h4, [class*="text-base"][class*="font-semibold"]'))
      .map((el) => el.textContent?.trim())
      .filter(Boolean)
  })
  console.log('Section titles:', sectionTitles)
  // 探测每个 section 的实际位置和大小
  const sectionRects = await page.evaluate(() => {
    const titles = ['应收账款分析', '存货品类分析', '费用结构', '应收账龄', '最近活动', '快捷入口']
    return titles.map((t) => {
      const el = Array.from(document.querySelectorAll('*')).find((e) => e.textContent?.trim() === t)
      if (!el) return { title: t, found: false }
      const r = el.getBoundingClientRect()
      return { title: t, top: r.top, height: r.height, visible: r.height > 0 }
    })
  })
  console.log('Section rects:', sectionRects)
  // 探测 grid 容器
  const gridContainers = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.grid'))
      .map((g) => {
        const r = g.getBoundingClientRect()
        return { classes: g.className.substring(0, 60), top: r.top, height: r.height, childCount: g.children.length }
      })
  })
  console.log('Grid containers:', gridContainers)

  const out = 'D:/flies/fy200-clone/web/audit/screenshots/react/dashboard-desktop.png'
  await page.screenshot({ path: out, fullPage: true })
  const fs = await import('node:fs/promises')
  const size = (await fs.stat(out)).size
  console.log('Bytes:', size, 'KB:', (size / 1024).toFixed(1))
  await browser.close()
}

main().catch((e) => {
  console.error('Failed:', e)
  process.exit(1)
})
