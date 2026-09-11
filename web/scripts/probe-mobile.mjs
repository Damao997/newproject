#!/usr/bin/env node
// 探测 P1/P2 移动端比例最低的几个页面：是否在 wait 时间内未加载完
import { chromium } from 'playwright'
import { stat } from 'node:fs/promises'

const URL = 'http://127.0.0.1:5173'

const AUTH_SEED = {
  state: {
    user: {
      id: 'audit-bot', username: 'audit', name: '视觉审计 Bot', role: 'superadmin',
      permissions: [], dataScope: 'all', status: 'active',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    accessToken: 'audit-token', refreshToken: 'audit-refresh',
    isAuthenticated: true, persistentLoginToken: null,
  },
  version: 0,
}

const PAGES = [
  { route: '/reports/editor/demo', slug: 'report-editor', name: '报表编辑器' },
  { route: '/transactions/collections/plans', slug: 'transactions-collections-plans', name: '收款计划' },
  { route: '/data/import', slug: 'data-import', name: '数据导入' },
  { route: '/indicators/operating', slug: 'indicators-operating', name: '经营指标' },
  { route: '/admin/users', slug: 'admin-users', name: '用户管理' },
]

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 1800 } })

await ctx.route('**/api/v1/**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data: null, message: 'ok' }) })
})
await ctx.addInitScript((seed) => {
  try { localStorage.setItem('auth-storage', JSON.stringify(seed)) } catch (e) {}
}, AUTH_SEED)

for (const p of PAGES) {
  const page = await ctx.newPage()
  let consoleErr = 0
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErr++ })

  await page.goto(URL + p.route, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2000)

  const info = await page.evaluate(() => ({
    docHeight: document.body.scrollHeight,
    bodyText: document.body.innerText.slice(0, 300),
    imageCount: document.querySelectorAll('img').length,
    tableRowCount: document.querySelectorAll('table tr').length,
    cardCount: document.querySelectorAll('[class*="rounded"]').length,
  }))

  const out = `audit/screenshots/react/${p.slug}-mobile-probe.png`
  await page.screenshot({ path: out, fullPage: true })
  const size = (await stat(out)).size
  await page.close()

  console.log(`\n=== ${p.name} (${p.route}) ===`)
  console.log(`docHeight: ${info.docHeight}px, tableRows: ${info.tableRowCount}, cards: ${info.cardCount}, images: ${info.imageCount}, consoleErr: ${consoleErr}`)
  console.log(`screenshot: ${(size/1024).toFixed(1)}KB`)
  console.log(`first 200 chars: ${info.bodyText.slice(0, 200).replace(/\n/g, ' | ')}`)
}

await browser.close()
