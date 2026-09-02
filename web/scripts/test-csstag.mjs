#!/usr/bin/env node
// 单页测试：验证 addStyleTag 是否能扩展 MainLayout 的高度限制
import { chromium } from 'playwright'
import { stat } from 'node:fs/promises'

const URL = 'http://127.0.0.1:5173/reports/editor/demo'

const AUTH_SEED = {
  state: {
    user: { id: 'audit-bot', username: 'audit', name: '视觉审计 Bot', role: 'superadmin', permissions: [], dataScope: 'all', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    accessToken: 'audit-token', refreshToken: 'audit-refresh', isAuthenticated: true, persistentLoginToken: null,
  },
  version: 0,
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 1800 } })

await ctx.route('**/api/v1/**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data: null, message: 'ok' }) })
})
await ctx.addInitScript((seed) => { try { localStorage.setItem('auth-storage', JSON.stringify(seed)) } catch (e) {} }, AUTH_SEED)

const page = await ctx.newPage()
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
await page.waitForSelector('text=编辑器', { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(2500)

const beforeH = await page.evaluate(() => document.body.scrollHeight)
console.log('BEFORE CSS injection: docHeight =', beforeH)

await page.addStyleTag({
  content: `
    html, body { height: auto !important; min-height: 100% !important; overflow: visible !important; }
    .h-screen, [class*="h-screen"] { height: auto !important; min-height: 100vh !important; }
    [class*="overflow-hidden"] { overflow: visible !important; }
    main[class*="overflow-y-auto"] { overflow: visible !important; height: auto !important; }
  `,
})
await page.waitForTimeout(500)

const afterH = await page.evaluate(() => document.body.scrollHeight)
console.log('AFTER CSS injection: docHeight =', afterH)

const out = 'audit/screenshots/react/report-editor-mobile-test.png'
await page.screenshot({ path: out, fullPage: true })
const size = (await stat(out)).size
console.log('screenshot:', (size/1024).toFixed(1), 'KB')

await browser.close()
