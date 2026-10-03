// 所有请求使用模拟接口，不连接业务库；保存失败、部分失败和重新应用请求在此核对。
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { auth, resolveBrowserFixture, configureBrowserFixture } from './redesign-fixtures.mjs'
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const output = new URL('../audit/saas-forms/browser/', import.meta.url)
await mkdir(output, { recursive: true })
const evidence = []
const ok = (data) => ({ code: 0, data, message: '模拟成功', traceId: 'saas-test' })
try {
  for (const theme of ['light', 'gradient', 'dark', 'antd']) {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 700 : 900 }, reducedMotion: 'reduce' })
      configureBrowserFixture(context, { theme, revision: 1 })
      await context.addInitScript(({ auth, theme }) => {
        localStorage.setItem('auth-storage', JSON.stringify(auth))
        localStorage.setItem('last-seen-version', '999.0.0')
        localStorage.setItem('sidebar-style-storage', JSON.stringify({ state: { sidebarStyle: theme }, version: 0 }))
      }, { auth, theme })
      const writes = [], errors = []
      let failSecondSummary = true, failTransactionSecond = true, normalUploaded = false
      const normalBatch = { id: 'test-normal', filename: '模拟经营数据.xlsx', templateType: 'operating', status: 'draft', successCount: 1, errorCount: 0, detailCount: 1, rowCount: 1, errors: [], createdBy: 'test', createdAt: '2026-10-03T00:00:00Z' }
      await context.route('**/api/v1/**', async (route) => {
        const request = route.request(), url = new URL(request.url()), method = request.method()
        let data = resolveBrowserFixture(route)

        if (method === 'GET' && url.pathname.endsWith('/data/reclassify/logs')) data.data.total = 20
        if (method === 'GET' && url.pathname.endsWith('/data/imports') && normalUploaded) data = ok({ items: [normalBatch], total: 1, page: 1, pageSize: 50 })
        if (method === 'GET' && url.pathname.endsWith('/data/imports/test-normal')) data = ok(normalBatch)
        if (method !== 'GET') {
          const payload = request.headers()['content-type']?.includes('multipart/form-data') ? { multipart: true } : request.postDataJSON(); writes.push({ path: url.pathname, payload })
          if (url.pathname.endsWith('/company/preview')) data = ok({ affectedRows: 4, totalValue: 100, transferValue: 25, conflictRows: 0, createRows: 4 })
          else if (/logs\/[^/]+\/reapply\/company$/.test(url.pathname)) data = ok({ affectedRows: 4, transferValue: 25 })

          else if (url.pathname.endsWith('/data/imports/preview')) data = ok({ dataRowCount: 1, errorCount: 0, operatingCount: 1, staticCount: 0, budgetCount: 0, errors: [], sampleRows: { headers: ['公司', '期间'], rows: [['模拟公司', '2026-09']] } })
          else if (url.pathname.endsWith('/data/imports/batch-activate-check')) data = ok({ results: payload.ids.map((id) => ({ id, conflicts: [], crossBatchConflictCount: 0 })) })
          else if (/\/data\/imports\/[^/]+\/activate$/.test(url.pathname)) {
            if (url.pathname.includes('test-transaction-2') && failTransactionSecond) data = { code: 1, data: null, message: '模拟第二批激活失败' }
            else { data = ok(null); if (url.pathname.includes('test-normal')) normalBatch.status = 'active' }
          }
          else if (url.pathname.endsWith('/data/imports')) { normalUploaded = true; data = ok(normalBatch) }
          else if (url.pathname.endsWith('/transactions/import/preview')) data = ok(['模拟往来甲.xlsx', '模拟往来乙.xlsx'].map((filename) => ({
            filename, sheets: [], dataRowCount: 1, recordCount: 1, errorCount: 0, warningCount: 0, errors: [], warnings: [],
            summary: { companies: ['模拟公司'], periods: ['2026-09'], counterpartyCount: 1, totalClosingBalance: 100, internalCount: 0, duplicateCount: 0 },
            activationImpact: { newKeys: [], overlappingKeys: [] },
          })))
          else if (url.pathname.endsWith('/transactions/import')) data = ok([1, 2].map((index) => ({ filename: index === 1 ? '模拟往来甲.xlsx' : '模拟往来乙.xlsx', error: null, batch: { ...normalBatch, id: 'test-transaction-' + index, templateType: 'transaction' } })))
          else if (url.pathname.endsWith('/common-summaries')) data = ok({ summaries: [{ code: 'ET0001', name: '汇总甲（模拟）' }, { code: 'ET0002', name: '汇总乙（模拟）' }] })
          else if (url.pathname.endsWith('/consolidation/adjustments')) {
            data = payload.summaryCompanyCode === 'ET0002' && failSecondSummary
              ? { code: 1, data: null, message: '模拟乙写入失败', traceId: 'saas-test' } : ok({ id: 'test-adjustment' })
          } else if (url.pathname.endsWith('/reports')) {
            await new Promise((done) => setTimeout(done, 120))
            data = { code: 1, data: null, message: '模拟保存失败，请重试', traceId: 'saas-test' }
          }
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      })
      const page = await context.newPage()
      page.on('pageerror', (error) => errors.push(error.message))
      const choose = async (label, option) => { await page.getByRole('combobox', { name: label }).press('ArrowDown'); const item = page.getByRole('option', { name: option }); await item.click(); await item.waitFor({ state: 'hidden' }) }
      const geometry = async (selector, drawer = false) => {
        await page.waitForFunction((selector) => { const element = document.querySelector(selector); if (!element) return false; const box = element.getBoundingClientRect(); return box.left >= -1 && box.right <= innerWidth + 1 }, selector)
        const value = await page.locator(selector).evaluate((element) => {
          const box = element.getBoundingClientRect(), footer = element.querySelector('[data-dialog-content] > div:last-child')?.getBoundingClientRect()
          return { left: box.left, right: box.right, width: box.width, bottom: box.bottom, footerBottom: footer?.bottom, windowWidth: innerWidth, windowHeight: innerHeight }
        })
        assert.ok(value.left >= -1 && value.right <= width + 1, JSON.stringify(value))
        if (value.footerBottom !== undefined) assert.ok(value.footerBottom <= value.windowHeight + 1, JSON.stringify(value))
        if (drawer) assert.ok(Math.abs(value.width - (width < 768 ? width : 480)) <= 1, JSON.stringify(value))
        return value
      }
      await page.goto('http://127.0.0.1:5177/admin/users')
      await page.getByRole('button', { name: '新增用户', exact: true }).click()
      await page.getByRole('dialog', { name: '新增用户' }).waitFor()
      const userGeometry = await geometry('[role=dialog]', true)
      await page.getByRole('button', { name: '保存用户' }).click()
      assert.equal(await page.getByLabel(/^用户名/).evaluate((element) => element === document.activeElement), true)
      await page.getByLabel(/^用户名/).fill('模拟长账号')
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
      await page.getByRole('button', { name: '继续编辑', exact: true }).click()
      assert.equal(await page.getByLabel(/^用户名/).inputValue(), '模拟长账号')
      await page.screenshot({ path: fileURLToPath(new URL(theme + '-' + width + '-user.png', output)) })
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
      await page.getByRole('button', { name: '放弃修改', exact: true }).click()
      await page.goto('http://127.0.0.1:5177/reports')
      await page.getByRole('button', { name: '新建报告', exact: true }).click()
      await page.getByLabel(/^报告标题/).fill('模拟 · 保存失败仍保留的报告')
      await page.getByRole('button', { name: /^报告期间/ }).click()
      await page.getByRole('button', { name: '最新期间', exact: true }).click()
      await choose(/^报告主体/, /杭州分公司/)
      const reportButton = page.getByRole('button', { name: '创建报告', exact: true })
      const idleBox = await reportButton.boundingBox()
      await reportButton.click()
      const busyBox = await reportButton.boundingBox()
      assert.ok(Math.abs(idleBox.width - busyBox.width) <= 1, '提交期间按钮尺寸应稳定')
      await page.getByText('模拟保存失败，请重试', { exact: true }).waitFor()
      assert.equal(await page.getByLabel(/^报告标题/).inputValue(), '模拟 · 保存失败仍保留的报告')
      await geometry('[role=dialog]', true)
      if (width === 390) {
        await page.getByRole('textbox', { name: /^报告标题/ }).click()
        await page.evaluate(() => { Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 420 }); window.visualViewport.dispatchEvent(new Event('resize')) })
        await page.waitForFunction(() => document.querySelector('[data-form-actions]')?.getBoundingClientRect().bottom <= 421)
        await page.screenshot({ path: fileURLToPath(new URL(theme + '-keyboard.png', output)) })
        await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')) })
      }
      await page.screenshot({ path: fileURLToPath(new URL(theme + '-' + width + '-report.png', output)) })
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
      await page.getByRole('button', { name: '放弃修改', exact: true }).click()
      if (theme === 'light' && width === 1440) {
        await page.goto('http://127.0.0.1:5177/data/reclassify')
        await choose('重分类类型筛选', '跨公司')
        await page.getByRole('button', { name: '下一页', exact: true }).click()
        await page.getByRole('button', { name: '跨公司调整', exact: true }).click()
        await page.getByRole('button', { name: '返回', exact: true }).click()
        assert.equal(await page.getByRole('button', { name: '2', exact: true }).getAttribute('aria-current'), 'page')
        assert.ok(await page.getByRole('combobox', { name: '重分类类型筛选' }).evaluate((element) => element.closest('.ant-select').textContent.includes('跨公司')), '返回列表保留类型与分页')
      }
      await page.goto('http://127.0.0.1:5177/data/reclassify/new?kind=company&log=log-1')
      await page.getByRole('heading', { name: '重新应用跨公司重分类' }).waitFor()
      await choose('转移方式', '按比例部分转移')
      await page.getByLabel('转移比例（%）').fill('25')
      await page.getByRole('button', { name: '预览影响', exact: true }).click()
      await page.getByRole('button', { name: '返回修改', exact: true }).waitFor()
      assert.equal(writes.filter((item) => item.path.endsWith('/company/preview')).at(-1).payload.ratio, 0.25)
      await page.getByRole('button', { name: '返回修改', exact: true }).click()
      await page.getByLabel('转移比例（%）').fill('30')
      assert.equal(await page.getByRole('button', { name: '重新应用', exact: true }).isEnabled(), false)
      await page.getByRole('button', { name: '预览影响', exact: true }).click()
      await page.getByRole('button', { name: '重新应用', exact: true }).click()
      await page.getByRole('button', { name: '确认重新应用', exact: true }).click()
      await page.getByText(/重新应用完成/).waitFor()
      const reapply = writes.find((item) => item.path.endsWith('/logs/log-1/reapply/company'))
      assert.ok(reapply, '重新应用必须沿用原日志标识'); assert.equal(reapply.payload.ratio, 0.3)
      await page.screenshot({ path: fileURLToPath(new URL(theme + '-' + width + '-reclassify.png', output)) })
      if (theme === 'light' && width === 1440) {
        await page.goto('http://127.0.0.1:5177/data/reclassify/consolidation/new')
        await choose('单体公司 A', /杭州分公司/)
        await choose('单体公司 B', /宁波分公司/)
        await page.getByRole('button', { name: /匹配/ }).click()
        await page.getByText('汇总甲（模拟）', { exact: true }).waitFor()
        await page.getByLabel(/^调整期间/).click()
        await page.getByRole('button', { name: '最新期间', exact: true }).click()
        await page.getByLabel(/^抵消金额/).fill('-5')
        await page.getByRole('button', { name: '选择要抵消的科目', exact: true }).click()
        await page.getByRole('button', { name: /PL0201/ }).click()
        await page.getByLabel(/^调整原因/).fill('模拟内部交易抵消')
        await page.getByRole('button', { name: '核对影响', exact: true }).click()
        await page.getByRole('button', { name: '执行抵消调整', exact: true }).click()
        await page.getByRole('button', { name: '确认调整', exact: true }).click()
        await page.getByText(/部分汇总主体创建失败/).waitFor()
        failSecondSummary = false
        await page.getByRole('button', { name: '核对影响', exact: true }).click()
        await page.getByRole('button', { name: '执行抵消调整', exact: true }).click()
        await page.getByRole('button', { name: '确认调整', exact: true }).click()
        await page.getByText(/抵消调整已生效/).waitFor()
        const adjustments = writes.filter((item) => item.path.endsWith('/consolidation/adjustments')).map((item) => item.payload.summaryCompanyCode)
        assert.deepEqual(adjustments, ['ET0001', 'ET0002', 'ET0002'], '重试只能处理失败主体')
        await page.screenshot({ path: fileURLToPath(new URL('consolidation-retry.png', output)) })
      }

      if (theme === 'light') {
        const file = (name) => ({ name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('仅用于界面状态验证；所有接口均拦截模拟') })
        await page.goto('http://127.0.0.1:5177/data/import/new')
        await page.locator('input[type=file]').first().setInputFiles(file('模拟经营数据.xlsx'))
        await page.getByRole('button', { name: '预览校验', exact: true }).click()
        await page.getByText('核对结果（未导入）', { exact: true }).waitFor()
        await choose('数值单位', '万元')
        assert.equal(await page.getByText('核对结果（未导入）', { exact: true }).count(), 0)
        await page.getByRole('button', { name: '确认导入', exact: true }).click()
        await page.getByText(/导入成功：/).waitFor()
        assert.equal(writes.filter((item) => item.path.endsWith('/test-normal/activate')).length, 0, '导入不能自动激活')
        await page.getByRole('button', { name: '立即激活该批次', exact: true }).click()
        await page.getByText('该批次已激活生效，数据已合并应用于看板与指标。', { exact: true }).waitFor()
        await page.screenshot({ path: fileURLToPath(new URL('import-' + width + '.png', output)) })
        await page.goto('http://127.0.0.1:5177/data/import/new?kind=transaction')
        await page.locator('input[type=file]').first().setInputFiles([file('模拟往来甲.xlsx'), file('模拟往来乙.xlsx')])
        await page.getByRole('button', { name: '解析预览', exact: true }).click()
        await page.getByRole('button', { name: '返回修改', exact: true }).waitFor()
        await page.getByRole('button', { name: '确认导入', exact: true }).click()
        await page.getByRole('button', { name: /^完\s*成$/ }).waitFor()
        assert.equal(writes.filter((item) => /test-transaction.*activate$/.test(item.path)).length, 0)
        await page.getByRole('button', { name: /^全部激活/ }).click()
        await page.getByText(/激活完成：成功 1 个，失败 1 个/).waitFor()
        failTransactionSecond = false
        await page.getByRole('button', { name: /^全部激活/ }).click()
        await page.getByText('完成：成功 1 个，失败 0 个', { exact: true }).waitFor()
        assert.deepEqual(writes.filter((item) => /test-transaction.*activate$/.test(item.path)).map((item) => item.path.split('/').at(-2)), ['test-transaction-1', 'test-transaction-2', 'test-transaction-2'])
        await page.screenshot({ path: fileURLToPath(new URL('transaction-import-' + width + '.png', output)) })
      }
      assert.deepEqual(errors, [])
      evidence.push({ theme, width, userGeometry, requests: writes, errors })
      await context.close()
    }
  }
  await writeFile(new URL('results.json', output), JSON.stringify(evidence, null, 2))
  console.log('通过：四主题×桌面/手机，共 8 组；首错聚焦、未保存关闭、保存失败、比例转换、预览失效、原日志重新应用、汇总失败项重试及普通/往来导入独立激活。')
} finally { await browser.close() }
