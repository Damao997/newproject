// 小窗口回归：保留真实高度/溢出样式，接口全部模拟，不读取或修改业务数据。
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const base = process.env.RESPONSIVE_BASE_URL ?? 'http://127.0.0.1:5175'
const output = fileURLToPath(new URL('../audit/responsive-layout/', import.meta.url))
await mkdir(output, { recursive: true })
const companies = [
  { id: 'a', code: 'EN330001', name: '浙江壹品慧科技有限公司杭州分公司', type: 'entity', status: 'active' },
  { id: 'b', code: 'EN330002', name: '深圳市壹品慧首欣水科技有限公司杭州分公司', type: 'entity', status: 'active' },
  { id: 'c', code: 'ET0001', name: '浙江省汇总主体', type: 'summary', status: 'active' },
]
const subjects = [
  { id: 's1', code: 'PL0201', name: '家用电器收入（含净水）', valueType: 'amount', dataType: 'data', isLeaf: true },
  { id: 's2', code: 'PL0202', name: '优选产品收入', valueType: 'amount', dataType: 'data', isLeaf: true },
]
const logs = Array.from({ length: 10 }, (_, index) => ({
  id: `log-${index}`, type: index % 2 ? 'company' : 'subject_adjust', templateType: 'operating',
  sourceCompany: companies[0].code, targetCompany: companies[1].code,
  sourceSubject: subjects[0].code, targetSubject: subjects[1].code,
  period: '2026-08', periodFrom: null, periodTo: null, affectedRows: 12,
  operator: '布局验证账号', createdAt: '2026-09-08T06:43:35.000Z',
  revertedAt: index === 2 ? '2026-09-09T06:00:00Z' : null, revertedBy: null,
  invalidatedAt: null, invalidatedReason: null, invalidation: null, revertible: index !== 2,
  detail: { transferMode: 'amount', transferValue: 5, adjustMode: 'both', decreaseAmount: 5, increaseAmount: 8, netChange: 3, reason: '模拟调整原因，用于验证长正文、预览和固定底部。' },
}))
const permissions = [
  'dashboard:view', 'indicators:view', 'data:browse:view', 'data:dimensions:view',
  'data:reclassify:company', 'data:reclassify:subject', 'transactions:view', 'transactions:update',
  'transactions:create', 'transactions:salesmen:view', 'transactions:salesmen:create', 'transactions:salesmen:update',
  'reports:view', 'reports:create', 'admin:users:view', 'admin:roles:view',
]
const auth = { state: { user: { id: 'layout-test', username: 'layout-test', name: '布局验证', role: 'superadmin', permissions, dataScope: 'all', status: 'active' }, accessToken: 'mock-layout-token', refreshToken: 'mock-layout-refresh', isAuthenticated: true }, version: 0 }
const browser = await chromium.launch({ headless: true, channel: process.env.RESPONSIVE_BROWSER ?? 'msedge' })
const report = []

async function installMock(context, scenario) {
  await context.addInitScript((seed) => {
    localStorage.setItem('auth-storage', JSON.stringify(seed))
    localStorage.setItem('last-seen-version', '999.0.0')
  }, auth)
  await context.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    let data = null
    let code = 0
    let message = '布局验证模拟数据'
    const paged = (items) => ({ items, total: 60, page: Number(url.searchParams.get('page') ?? 1), pageSize: 10 })
    if (url.pathname.endsWith('/data/companies')) data = companies
    else if (url.pathname.endsWith('/data/subjects/tree')) data = subjects
    else if (url.pathname.endsWith('/data/subjects')) data = paged(subjects)
    else if (url.pathname.endsWith('/data/reclassify/logs')) data = url.searchParams.get('type') === 'subject' ? paged([]) : paged(logs)
    else if (url.pathname.endsWith('/data/consolidation/adjustments')) data = paged(logs.map((row) => ({ ...row, summaryCompanyCode: 'ET0001', summaryCompanyName: companies[2].name, accountCode: subjects[0].code, accountName: subjects[0].name, amount: 8, reason: '模拟抵消原因' })))
    else if (url.pathname.endsWith('/indicators/periods')) data = { periods: ['2026-08', '2026-09'], fiscalYears: ['2026'], fiscalStartMonth: 1 }
    else if (url.pathname.endsWith('/data/aggregation-map')) data = []
    else if (url.pathname.endsWith('/transactions/salesmen/manage')) data = paged(logs.map((row, index) => ({ id: row.id, name: `业务员${index}`, companyCodes: [companies[0].code], companyNames: [companies[0].name], phone: '模拟联系方式', remark: '布局验证', status: 'active' })))
    else if (url.pathname.endsWith('/transactions/collections/customers')) data = { ...paged(logs.map((row, index) => ({ companyCode: companies[0].code, counterpartyCode: `CUSTOMER-${index}`, counterpartyName: `用于验证横向滚动的长名称客商${index}`, closingBalance: 123, billedUncollectedAmount: 56, salesmanName: '业务员', plannedDate: '2026-10-10', method: 'phone', actualAmount: 12, planStatus: 'partial', planId: `plan-${index}` }))), stats: { byStatus: {}, totalBalance: 1230 } }
    else if (url.pathname.endsWith('/data/reclassify/subject/preview')) {
      if (scenario.preview === 'pending') await new Promise((done) => setTimeout(done, 2000))
      if (scenario.preview === 'error') { code = 1; message = '模拟预览失败' }
      else data = { affectedRows: 12, sourceTotal: 100, targetTotal: 80, decreaseAmount: 5, increaseAmount: 8, netChange: 3 }
    } else if (url.pathname.endsWith('/data/reclassify/subject')) data = { affectedRows: 12, decreaseAmount: 5, increaseAmount: 8, netChange: 3, mergedRows: 2, createdRows: 1 }
    else if (url.pathname.endsWith('/auth/me')) data = auth.state.user
    else if (url.pathname.includes('/auth/refresh')) data = { accessToken: 'mock-layout-token' }
    else if (/subjects|metrics|imports|salesmen|reports|roles|users/.test(url.pathname)) data = paged([])
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code, data, message }) })
  })
}

