const { chromium } = require('playwright');

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
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  // 大视口：主布局 h-screen + overflow-hidden，fullPage 只能拿到外层文档高度；
  // 改用大视口（1440x2400）让 KPI/饼图/Top10/明细表全部在视口里可见，截图就能完整捕捉
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 2400 },
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript((seed) => {
    try {
      localStorage.setItem('auth-storage', JSON.stringify(seed));
    } catch (e) {}
  }, AUTH_SEED);
  // mock all /api requests so the auth flow doesn't 401
  await ctx.route('**/api/**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: null }),
    });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => console.log('[browser:err]', err.message));
  await page.goto('http://127.0.0.1:5173/dashboard/analysis/category-budget', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  // wait for our specific content
  await page.waitForSelector('text=品类预算占比', { timeout: 10000 }).catch((e) => console.log('selector err:', e.message));
  await page.waitForTimeout(1500);
  console.log('[final] url=', page.url());
  await page.screenshot({
    path: 'audit/screenshots/react/analysis-category-budget-desktop.png',
    fullPage: true,
  });
  await browser.close();
  console.log('done');
})();
