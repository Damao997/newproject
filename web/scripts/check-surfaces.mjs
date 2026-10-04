// 全站数据表面回归：接口全部模拟，包含四主题与手机布局。
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { auth, resolveBrowserFixture, configureBrowserFixture } from './redesign-fixtures.mjs'

const base = process.env.SURFACES_BASE_URL ?? 'http://127.0.0.1:5178'
const output = fileURLToPath(new URL('../audit/surfaces/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const results = [], errors = []
const paths = ['/dashboard', '/indicators/operating', '/reports', '/dashboard/analysis/subject-budget', '/transactions/aging', '/inventory', '/admin/users', '/data/dimensions/operating', '/dashboard/analysis/receivable-aging', '/dashboard/analysis/inventory-aging']
async function context(style, width, scenario = 'success') {
  const c = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  configureBrowserFixture(c, { theme: style, revision: 1 })
  await c.addInitScript(({ auth, style }) => {
    localStorage.setItem('auth-storage', JSON.stringify(auth))
    localStorage.setItem('sidebar-style-storage', JSON.stringify({ state: { sidebarStyle: style }, version: 0 }))
    localStorage.setItem('last-seen-version', '999.0.0')
  }, { auth, style })
  await c.route('**/api/v1/**', async route => {
    const result = resolveBrowserFixture(route, scenario)
    if (scenario === 'amounts' && route.request().url().includes('/dashboard/overview')) {
      result.data.kpiData = [...result.data.kpiData].reverse().map((kpi, i) => ({ ...kpi, monthActual: [0, -1234567.89, 99999999.99, 25.5][i] }))
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
  })
  return c
}
async function check(p, path, label, shot = false) {
  const pageErrors = []
  const listener = error => pageErrors.push(error.message)
  p.on('pageerror', listener)
  await p.goto(base + path)
  await p.locator('h1').first().waitFor()
  await p.waitForTimeout(350)
  const state = await p.evaluate(() => {
    const rect = el => el.getBoundingClientRect()
    const badButtons = [...document.querySelectorAll('.report-card-actions .button-content')].filter(el => {
      const icon = el.querySelector('svg')
      if (!icon) return false
      const content = rect(el), svg = rect(icon)
      return content.height > 24 || Math.abs((svg.top + svg.bottom - content.top - content.bottom) / 2) > 3
    }).length
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      headings: document.querySelectorAll('h1').length,
      headerHeading: !!document.querySelector('.header-title-host h1'),
      mainHeading: !!document.querySelector('main h1'),
      crash: document.body.textContent.includes('页面渲染出错'),
      cardRadii: [...document.querySelectorAll('.app-card')].map(el => getComputedStyle(el).borderRadius),
      badButtons,
      metrics: [...document.querySelectorAll('.kpi-card')].map(el => ({ title: el.querySelector('.font-semibold')?.textContent, tone: el.getAttribute('data-metric-tone'), amount: el.querySelector('.ant-statistic-content')?.textContent })),
      tableHeader: document.querySelector('[data-ui-table] thead th') ? getComputedStyle(document.querySelector('[data-ui-table] thead th')).backgroundColor : null,
      filters: [...document.querySelectorAll('[data-card-variant="filter"] .ant-input-affix-wrapper, [data-filter-bar] .ant-input-affix-wrapper')].map(el => rect(el).height),
    }
  })
  const entry = { label, path, ...state, pageErrors }
  results.push(entry)
  if (state.headings !== 1 || !state.headerHeading || state.mainHeading || state.overflow > 2 || state.crash || state.badButtons || state.cardRadii.some(r => r !== '24px') || state.filters.some(h => h < 35) || pageErrors.length) errors.push(entry)
  if (shot) await p.screenshot({ path: output + '/' + label + '.png', fullPage: false })
  p.off('pageerror', listener)
  return state
}
try {
  for (const style of ['light', 'gradient', 'dark', 'antd']) {
    for (const width of [1440, 1024, 390]) {
      const c = await context(style, width), p = await c.newPage()
      for (const path of paths) await check(p, path, style + '-' + width + path.replaceAll('/', '-'), ['/dashboard', '/indicators/operating', '/reports', '/dashboard/analysis/subject-budget', '/dashboard/analysis/receivable-aging', '/dashboard/analysis/inventory-aging'].includes(path))
      await c.close()
    }
    const c = await context(style, 390, 'amounts'), p = await c.newPage()
    const state = await check(p, '/dashboard', style + '-large-amounts', true)
    assert.deepEqual(state.metrics.map(k => [k.title, k.tone]), [['回款', '4'], ['净利润', '3'], ['毛利', '2'], ['收入', '1']])
    // 保留现有金额格式：零金额显示横线，输入态仍区分空值与零。
    assert.equal(state.metrics[0].amount, '-')
    assert.equal(state.metrics[1].amount, '-1,234,567.89')
    assert.equal(state.metrics[2].amount, '99,999,999.99')
    await p.getByRole('link', { name: '收入：点击查看财务指标明细' }).press('Enter')
    await p.waitForURL('**/indicators/operating')
    assert.equal(await p.getByRole('textbox', { name: '搜索科目' }).inputValue(), '收入')
    await c.close()
  }
  for (const scenario of ['loading', 'empty', 'error']) {
    const c = await context('dark', 390, scenario), p = await c.newPage()
    for (const path of ['/dashboard', '/reports', '/indicators/operating']) await check(p, path, scenario + path.replaceAll('/', '-'), true)
    await c.close()
  }
} finally {
  await writeFile(output + '/report.json', JSON.stringify({ results, errors }, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ checks: results.length, errors }, null, 2))
assert.equal(errors.length, 0, '数据表面出现布局或交互问题，详见 audit/surfaces/report.json')
