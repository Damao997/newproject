import { chromium } from 'playwright'
const ROOT = 'http://127.0.0.1:5173'
const SEED = { state: { user: { id: 'a', username: 'a', name: 'A', role: 'superadmin', permissions: ['reports:view'], dataScope: 'all', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01' }, accessToken: 't', refreshToken: 'r', isAuthenticated: true, persistentLoginToken: null }, version: 0 }
async function main() {
  const b = await chromium.launch({ headless: true })
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.route('**/api/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data: null, message: 'ok' }) }))
  await ctx.addInitScript((s) => localStorage.setItem('auth-storage', JSON.stringify(s)), SEED)
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('PAGEERR', e.message))
  p.on('console', (m) => { if (m.type() === 'error') console.log('CERR', m.text()) })
  await p.goto(ROOT + '/reports/analyses', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await p.waitForTimeout(3000)
  const info = await p.evaluate(() => ({
    bodyH: document.body.scrollHeight,
    htmlH: document.documentElement.scrollHeight,
    cards: document.querySelectorAll('.grid > div').length,
    titles: Array.from(document.querySelectorAll('h3')).map(h => h.textContent),
    hasTable: !!document.querySelector('table'),
    rows: document.querySelector('table')?.querySelectorAll('tbody tr').length || 0,
    url: location.href,
  }))
  console.log('INFO', JSON.stringify(info))
  await b.close()
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
