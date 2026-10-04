// 顶栏、分类和明细交互回归；全部业务请求模拟，不访问业务数据库。
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { auth, resolveBrowserFixture, configureBrowserFixture } from './redesign-fixtures.mjs'
const base = process.env.POLISH_BASE_URL ?? 'http://127.0.0.1:5178'
const output = fileURLToPath(new URL('../audit/workspace-polish/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const results = []
try {
  for (const theme of ['light', 'gradient', 'dark', 'antd']) {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 700 : 900 }, reducedMotion: 'reduce' })
      configureBrowserFixture(context, { theme, revision: 1 })
      await context.addInitScript(({ auth, theme }) => {
        localStorage.setItem('auth-storage', JSON.stringify(auth))
        localStorage.setItem('sidebar-style-storage', JSON.stringify({ state: { sidebarStyle: theme }, version: 0 }))
        localStorage.setItem('last-seen-version', '999.0.0')
      }, { auth, theme })
      await context.route('**/api/v1/**', async (route) => {
        const result = structuredClone(resolveBrowserFixture(route))
        if (route.request().url().includes('/dashboard/receivables') && result.data?.rows?.length) {
          result.data.rows[0].name = '用于检验完整显示的长名称主体（华东区域经营管理与家用电器服务公司）'
          result.data.rows[0].balance = -15000
          if (result.data.rows[1]) result.data.rows[1].balance = 0
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
      })
      const page = await context.newPage(), errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(base + '/indicators/operating')
      await page.locator('.metric-table tbody tr').first().waitFor()
      assert.equal(await page.locator('h1').count(), 1)
      assert.equal(await page.locator('header h1').textContent(), '财务指标')
      assert(await page.getByText('金额：万元', { exact: true }).isVisible())
      const search = page.getByRole('textbox', { name: '搜索科目' })
      await search.fill('收入')
      await page.getByRole('navigation', { name: '模块分类' }).getByRole('link', { name: '静态指标', exact: true }).press('Enter')
      await page.waitForURL('**/indicators/static')
      await page.goBack()
      await page.waitForURL('**/indicators/operating')
      assert.equal(await search.inputValue(), '收入')
      await search.fill('')
      const sort = page.getByRole('button', { name: '按本月实际排序', exact: true })
      await sort.click()
      assert.equal(await sort.locator('..').getAttribute('aria-sort'), 'ascending')
      await sort.click()
      assert.equal(await sort.locator('..').getAttribute('aria-sort'), 'descending')
      const table = page.locator('.metric-table'), firstCell = table.locator('tbody tr').first().locator('td').first()
      const before = await firstCell.boundingBox()
      await page.locator('.table-scroll').evaluate((element) => { element.scrollLeft = 160 })
      const after = await firstCell.boundingBox()
      assert(Math.abs(before.x - after.x) <= 1, '财务科目列横向滚动后移位')
      assert.equal(await table.locator('td[data-metric-column="actual"]').first().evaluate((element) => getComputedStyle(element).textAlign), 'right')
      await page.screenshot({ path: output + '/' + theme + '-' + width + '-financial.png' })

      await page.goto(base + '/dashboard/analysis/receivable-aging')
      await page.locator('.distribution-row').first().waitFor()
      const navigation = page.getByRole('navigation', { name: '模块分类' })
      const active = navigation.getByRole('link', { name: '应收账龄分析', exact: true })
      await active.focus()
      await active.press('ArrowRight')
      assert.equal(new URL(page.url()).pathname, '/dashboard/analysis/receivable-aging')
      assert.equal(await navigation.getByRole('link', { name: '存货分析', exact: true }).evaluate((element) => element === document.activeElement), true)
      await page.getByRole('tab', { name: '按客户', exact: true }).click()
      assert.equal(await page.getByRole('tab', { name: '按客户', exact: true }).getAttribute('data-state'), 'active')
      await page.getByRole('heading', { name: /^应收余额按客户分布/ }).waitFor()
      await page.getByRole('tab', { name: '按主体', exact: true }).click()
      await page.getByText('-15,000.00', { exact: true }).waitFor()
      const nameBox = await page.getByText('用于检验完整显示的长名称主体（华东区域经营管理与家用电器服务公司）', { exact: true }).boundingBox()
      assert(nameBox.x >= 0 && nameBox.x + nameBox.width <= width + 1, '条形图长名称越界')
      const agingGeometry = await page.locator('[data-aging-structure]').evaluate((card) => {
        const rows = [...card.querySelectorAll('[data-distribution-variant="comparison"]')]
        const box = (element) => element.getBoundingClientRect()
        return {
          count: rows.length,
          inline: rows.every((row) => Math.abs(box(row.querySelector('.distribution-row-label')).top - box(row.querySelector('.distribution-row-track')).top) < 12),
          maximumRowHeight: Math.max(...rows.map((row) => box(row).height)),
          values: rows.map((row) => row.querySelector('.distribution-row-value').textContent),
          percentages: rows.map((row) => row.querySelector('.distribution-row-meta').textContent),
        }
      })
      assert.equal(agingGeometry.count, 8)
      assert.deepEqual(agingGeometry.values, ['960.00', '240.00', '160.00', '80.00', '60.00', '40.00', '10.00', '10.00'])
      assert.deepEqual(agingGeometry.percentages, ['61.5%', '15.4%', '10.3%', '5.1%', '3.8%', '2.6%', '0.6%', '0.6%'])
      if (width === 1440) {
        assert.equal(agingGeometry.inline, true, '桌面账龄没有共用一行')
        assert(agingGeometry.maximumRowHeight <= 41, '桌面账龄行过高')
      } else assert(agingGeometry.maximumRowHeight <= 56, '手机账龄行过高')
      await page.getByRole('tab', { name: '完整报表', exact: true }).click()
      assert.equal(await page.locator('[data-aging-matrix] thead th').count(), 10)
      assert.equal(await page.locator('.aging-matrix-value').count(), 16)
      const matrixAlphas = await page.locator('.aging-matrix-value').evaluateAll((cells) => cells.map((cell) => Number(cell.style.getPropertyValue('--aging-cell-alpha'))))
      assert(matrixAlphas.every((alpha) => Number.isFinite(alpha) && alpha >= 0 && alpha <= .181))
      const detail = page.locator('[data-detail-table]'), detailCell = detail.locator('tbody tr').first().locator('td').first()
      const detailBefore = await detailCell.boundingBox()
      await page.locator('.detail-table-scroll').evaluate((element) => { element.scrollLeft = 160 })
      const detailAfter = await detailCell.boundingBox()
      assert(Math.abs(detailBefore.x - detailAfter.x) <= 1, '明细名称列横向滚动后移位')
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        headerBottom: document.querySelector('header').getBoundingClientRect().bottom,
        titleBottom: document.querySelector('header h1').getBoundingClientRect().bottom,
        selectedLinks: document.querySelectorAll('.module-tabs a[aria-current="page"]').length,
        negativeValue: [...document.querySelectorAll('td')].some((element) => element.textContent.includes('-15,000.00')),
      }))
      assert.equal(geometry.overflow, 0)
      assert(geometry.titleBottom <= geometry.headerBottom)
      assert.equal(geometry.selectedLinks, 1)
      assert.equal(await page.locator('[data-aging-matrix] tbody tr').count() > 0, true)
      await page.screenshot({ path: output + '/' + theme + '-' + width + '-aging.png' })
      await navigation.getByRole('link', { name: '存货分析', exact: true }).press('Enter')
      await page.waitForURL('**/dashboard/analysis/inventory-aging')
      await page.getByRole('table', { name: '公司与品类库存明细，单位万元' }).waitFor()
      await page.locator('.module-tabs a[href="/dashboard/analysis/inventory-aging"][aria-current="page"]').waitFor()
      await page.locator('[data-detail-table]').waitFor()
      assert.equal(await navigation.getByRole('link', { name: '存货分析', exact: true }).getAttribute('aria-current'), 'page')
      assert.deepEqual(errors, [])

      // 每个带模块分类的页面均先呈现分类，再呈现本页动作；同时检查键盘的 DOM 顺序。
      for (const pathname of [
        '/transactions/overview', '/transactions/aging', '/transactions/account-filter', '/transactions/coverage',
        '/transactions/collections/plans', '/transactions/collections/salesmen',
        '/indicators/operating', '/reports', '/reports/analyses', '/dashboard/analysis/receivable-aging',
        '/data/import', '/data/browse', '/data/reclassify', '/data/reclassify/consolidation',
        '/data/dimensions/company', '/data/board/category',
      ]) {
        await page.goto(base + pathname)
        await page.getByRole('navigation', { name: '模块分类' }).waitFor()
        await page.locator('header h1').waitFor()
        const order = await page.locator('.page-container').evaluate((container) => {
          const navigation = container.querySelector('.module-tabs')
          const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
          const buttons = [...container.querySelectorAll('button')].filter((button) => !button.closest('.module-tabs') && visible(button))
          const box = navigation.getBoundingClientRect()
          return {
            beforeInDom: buttons.filter((button) => button.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).map((button) => button.textContent.trim()),
            above: buttons.filter((button) => button.getBoundingClientRect().top < box.bottom - 1).map((button) => button.textContent.trim()),
            firstVisible: [...container.children].find(visible)?.classList.contains('module-tabs'),
            overflow: document.documentElement.scrollWidth - innerWidth,
          }
        })
        assert.deepEqual(order.beforeInDom, [], pathname + ' 的操作仍在分类之前')
        assert.deepEqual(order.above, [], pathname + ' 的操作仍显示在分类上方')
        assert.equal(order.firstVisible, true, pathname + ' 分类前仍有空工具行')
        assert.equal(order.overflow, 0, pathname + ' 出现整页横向溢出')
        const expected = {
          '/transactions/overview': ['刷新', '导入'],
          '/transactions/aging': ['刷新', '导出 Excel'],
          '/transactions/collections/salesmen': ['刷新', '新建业务员'],
          '/data/browse': ['导出 Excel', '导出 PDF'],
          '/data/reclassify/consolidation': ['新建汇总调整'],
        }[pathname] ?? []
        for (const name of expected) {
          const action = page.locator('[data-page-actions]').getByRole('button', { name, exact: true })
          await action.waitFor()
          const rect = await action.boundingBox()
          assert(rect.x >= 0 && rect.x + rect.width <= width + 1, name + ' 越出可视区')
        }
        if (pathname === '/transactions/overview') {
          let requests = 0
          const onRequest = (request) => { if (request.url().includes('/transactions/overview')) requests++ }
          page.on('request', onRequest)
          await Promise.all([
            page.waitForResponse((response) => response.url().includes('/transactions/overview')),
            page.locator('[data-page-actions]').getByRole('button', { name: '刷新', exact: true }).click(),
          ])
          page.off('request', onRequest)
          assert(requests >= 1, '移动后的刷新按钮未触发原查询')
          await page.getByRole('button', { name: '导入', exact: true }).click()
          const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '导入往来数据', exact: true }) })
          await dialog.waitFor()
          await dialog.getByRole('button', { name: '取消', exact: true }).click()
          await dialog.waitFor({ state: 'hidden' })
        }
        if (pathname === '/transactions/collections/salesmen') {
          await page.getByRole('button', { name: '新建业务员', exact: true }).click()
          const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '新建业务员', exact: true }) })
          await dialog.waitFor()
          await dialog.getByRole('button', { name: '取消', exact: true }).click()
          await dialog.waitFor({ state: 'hidden' })
        }
        if (pathname === '/data/reclassify/consolidation') {
          await page.getByRole('button', { name: '新建汇总调整', exact: true }).click()
          await page.waitForURL('**/data/reclassify/consolidation/new')
          await page.goBack()
          await page.waitForURL('**/data/reclassify/consolidation')
        }
        if (['/transactions/overview', '/indicators/operating', '/data/browse'].includes(pathname)) {
          await page.screenshot({ path: output + '/' + theme + '-' + width + '-actions-' + pathname.replaceAll('/', '-').slice(1) + '.png' })
        }
        results.push({ theme, width, scenario: 'tab-before-actions', pathname, order })
      }

      assert.deepEqual(errors, [])
      results.push({ theme, width, geometry, agingGeometry, errors })
      await context.close()
    }
  }

  // 特殊读数单独注入模拟响应，验证矩阵底色不会丢失负号、零值或大金额。
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await context.addInitScript((auth) => {
      localStorage.setItem('auth-storage', JSON.stringify(auth))
      localStorage.setItem('last-seen-version', '999.0.0')
    }, auth)
    await context.route('**/api/v1/**', async (route) => {
      const result = structuredClone(resolveBrowserFixture(route))
      if (route.request().url().includes('/transactions/aging') && Array.isArray(result.data)) {
        for (const [index, row] of result.data.entries()) {
          row.aging['1个月'] = index === 0 ? 9999999999900 : 10000
          row.aging['2个月'] = index === 0 ? -15000 : 0
          row.aging['3个月'] = 0
          row.companyName = index === 0 ? '华东区域经营管理与家用电器服务公司（账龄矩阵长名称检查）' : row.companyName
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) })
    })
    const page = await context.newPage()
    await page.goto(base + '/dashboard/analysis/receivable-aging')
    await page.getByRole('tab', { name: '完整报表', exact: true }).click()
    const matrix = page.getByRole('table', { name: '主体账龄明细，单位万元' })
    await matrix.waitFor()
    assert(await matrix.locator('.aging-matrix-value').filter({ hasText: /^-1\.50$/ }).isVisible())
    assert(await matrix.locator('.aging-matrix-value').filter({ hasText: /^999,999,999\.99$/ }).isVisible())
    const cells = await matrix.locator('tbody tr:not(.report-total-row) .aging-matrix-value').evaluateAll((elements) => elements.map((cell) => ({
      text: cell.textContent, alpha: Number(cell.style.getPropertyValue('--aging-cell-alpha')),
    })))
    assert(cells.filter((cell) => cell.text === '–').every((cell) => cell.alpha === 0), '零值错误着色')
    assert(cells.find((cell) => cell.text === '-1.50').alpha > 0, '负值未保留可比较底色')
    assert(cells.find((cell) => cell.text === '999,999,999.99').alpha > cells.find((cell) => cell.text === '1.00').alpha, '同列深浅没有跟随金额')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
    await page.screenshot({ path: output + '/light-' + width + '-aging-edge-values.png' })
    await context.close()
    results.push({ width, scenario: 'aging-edge-values', cells })
  }
  await writeFile(output + '/report.json', JSON.stringify({ results }, null, 2))
  console.log('通过：四主题及特殊读数组合共 ' + results.length + ' 组；顶栏标题、分类方向键/Enter、浏览器返回筛选、排序、冻结列、长名称、负值、条形图口径切换、紧凑账龄与金额矩阵。')
} finally { await browser.close() }
