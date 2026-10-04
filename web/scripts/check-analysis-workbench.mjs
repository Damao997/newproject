// 经营分析工作台回归：只读模拟接口，不连接业务数据库。
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { auth, user, resolveBrowserFixture, configureBrowserFixture } from './redesign-fixtures.mjs'
const base = process.env.ANALYSIS_BASE_URL ?? 'http://127.0.0.1:5173'
const output = fileURLToPath(new URL('../audit/analysis-workbench/', import.meta.url))
await mkdir(output, { recursive: true })
const pages = ['key-metrics', 'core-metrics', 'category-budget', 'subject-budget', 'expense', 'cash-flow', 'receivable-aging', 'inventory-aging']
const browser = await chromium.launch({ headless: true, channel: 'msedge' }), results = []
async function make(theme = 'light', width = 1440, scope = ['ET0001']) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  configureBrowserFixture(context, { theme, revision: 1 })
  await context.addInitScript(({ auth, user, scope }) => {
    localStorage.setItem('auth-storage', JSON.stringify(auth)); localStorage.setItem('last-seen-version', '999.0.0')
    localStorage.setItem('period-storage:' + user.id, JSON.stringify({ state: { fiscalYear: null, period: '2026-09', companyCodes: scope }, version: 0 }))
  }, { auth, user, scope })
  await context.route('**/api/v1/**', async route => {
    assert.equal(route.request().method(), 'GET', '工作台只读检查出现写入请求')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resolveBrowserFixture(route)) })
  })
  return context
}
try {
  for (const theme of ['light', 'gradient', 'dark', 'antd']) for (const width of [1440, 900, 390]) {
    const context = await make(theme, width), page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const key of pages) {
      await page.goto(base + '/dashboard/analysis/' + key)
      await page.getByRole('tab', { name: '重点', exact: true }).waitFor()
      assert.equal(await page.getByRole('tab', { name: '重点', exact: true }).getAttribute('data-state'), 'active')
      const nav = page.getByRole('navigation', { name: '模块分类' })
      assert.equal(await nav.locator('.module-tabs-group').count(), 2)
      assert.equal(await nav.getByRole('link').count(), 8)
      assert.equal(await nav.locator('[aria-current="page"]').count(), 1)
      assert.equal(await nav.locator('.module-tabs-viewport').evaluate(element => element.scrollTop), 0, '分组标签被纵向滚动遮挡')
      if (width === 390) {
        const controls = await page.locator('.header-controls').evaluate(element => [...element.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width).map(button => button.getBoundingClientRect().toJSON()))
        for (let index = 1; index < controls.length; index++) assert(controls[index].left >= controls[index - 1].right - 1, '顶栏公司/期间/账号互相覆盖')
      }
      const navBox = await nav.boundingBox(), toolbarBox = await page.locator('.analysis-toolbar').boundingBox()
      assert(toolbarBox.y - navBox.y - navBox.height <= 12, '分类导航与操作区间距超过 12px')
      if (width === 1440) assert(toolbarBox.height <= 60, '桌面操作区纵向占位过大')
      await page.locator('[data-analysis-section="focus"]').waitFor()
      if (await page.locator('.analysis-comparison-item').count()) {
        const first = page.locator('.analysis-comparison-item').first()
        await first.focus(); await first.press('Enter')
        await page.getByRole('region', { name: '选中项目明细' }).waitFor()
        assert.equal(await first.getAttribute('aria-pressed'), 'true')
        await page.getByRole('button', { name: '清除选择', exact: true }).click()
        assert.equal(await page.getByRole('region', { name: '选中项目明细' }).count(), 0)
        const search = page.getByRole('textbox', { name: '搜索比较项目' })
        await search.fill('无匹配项目'); await page.getByText('没有匹配的项目', { exact: true }).waitFor(); await search.fill('')
        await page.getByRole('combobox', { name: '比较排序' }).focus(); await page.getByRole('combobox', { name: '比较排序' }).press('ArrowDown')
        await page.locator('.ant-select-item-option').filter({ hasText: '名称排序' }).click()
        await page.getByRole('combobox', { name: '比较排序' }).press('Escape')
      }
      if (key === 'inventory-aging') {
        await page.locator('.analysis-comparison-item').first().click()
        assert.equal(await page.locator('[data-comparison-matrix] tbody tr').count(), 1)
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
      assert.equal(await page.locator('.app-content').evaluate(element => element.scrollWidth - element.clientWidth), 0, '宽表撑宽主内容容器')
      await page.locator('.app-content').evaluate(element => { element.scrollTop = 0 })
      await page.screenshot({ path: output + '/' + theme + '-' + width + '-' + key + '-focus.png', fullPage: true })
      await page.getByRole('tab', { name: '完整报表', exact: true }).click()
      const table = page.locator('[data-comparison-matrix]')
      await table.waitFor()
      if (key === 'subject-budget' || key === 'category-budget') {
        const toolbar = await page.locator('.analysis-toolbar').boundingBox(), matrix = await table.boundingBox()
        assert(matrix.y - toolbar.y - toolbar.height <= 12, '预算表仍有独立口径行留白')
      }
      assert.equal(await page.locator('[data-analysis-section="report"] h3').count(), 0, '完整报表仍有重复标题')
      assert.equal(await table.evaluate(element => Boolean(element.closest('.app-card'))), false, '完整报表仍嵌套白色卡片外壳')
      if (key === 'inventory-aging') assert.equal(await table.locator('tbody tr').count(), 4, '完整报表不应被品类选择过滤')
      const firstCell = table.locator('tbody tr').first().locator('td').first(), before = await firstCell.boundingBox()
      const nameHead = table.locator('thead tr').first().locator('th').first(), headBefore = await nameHead.boundingBox()
      await table.locator('..').evaluate(element => { element.scrollLeft = 200 })
      const after = await firstCell.boundingBox(); assert(Math.abs(before.x - after.x) <= 1, key + ' 名称列没有冻结')
      const headAfter = await nameHead.boundingBox(); assert(Math.abs(headBefore.x - headAfter.x) <= 1, key + ' 名称表头没有冻结')
      assert.equal(await firstCell.evaluate(element => getComputedStyle(element).position), 'sticky')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
      await page.locator('.app-content').evaluate(element => { element.scrollTop = 0 })
      await page.screenshot({ path: output + '/' + theme + '-' + width + '-' + key + '-report.png', fullPage: true })
      if (key === 'subject-budget' || key === 'category-budget') {
        await page.getByRole('tab', { name: '累计', exact: true }).click()
        await page.getByRole('tab', { name: '重点', exact: true }).click()
        await page.getByText('累计实际与累计预算比较（按月度预算累加）').waitFor()
        await page.getByRole('tab', { name: '完整报表', exact: true }).click()
      }
      await nav.getByRole('link').filter({ hasText: key === 'key-metrics' ? '核心指标分析' : '关键指标概览' }).click()
      await page.goBack()
      await page.getByRole('tab', { name: '完整报表', exact: true }).waitFor()
      assert.equal(await page.getByRole('tab', { name: '完整报表', exact: true }).getAttribute('data-state'), 'active', key + ' 返回后视图没有恢复')
      assert.deepEqual(errors, [])
      results.push({ theme, width, key, focus: true, report: true, restored: true })
    }
    await context.close()
  }
  const context = await make('light', 390, ['EN330001', 'EN330002']), page = await context.newPage(), scopes = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/dashboard/analysis/key-metrics') scopes.push(new URL(request.url()).searchParams.get('companyCode')) })
  await page.goto(base + '/dashboard/analysis/key-metrics'); await page.getByRole('heading', { name: '选择本次分析主体' }).waitFor()
  assert.equal(scopes.length, 0, '多主体门禁前出现分析请求')
  await page.getByRole('button', { name: '选择公司范围' }).first().click()
  await page.getByRole('radio', { name: /杭州/ }).check(); await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('heading', { name: '选择本次分析主体' }).waitFor(); assert.equal(scopes.length, 0)
  await page.getByRole('button', { name: '选择公司范围' }).first().click()
  await page.getByRole('radio', { name: /浙江汇总/ }).check(); await page.getByRole('button', { name: '应用', exact: true }).click()
  await page.getByRole('tab', { name: '重点', exact: true }).waitFor(); assert.deepEqual(scopes, ['ET0001'])
  await context.close()
  await writeFile(output + '/report.json', JSON.stringify({ results, scope: { cancelUnchanged: true, appliedOnce: true }, mocked: true }, null, 2))
  console.log('通过：四主题 × 三种宽度 × 八页 = ' + results.length + ' 组；两种视图、键盘选择、搜索、排序、冻结列、返回恢复、主体应用与取消。')
} finally { await browser.close() }