async function checkTable(page, title) {
  await page.locator('[data-table-scroll]').first().waitFor()
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
  await page.waitForTimeout(350)
  const result = await page.evaluate(() => {
    const main = document.querySelector('main')
    const table = document.querySelector('[data-table-scroll]')
    const heading = document.querySelector('h1')
    const rect = table.getBoundingClientRect()
    const head = heading.getBoundingClientRect()
    const th = table.querySelector('thead').getBoundingClientRect()
    const pager = [...main.querySelectorAll('button')].find((button) => button.textContent.trim() === '下一页').getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, height: rect.height, titleBottom: head.bottom, headerTop: th.top, pagerBottom: pager.bottom, viewportHeight: innerHeight, horizontalOverflow: table.scrollWidth > table.clientWidth, mainOverflow: main.scrollHeight - main.clientHeight }
  })
  assert(result.height > 40, `${title}：表格高度不足 ${JSON.stringify(result)}`)
  assert(result.top >= result.titleBottom, `${title}：表格覆盖标题`)
  assert(result.headerTop >= result.top - 1, `${title}：表头越界`)
  assert(result.pagerBottom <= result.viewportHeight, `${title}：分页超出窗口 ${JSON.stringify(result)}`)
  assert(result.mainOverflow <= 2, `${title}：出现竞争的页面滚动条 ${JSON.stringify(result)}`)
  const topBefore = result.top
  await page.locator('[data-table-scroll]').first().evaluate((element) => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth })
  const after = await page.locator('[data-table-scroll]').first().evaluate((element) => ({ top: element.getBoundingClientRect().top, headerTop: element.querySelector('thead').getBoundingClientRect().top }))
  assert(Math.abs(after.top - topBefore) <= 1, `${title}：滚动改变表格位置`)
  assert(after.headerTop >= after.top - 1, `${title}：滚动后表头越界`)
  return result
}

async function checkDialog(page, name, screenshot) {
  const dialog = page.locator('[data-dialog-content]').last()
  await dialog.waitFor()
  await page.waitForTimeout(350)
  const geometry = () => dialog.evaluate((element) => {
    const body = element.querySelector('[data-dialog-body]')
    const heading = element.querySelector('h2').getBoundingClientRect()
    const buttons = [...element.querySelectorAll('button')].filter((button) => !body.contains(button) && button.getBoundingClientRect().height > 0).map((button) => ({ text: button.textContent.trim(), top: button.getBoundingClientRect().top, bottom: button.getBoundingClientRect().bottom }))
    return { top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, titleTop: heading.top, titleBottom: heading.bottom, bodyHeight: body.clientHeight, bodyOverflow: body.scrollHeight - body.clientHeight, buttons, viewportHeight: innerHeight }
  })
  const before = await geometry()
  assert(await dialog.locator('textarea').evaluateAll((elements) => elements.every((element) => getComputedStyle(element).resize === 'none')), `${name}：文本域仍可拖拽改变布局`)
  assert(before.top >= 0 && before.bottom <= before.viewportHeight, `${name}：弹窗超出窗口 ${JSON.stringify(before)}`)
  assert(before.buttons.length, `${name}：缺少固定操作按钮`)
  await dialog.locator('[data-dialog-body]').evaluate((element) => { element.scrollTop = element.scrollHeight })
  const after = await geometry()
  assert(Math.abs(after.titleTop - before.titleTop) <= 1, `${name}：标题随正文滚动`)
  assert.deepEqual(after.buttons.map((button) => button.text), before.buttons.map((button) => button.text), `${name}：按钮内容变化`)
  assert(after.buttons.every((button, index) => Math.abs(button.top - before.buttons[index].top) <= 1 && Math.abs(button.bottom - before.buttons[index].bottom) <= 1), `${name}：按钮随正文滚动`)
  await page.screenshot({ path: resolve(output, screenshot) })
  return before
}

