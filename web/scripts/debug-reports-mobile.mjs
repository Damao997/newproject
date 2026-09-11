import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const AUTH_SEED = {
  state: {
    user: { id: 'audit-bot', username: 'audit', name: 'visual bot', role: 'superadmin', permissions: ['dashboard:view','reports:view','admin:users:view','admin:roles:view'], dataScope: 'all', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    accessToken: 'audit-token', refreshToken: 'audit-refresh', isAuthenticated: true, persistentLoginToken: null,
  },
  version: 0,
}

async function inspect(viewport) {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  await ctx.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    let body = { code: 0, data: null, message: 'ok' }
    if (url.includes('/auth/')) body = { code: 0, data: { accessToken: 'audit-token', refreshToken: 'audit-refresh', user: AUTH_SEED.state.user }, message: 'ok' }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await ctx.addInitScript((seed) => { try { localStorage.setItem('auth-storage', JSON.stringify(seed)) } catch (e) {} }, AUTH_SEED)
  const page = await ctx.newPage()
  await page.goto('http://127.0.0.1:5173/reports', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  const data = await page.evaluate(() => {
    const body = document.body
    const sidebar = document.querySelector('aside')
    const header = document.querySelector('header')
    const main = document.querySelector('main')
    return {
      bodyHeight: body.scrollHeight,
      docHeight: document.documentElement.scrollHeight,
      sidebarWidth: sidebar ? sidebar.getBoundingClientRect().width : 0,
      headerHeight: header ? header.getBoundingClientRect().height : 0,
      mainHeight: main ? main.scrollHeight : 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }
  })
  console.log('viewport ' + viewport.width + 'x' + viewport.height + ':', JSON.stringify(data))
  await browser.close()
}
await inspect({ width: 1440, height: 900 })
await inspect({ width: 390, height: 844 })
