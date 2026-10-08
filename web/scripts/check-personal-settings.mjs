// 个人设置与往来展示回归：全部请求在内存模拟，真实浏览器检查布局与交互。
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { auth, resolveFixture } from './redesign-fixtures.mjs'
import { createPersonalFixtures } from './personal-fixtures.mjs'
const base = process.env.PERSONAL_BASE_URL ?? 'http://127.0.0.1:5178'
const output = fileURLToPath(new URL('../audit/personal-settings/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const results = []
let activePage
async function make(theme = 'light', width = 1440, shared = createPersonalFixtures({ theme, revision: 1 })) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 740 : 900 } })
  await context.addInitScript(({ auth, theme }) => {
    localStorage.setItem('auth-storage', JSON.stringify(auth))
    localStorage.setItem('sidebar-style-storage', JSON.stringify({ state: { sidebarStyle: theme }, version: 0 }))
    localStorage.setItem('preferences-migrated:' + auth.state.user.id, 'true')
    localStorage.setItem('last-seen-version', '999.0.0')
  }, { auth, theme })
  const controls = { failProfile: false, failPreference: false, delay: 0, writes: 0 }
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const method = request.method()
    if (method === 'PATCH') { controls.writes++; if (controls.delay) await new Promise(done => setTimeout(done, controls.delay)) }
    let body = {}
    if (request.headers()['content-type']?.includes('application/json')) body = request.postDataJSON() ?? {}
    let response = (method === 'PATCH' && ((controls.failProfile && path.endsWith('/auth/profile')) || (controls.failPreference && path.endsWith('/auth/preferences'))))
      ? { code: 500, message: '模拟保存失败，请重试', data: null }
      : shared(request.url(), method, body) ?? resolveFixture(request.url(), method)
    if (response.binary) await route.fulfill({ status: 200, contentType: response.contentType, body: response.binary })
    else await route.fulfill({ status: response.code >= 400 ? response.code : 200, contentType: 'application/json', body: JSON.stringify(response) })
  })
  const page = await context.newPage(), errors = []
  activePage = page
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.dismiss())
  return { context, page, controls, shared, errors }
}
async function shot(page, label) { await page.screenshot({ path: output + label + '.png' }) }
async function settled(page) { await page.locator('.settings-form-card, .transaction-summary-card, .stat-tile, .settings-security-action').first().waitFor() }
async function noOverflow(page, label) {
  assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0, label + ' 页面横向溢出')
}
try {
  for (const theme of (process.env.PERSONAL_ONLY_INTERACTIONS === '1' ? [] : ['light', 'gradient', 'dark', 'antd'])) for (const width of [1440, 390]) {
    const { context, page, errors, shared } = await make(theme, width)
    for (const section of ['profile', 'preferences', 'security']) {
      await page.goto(base + '/settings/' + section); await settled(page)
      assert.equal(await page.locator('header h1').textContent(), '个人设置')
      assert.equal(await page.getByRole('button', { name: '选择公司范围', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: '选择期间', exact: true }).count(), 0)
      assert.equal(await page.locator('html').getAttribute('data-sidebar'), theme)
      if (section !== 'security') { await page.locator('.settings-save-bar').waitFor(); const footer = await page.locator('.settings-save-bar').boundingBox(); assert(footer.y + footer.height <= (width === 390 ? 740 : 900) + 1, '设置操作区超出窗口') }
      await noOverflow(page, section); await shot(page, theme + '-' + width + '-' + section)
      results.push({ theme, width, section, pass: true })
    }
    await page.goto(base + '/transactions/overview'); await settled(page)
    assert.equal(await page.locator('[data-transaction-card]').count(), 6)
    assert.equal(await page.getByText('期末余额合计', { exact: true }).count(), 0)
    assert.equal(await page.getByText('记录笔数合计', { exact: true }).count(), 0)
    assert.equal(await page.getByText('3 年以上长账龄', { exact: true }).count(), 0)
    const card = page.locator('[data-transaction-card]').first()
    const amount = await card.locator('.transaction-summary-value').textContent()
    const compactHeight = (await card.boundingBox()).height
    await shot(page, theme + '-' + width + '-amount')
    await page.getByRole('radio', { name: '明细', exact: true }).check()
    await page.waitForFunction(() => document.querySelector('[data-transaction-card]').getBoundingClientRect().height > 350)
    assert.equal(await card.locator('.transaction-summary-value').textContent(), amount)
    assert.equal(await page.locator('[data-aging-distribution="summary"] .distribution-row').count(), 48)
    assert((await card.boundingBox()).height > compactHeight + 150)
    await noOverflow(page, '往来明细'); await shot(page, theme + '-' + width + '-details')
    await page.getByRole('radio', { name: '金额', exact: true }).check()
    await page.waitForFunction(() => document.querySelector('[data-transaction-card]').getBoundingClientRect().height < 250)
    assert.equal(await card.locator('.transaction-card-disclosure').getAttribute('inert'), '')
    // 键盘切换与账号本机状态恢复。
    await page.getByRole('radio', { name: '金额', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await page.getByRole('radio', { name: '明细', exact: true }).isChecked(), true)
    await page.reload(); await settled(page)
    assert.equal(await page.getByRole('radio', { name: '明细', exact: true }).isChecked(), true)
    await page.goto(base + '/inventory'); await settled(page)
    const tiles = page.locator('.stat-tile')
    assert.equal(await tiles.count(), 4)
    assert.deepEqual(await tiles.evaluateAll(nodes => nodes.map(node => node.dataset.metricTone)), ['1', '2', '4', '3'])
    const surfaces = await tiles.evaluateAll(nodes => nodes.map(node => ({ radius: getComputedStyle(node).borderRadius, color: getComputedStyle(node).backgroundColor })))
    assert(surfaces.every(tile => tile.radius === '24px'))
    assert.equal(new Set(surfaces.map(tile => tile.color)).size, 4)
    await noOverflow(page, '库存'); await shot(page, theme + '-' + width + '-inventory')
    for (const mode of ['month', 'ytd']) {
      const current = shared('/api/v1/auth/preferences').data
      shared('/api/v1/auth/preferences', 'PATCH', { revision: current.revision, changes: { dashboardKpiMode: mode } })
      await page.goto(base + '/dashboard')
      await page.reload()
      await page.locator('.kpi-card[data-kpi-mode="' + mode + '"]').first().waitFor()
      assert.equal(await page.locator('.kpi-card[data-kpi-mode="' + mode + '"]').count(), 4)
      assert.equal(await page.locator('.kpi-trend').count(), mode === 'month' ? 4 : 0)
      if (mode === 'month') {
        const help = page.getByRole('button', { name: '月度环比：上月金额为 0，无法计算环比', exact: true })
        await help.press('Enter')
        await page.getByText('上月金额为 0，无法计算环比', { exact: true }).waitFor()
        assert.equal(new URL(page.url()).pathname, '/dashboard', '查看环比原因不应触发钻取')
        await help.press('Enter')
      }
      await noOverflow(page, '首页 KPI ' + mode)
      await shot(page, theme + '-' + width + '-dashboard-kpi-' + mode)
    }
    assert.deepEqual(errors, []); results.push({ theme, width, cards: true, pass: true })
    await context.close()
  }
  const { context, page, controls, shared, errors } = await make()
  await page.goto(base + '/transactions/overview'); await settled(page)
  const company = page.getByRole('button', { name: '选择公司范围', exact: true })
  const before = await company.textContent()
  await company.click()
  await page.getByRole('button', { name: '全选单体公司', exact: true }).click()
  assert.equal(await company.textContent(), before)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await company.textContent(), before)
  await company.click()
  const search = page.getByRole('textbox', { name: '搜索公司' })
  await search.fill('EN330001'); assert.equal(await page.locator('.company-option').count(), 1)
  await page.getByRole('button', { name: '清除公司搜索', exact: true }).click()
  assert.equal(await search.inputValue(), '')
  await page.getByRole('button', { name: '全选单体公司', exact: true }).click()
  await page.getByRole('button', { name: '应用', exact: true }).click()
  assert.match(await company.textContent(), /2 家公司/)
  await company.click(); await page.keyboard.press('Escape')
  assert.equal(await company.evaluate(node => node === document.activeElement), true)
  const period = page.getByRole('button', { name: '选择期间', exact: true })
  await period.click()
  assert.equal(await page.locator('.period-month').count(), 12)
  assert(await page.locator('.period-month:disabled').count() > 0)
  await page.getByRole('button', { name: '2026年8月', exact: true }).click()
  assert.match(await period.textContent(), /2026年08月/)
  await period.click(); await page.getByRole('button', { name: '最新期间', exact: true }).click()
  assert.match(await period.textContent(), /2026年09月/)
  await page.goto(base + '/settings/profile'); await settled(page)
  const name = page.getByRole('textbox', { name: /^姓名/ })
  await name.fill('')
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await page.getByText('请输入姓名', { exact: true }).first().waitFor()
  assert.equal(await name.evaluate(node => node === document.activeElement), true)
  await name.fill('中文输入检查')
  controls.failProfile = true
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await page.getByText('模拟保存失败，请重试', { exact: true }).waitFor()
  assert.equal(await name.inputValue(), '中文输入检查')
  await page.getByRole('link', { name: '使用习惯', exact: true }).click()
  await page.getByRole('dialog', { name: '放弃未保存的修改？' }).waitFor()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.equal(await name.inputValue(), '中文输入检查')
  controls.failProfile = false; controls.delay = 400
  const count = controls.writes
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: /保存资料/ }).isDisabled(), true)
  await page.getByText('资料已保存', { exact: true }).waitFor()
  assert.equal(controls.writes - count, 1); controls.delay = 0
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64')
  await page.getByLabel('上传个人头像').setInputFiles({ name: '模拟头像.png', mimeType: 'image/png', buffer: png })
  assert(await page.getByAltText('待保存头像预览').isVisible())
  await page.getByRole('button', { name: '保存头像', exact: true }).click()
  await page.getByRole('button', { name: '移除头像', exact: true }).waitFor()
  await page.getByRole('button', { name: '移除头像', exact: true }).click()
  await page.getByRole('dialog', { name: '移除头像？' }).getByRole('button', { name: '移除头像', exact: true }).click()
  await page.locator('.settings-avatar-section').getByRole('button', { name: '移除头像', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('link', { name: '使用习惯', exact: true }).click(); await settled(page)
  const radios = page.getByRole('radiogroup', { name: '工作台主题' }).getByRole('radio')
  await radios.nth(1).click()
  await page.getByRole('combobox', { name: '首页 KPI 显示模式', exact: true }).press('ArrowDown')
  await page.getByText('财年累计', { exact: true }).last().click()
  assert.equal(await page.locator('html').getAttribute('data-sidebar'), 'light')
  // 另一设备保存后当前编辑保留，并要求显式处理冲突。
  let latest = shared('/api/v1/auth/preferences').data
  shared('/api/v1/auth/preferences', 'PATCH', { revision: latest.revision, changes: { indicatorDensity: 'dense' } })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByText('已保存设置有更新，你的编辑仍在本页保留。', { exact: true }).waitFor()
  assert.equal(await radios.nth(1).getAttribute('aria-checked'), 'true')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByRole('button', { name: '确认重新提交', exact: true }).waitFor()
  await page.getByRole('button', { name: '确认重新提交', exact: true }).click()
  await page.getByRole('dialog', { name: '用本页设置更新？' }).getByRole('button', { name: '确认重新提交', exact: true }).click()
  await page.getByText('设置已保存', { exact: true }).waitFor()
  assert.equal(await page.locator('html').getAttribute('data-sidebar'), 'gradient')
  const other = await make('light', 390, shared)
  await other.page.goto(base + '/settings/preferences'); await settled(other.page)
  assert.equal(await other.page.locator('html').getAttribute('data-sidebar'), 'gradient')
  assert.equal(shared('/api/v1/auth/preferences').data.preferences.dashboardKpiMode, 'ytd')
  // 同账号另一设备恢复累计模式；重新载入仍无迷你趋势和月度环比。
  for (const target of [page, other.page]) {
    await target.goto(base + '/dashboard')
    await target.locator('.kpi-card[data-kpi-mode="ytd"]').first().waitFor()
    assert.equal(await target.locator('.kpi-card[data-kpi-mode="ytd"]').count(), 4)
    assert.equal(await target.locator('.kpi-trend').count(), 0)
    assert.equal(await target.getByText('累计同比', { exact: true }).count(), 4)
    assert.equal(await target.getByText('月度环比', { exact: true }).count(), 0)
    await noOverflow(target, '累计 KPI')
    await target.reload()
    await target.locator('.kpi-card[data-kpi-mode="ytd"]').first().waitFor()
  }
  await shot(page, 'dashboard-kpi-ytd-desktop')
  await shot(other.page, 'dashboard-kpi-ytd-mobile')
  await other.page.goto(base + '/transactions/overview'); await settled(other.page)
  await other.page.getByRole('button', { name: '选择公司范围', exact: true }).click()
  assert(await other.page.locator('.header-filter-drawer').isVisible())
  await shot(other.page, 'mobile-company-panel')
  await other.page.getByRole('button', { name: '应用', exact: true }).click()
  await other.page.getByRole('button', { name: '选择期间', exact: true }).click()
  await shot(other.page, 'mobile-period-panel')
  await other.page.keyboard.press('Escape')
  await other.page.emulateMedia({ reducedMotion: 'reduce' })
  await other.page.getByRole('radio', { name: '明细', exact: true }).check()
  assert(await other.page.locator('.transaction-card-disclosure').first().evaluate(node => parseFloat(getComputedStyle(node).transitionDuration) <= .001), '减少动态效果时不应保留可感知过渡')
  // 默认入口仅作用于根路径，深链接优先；启动范围只在进入会话时应用。
  latest = shared('/api/v1/auth/preferences').data
  shared('/api/v1/auth/preferences', 'PATCH', { revision: latest.revision, changes: { homePath: '/inventory', companyStartup: 'fixed', defaultCompanies: ['EN330001'], periodStartup: 'latest' } })
  const startup = await make('light', 1440, shared)
  await startup.page.goto(base + '/reports')
  await startup.page.getByRole('heading', { name: '分析报告中心', exact: true }).waitFor()
  assert.equal(new URL(startup.page.url()).pathname, '/reports')
  await startup.page.goto(base + '/')
  await startup.page.waitForURL('**/inventory'); await settled(startup.page)
  const startupCompany = startup.page.getByRole('button', { name: '选择公司范围', exact: true })
  assert.match(await startupCompany.textContent(), /杭州/)
  await startupCompany.click()
  await startup.page.getByRole('button', { name: '全选单体公司', exact: true }).click()
  await startup.page.getByRole('button', { name: '应用', exact: true }).click()
  await startup.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await startup.page.waitForTimeout(100)
  assert.match(await startupCompany.textContent(), /2 家公司/, '重新聚焦不应重新应用启动范围')
  assert.deepEqual(startup.errors, [])
  await startup.context.close()
  assert.deepEqual(errors, []); assert.deepEqual(other.errors, [])
  results.push({ interactions: '草稿、应用、搜索、焦点、月份、校验、失败保留、离开保护、防重复、头像、版本冲突、跨设备、手机及减少动态', pass: true })
  await context.close(); await other.context.close()
} catch (cause) {
  if (activePage) { await activePage.screenshot({ path: output + 'failure.png' }); await writeFile(output + 'failure.html', await activePage.content()) }
  results.push({ pass: false, error: cause.message })
  await writeFile(output + (process.env.PERSONAL_ONLY_INTERACTIONS === '1' ? 'interaction-result.json' : 'result.json'), JSON.stringify(results, null, 2))
  throw cause
} finally { await browser.close() }
await writeFile(output + (process.env.PERSONAL_ONLY_INTERACTIONS === '1' ? 'interaction-result.json' : 'result.json'), JSON.stringify(results, null, 2))
console.log('个人设置与卡片真实浏览器回归通过：' + results.length + ' 组')
