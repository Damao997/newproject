// 全站比较组件回归：所有接口拦截为模拟数据，不连接业务数据库。
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { auth, resolveBrowserFixture, configureBrowserFixture } from './redesign-fixtures.mjs'
const base = process.env.COMPARISON_BASE_URL ?? 'http://127.0.0.1:5178'
const output = fileURLToPath(new URL('../audit/comparison-surfaces/', import.meta.url))
await mkdir(output, { recursive: true })
const paths = [
  '/transactions/overview', '/transactions/aging', '/inventory',
  '/dashboard/analysis/receivable-aging', '/dashboard/analysis/inventory-aging',
  '/dashboard/analysis/cash-flow', '/dashboard/analysis/category-budget',
  '/dashboard/analysis/subject-budget', '/dashboard/analysis/expense',
  '/dashboard/analysis/core-metrics', '/dashboard/analysis/key-metrics', '/dashboard',
]
const browser = await chromium.launch({ headless: true, channel: 'msedge' }), results = []
try {
  for (const theme of (process.env.COMPARISON_ONLY_EDGE === '1' ? [] : ['light', 'gradient', 'dark', 'antd'])) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 780 : 1000 }, reducedMotion: 'reduce' })
    configureBrowserFixture(context, { theme, revision: 1 })
    await context.addInitScript(({ auth, theme }) => {
      localStorage.setItem('auth-storage', JSON.stringify(auth))
      localStorage.setItem('sidebar-style-storage', JSON.stringify({ state: { sidebarStyle: theme }, version: 0 }))
      localStorage.setItem('last-seen-version', '999.0.0')
    }, { auth, theme })
    await context.route('**/api/v1/**', async (route) => {
      assert.equal(route.request().method(), 'GET', '只读展示检查不应产生写入')
      const result = structuredClone(resolveBrowserFixture(route))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
    })
    const page = await context.newPage(), errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    for (const path of paths) {
      await page.goto(base + path)
      await page.locator('header h1').waitFor()
      if (path === '/transactions/overview') { await page.locator('[data-transaction-card]').first().waitFor(); await page.getByRole('radio', { name: '明细', exact: true }).check() }
      else if (path === '/dashboard') await page.locator('.distribution-row').first().waitFor()
      else {
        if (path.startsWith('/dashboard/analysis/')) {
          await page.getByRole('tab', { name: '重点', exact: true }).click()
          await page.locator('[data-analysis-section="focus"]').waitFor()
          if (path.endsWith('cash-flow')) {
            assert.equal(await page.locator('.cashflow-comparison .distribution-row[data-signed]').count(), 6)
            assert.equal(await page.locator('.cashflow-comparison').nth(1).locator('.distribution-row-value').first().textContent(), '-120.00')
          }
          await page.screenshot({ path: output + '/' + theme + '-' + width + path.replaceAll('/', '-') + '-focus.png', fullPage: true })
          await page.getByRole('tab', { name: '完整报表', exact: true }).click()
        }
        await page.locator('[data-comparison-matrix]').first().waitFor()
      }
      assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0, path + ' 页面横向溢出')
      const geometry = await page.locator('.distribution-row').evaluateAll((rows) => rows.map((row) => {
        const bounds = row.getBoundingClientRect()
        return { label: row.querySelector('.distribution-row-label')?.textContent,
          value: row.querySelector('.distribution-row-value')?.textContent, width: bounds.width,
          spills: [...row.querySelectorAll('.distribution-row-label,.distribution-row-value,.distribution-row-meta,.distribution-row-track')]
            .filter((e) => { const r = e.getBoundingClientRect(); return r.left < bounds.left - 1 || r.right > bounds.right + 1 }).map((e) => e.textContent) }
      }))
      assert(geometry.every((row) => row.spills.length === 0), path + ' 图表读数溢出：' + JSON.stringify(geometry.filter((r) => r.spills.length)))
      const matrix = await page.locator('.magnitude-value').evaluateAll((cells) => cells.map((cell) => ({
        value: cell.textContent, alpha: Number(cell.style.getPropertyValue('--aging-cell-alpha'))
      })))
      assert(matrix.every((cell) => Number.isFinite(cell.alpha) && cell.alpha >= 0 && cell.alpha <= .181))
      if (path === '/transactions/overview') {
        assert.equal(await page.locator('[data-aging-distribution="summary"]').count(), 6)
        assert.equal(await page.locator('[data-aging-distribution="summary"] .distribution-row').count(), 48)
        assert.equal(await page.locator('[data-aging-distribution]').first().locator('.distribution-row-value').first().textContent(), '480.00')
      }
      if (path === '/dashboard/analysis/cash-flow') {
        assert.equal(matrix.length, 40)
      }
      if (path === '/inventory') {
        const table = page.locator('[data-comparison-matrix]')
        await table.getByRole('button', { name: '本期金额', exact: true }).click()
        assert.equal(await table.locator('th[aria-sort="descending"]').count(), 1)
        const checkbox = table.getByRole('checkbox').nth(1)
        await checkbox.check()
        assert.equal(await table.locator('tr[data-selected="true"]').count(), 1)
        await page.getByRole('button', { name: '取消选择', exact: true }).click()
        assert.equal(await table.locator('tr[data-selected="true"]').count(), 0)
        const search = page.getByRole('textbox', { name: '搜索公司或品类' })
        await search.fill('没有匹配的品类')
        await page.getByText('无匹配结果', { exact: true }).waitFor()
        await search.fill('')
        await table.waitFor()
      }
      if (path === '/dashboard/analysis/category-budget') {
        const before = await page.locator('[data-comparison-matrix] tbody tr').first().locator('.magnitude-value').nth(1).textContent()
        const tabs = page.getByRole('tab', { name: '累计', exact: true })
        await tabs.click()
        const after = await page.locator('[data-comparison-matrix] tbody tr').first().locator('.magnitude-value').nth(1).textContent()
        assert.notEqual(before, after, '切换累计必须改变金额口径')
      }
      await page.screenshot({ path: output + '/' + theme + '-' + width + path.replaceAll('/', '-') + '.png', fullPage: true })
      if (width === 390) {
        const focus = geometry.length ? page.locator('.distribution-row').first() : page.locator('[data-comparison-matrix]').first()
        await focus.scrollIntoViewIfNeeded()
        await page.screenshot({ path: output + '/' + theme + '-' + width + path.replaceAll('/', '-') + '-focused.png' })
      }
      results.push({ theme, width, path, distributionRows: geometry.length, matrixCells: matrix.length, errors: [...errors] })
      assert.deepEqual(errors, [])
    }
    // 账龄小计切换保留完整区间，浏览器返回恢复原筛选。
    await page.goto(base + '/transactions/aging')
    await page.locator('[data-grouped-matrix] .magnitude-value').first().waitFor()
    await page.getByRole('button', { name: '高级筛选', exact: true }).click()
    const subtotal = page.getByRole('checkbox', { name: '仅显示小计' })
    await subtotal.check()
    await page.locator('[data-matrix-subtotal]').first().waitFor()
    assert.equal(await page.locator('[data-grouped-matrix] .magnitude-value').count(), 0)
    assert.equal(await page.locator('[data-matrix-subtotal]').first().locator('td').count(), 11)
    await page.getByRole('navigation', { name: '模块分类' }).getByRole('link', { name: '往来总览', exact: true }).click()
    await page.waitForURL('**/transactions/overview')
    await page.goBack()
    await page.waitForURL('**/transactions/aging')
    const advanced = page.getByRole('button', { name: '高级筛选', exact: true })
    if (await advanced.getAttribute('aria-expanded') !== 'true') await advanced.click()
    assert.equal(await subtotal.isChecked(), true)
    await subtotal.uncheck()
    await page.locator('[data-grouped-matrix] .magnitude-value').first().waitFor()
    await context.close()
  }
  // 边界读数：只改模拟返回，页面保持原格式化和万元规则。
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, reducedMotion: 'reduce' })
  await context.addInitScript((auth) => {
    localStorage.setItem('auth-storage', JSON.stringify(auth)); localStorage.setItem('last-seen-version', '999.0.0')
  }, auth)
  await context.route('**/api/v1/**', async (route) => {
    const result = structuredClone(resolveBrowserFixture(route))
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/transactions/overview')) {
      result.data[0].aging['1个月'] = 9999999999900
      result.data[0].aging['2个月'] = -15000
      result.data[0].aging['3个月'] = 0
    }
    if (path.endsWith('/dashboard/product-budget')) {
      result.data.rows[0].category = '用于检查完整名称的燃气具与净水产品预算（华东区域联合业务）'
      result.data.rows[0].income.monthRate = 150
      result.data.rows[0].profit.monthRate = null
      result.data.rows[1].income.monthRate = 0
      result.data.rows[2].income.monthActual = -1.5
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
  })
  const page = await context.newPage()
  await page.goto(base + '/transactions/overview')
  await page.getByRole('radio', { name: '明细', exact: true }).check()
  const summary = page.locator('[data-aging-distribution]').first()
  await summary.waitFor()
  assert.equal(await summary.locator('.distribution-row-value').nth(0).textContent(), '999,999,999.99')
  assert.equal(await summary.locator('.distribution-row-value').nth(1).textContent(), '-1.50')
  assert.equal(await summary.locator('.distribution-row-value').nth(2).textContent(), '-')
  assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0)
  await page.screenshot({ path: output + '/edge-overview.png', fullPage: true })
  // 原专业编辑器和八段账龄展开继续可用。
  await page.getByRole('button', { name: '单项分析', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '往来单项分析' })
  await dialog.waitFor()
  const company = dialog.getByRole('combobox').first()
  await company.click()
  await page.locator('.ant-select-item-option').filter({ hasText: '杭州' }).click()
  await dialog.getByRole('button', { name: '展开账龄明细', exact: true }).click()
  assert.equal(await dialog.locator('[data-aging-distribution="comparison"] .distribution-row').count(), 8)
  await dialog.getByRole('textbox', { name: '分析标题', exact: true }).click()
  assert(await dialog.getByRole('button', { name: '取消', exact: true }).isVisible(), '展开后操作区应始终可见')
  await page.screenshot({ path: output + '/mobile-drawer-expanded.png' })
  await dialog.getByRole('button', { name: '收起账龄明细', exact: true }).click()
  assert.equal(await dialog.locator('[data-aging-distribution="comparison"]').count(), 0)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.goto(base + '/dashboard/analysis/category-budget')
  await page.getByRole('tab', { name: '完整报表', exact: true }).click()
  const matrix = page.locator('[data-comparison-matrix]')
  await matrix.waitFor()
  assert.equal(await matrix.locator('tbody tr').first().locator('.rate-bar-value').nth(0).textContent(), '150.0%')
  assert.equal(await matrix.locator('tbody tr').first().locator('.rate-bar-fill').nth(0).evaluate((e) => e.style.width), '100%')
  assert.equal(await matrix.locator('tbody tr').first().locator('.rate-bar-value').nth(1).textContent(), '–')
  assert.equal(await matrix.locator('tbody tr').nth(1).locator('.rate-bar-value').first().textContent(), '-')
  assert.equal(await matrix.locator('tbody tr').nth(2).locator('.magnitude-value').nth(1).textContent(), '-1.50')
  const frozen = matrix.locator('tbody tr').first().locator('td').first()
  const before = await frozen.boundingBox()
  await matrix.locator('..').evaluate((e) => { e.scrollLeft = 250 })
  const after = await frozen.boundingBox()
  assert(Math.abs(before.x - after.x) < 1, '预算名称列未冻结')
  assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0)
  await page.screenshot({ path: output + '/edge-budget.png', fullPage: true })
  await context.close()
  await writeFile(output + (results.length ? '/report.json' : '/edge-report.json'), JSON.stringify({ results, edgeCases: ['大金额', '负数', '零', '空预算', '超额', '长名称', '面板账龄展开', '矩阵冻结'] }, null, 2))
  console.log('通过：四主题 × 两种宽度 × 12 页共 ' + results.length + ' 项，以及金额边界、排序、选择、筛选恢复和账龄展开。')
} finally { await browser.close() }
