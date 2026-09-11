#!/usr/bin/env node
// 单页诊断：深度探测 salesmen 移动端为何只截到 5.6KB
import { chromium } from 'playwright'

const URL = 'http://127.0.0.1:5173/transactions/collections/salesmen'

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

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 1800 },
  deviceScaleFactor: 1,
})

await ctx.route('**/api/v1/**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ code: 0, data: null, message: 'ok' }),
  })
})

await ctx.addInitScript((seed) => {
  try {
    localStorage.setItem('auth-storage', JSON.stringify(seed))
  } catch (e) {}
}, AUTH_SEED)

const page = await ctx.newPage()

page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[browser ERROR]', msg.text())
})
page.on('pageerror', (err) => {
  console.log('[pageerror]', err.message)
})
page.on('requestfailed', (req) => {
  console.log('[requestfailed]', req.url(), req.failure()?.errorText)
})

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
await page.waitForSelector('text=业务员', { timeout: 15000 }).catch(() => {})

await page.waitForTimeout(2000)

const html = await page.content()
const docHeight = await page.evaluate(() => document.body.scrollHeight)
const cardCount = await page.locator('.rounded-card').count()
const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 500)
const kpiCount = await page.evaluate(() => document.querySelectorAll('[class*="grid-cols"]').length)

console.log('docHeight:', docHeight)
console.log('cardCount:', cardCount)
console.log('kpiGridCount:', kpiCount)
console.log('bodyText:', bodyText)
console.log('html length:', html.length)

const out = 'audit/screenshots/react/transactions-collections-salesmen-mobile-debug.png'
await page.screenshot({ path: out, fullPage: true })

const { stat } = await import('node:fs/promises')
console.log('screenshot size:', (await stat(out)).size, 'bytes')

await browser.close()