async function closeDialogWithKeyboard(page) {
  // 下拉控件有自己的 Escape 行为；先把焦点放到弹窗关闭按钮，验证模态层关闭。
  await page.locator('[data-dialog-content]').getByRole('button', { name: /^关\s*闭$/ }).focus()
  await page.keyboard.press('Escape')
  await page.locator('[data-dialog-content]').waitFor({ state: 'hidden' })
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 600 }, { width: 800, height: 450 }, { width: 390, height: 600 }]) {
    const context = await browser.newContext({ viewport })
    const scenario = { preview: 'success' }
    await installMock(context, scenario)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const size = `${viewport.width}x${viewport.height}`
    for (const [route, title] of [
      ['/data/reclassify', '单体重分类'], ['/data/reclassify/consolidation', '汇总重分类'],
      ['/transactions/collections/plans', '催收计划'], ['/transactions/collections/salesmen', '业务员管理'],
    ]) {
      await page.goto(base + route)
      await page.waitForTimeout(500)
      await page.screenshot({ path: resolve(output, `${route.split('/').at(-1)}-${size}-initial.png`) })
      const table = await checkTable(page, title)
      await page.screenshot({ path: resolve(output, `${route.split('/').at(-1)}-${size}.png`) })
      report.push({ size, route, table })
    }
    await page.goto(base + '/data/reclassify')
    await page.getByRole('button', { name: '科目调整', exact: true }).click()
    report.push({ size, dialog: '科目调整', geometry: await checkDialog(page, '科目调整', `subject-dialog-${size}.png`) })
    await closeDialogWithKeyboard(page)
    await page.getByRole('button', { name: '预算调整', exact: true }).click()
    report.push({ size, dialog: '预算调整', geometry: await checkDialog(page, '预算调整', `budget-dialog-${size}.png`) })
    await closeDialogWithKeyboard(page)
    await page.getByRole('button', { name: '跨公司调整', exact: true }).click()
    report.push({ size, dialog: '跨公司调整', geometry: await checkDialog(page, '跨公司调整', `company-dialog-${size}.png`) })
    await closeDialogWithKeyboard(page)
    await page.getByRole('button', { name: '查看调整明细', exact: true }).first().click()
    report.push({ size, dialog: '只读详情', geometry: await checkDialog(page, '只读详情', `readonly-dialog-${size}.png`) })
    await closeDialogWithKeyboard(page)
    await page.getByRole('button', { name: '重新应用', exact: true }).first().click()
    report.push({ size, dialog: '重新应用', geometry: await checkDialog(page, '重新应用', `reapply-dialog-${size}.png`) })
    if (viewport.width === 800) {
      scenario.preview = 'pending'
      await page.getByRole('button', { name: '预览影响', exact: true }).click()
      await page.getByRole('button', { name: '预览中...', exact: true }).waitFor()
      report.push({ size, dialog: '预览加载中', geometry: await checkDialog(page, '预览加载中', `pending-dialog-${size}.png`) })
      await page.getByRole('button', { name: '预览影响', exact: true }).waitFor()
      report.push({ size, dialog: '预览完成', geometry: await checkDialog(page, '预览完成', `preview-dialog-${size}.png`) })
      scenario.preview = 'error'
      await page.getByRole('button', { name: '预览影响', exact: true }).click()
      await page.getByText('模拟预览失败', { exact: true }).waitFor()
      report.push({ size, dialog: '预览错误', geometry: await checkDialog(page, '预览错误', `error-dialog-${size}.png`) })
    }
    assert.deepEqual(errors, [], `${size}：浏览器运行错误`)
    await context.close()
    console.log(`已通过 ${size}：4 个表格页面与新建、只读、重新应用弹窗`)
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
