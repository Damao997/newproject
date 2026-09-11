// Test the design HTML dimensions
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const DESIGN_BASE = 'http://127.0.0.1:8001/pages'
const SLUG = 'data-reclassify'

async function main() {
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()

  await page.goto(`${DESIGN_BASE}/data-reclassify.html`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)

  // Check body dimensions
  const bodyDims = await page.evaluate(() => {
    const body = document.body
    const html = document.documentElement
    return {
      bodyScrollWidth: body.scrollWidth,
      bodyScrollHeight: body.scrollHeight,
      bodyClientWidth: body.clientWidth,
      bodyClientHeight: body.clientHeight,
      htmlScrollWidth: html.scrollWidth,
      htmlScrollHeight: html.scrollHeight,
    }
  })
  console.log('Design mobile (390x844 viewport):')
  console.log('  body:', bodyDims)

  await page.screenshot({ path: join(AUDIT_DIR, 'design', `${SLUG}-mobile-test.png`), fullPage: true })
  const bytes = (await stat(join(AUDIT_DIR, 'design', `${SLUG}-mobile-test.png`))).size
  console.log(`  bytes: ${bytes} (${(bytes/1024).toFixed(1)} KB)`)

  await browser.close()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
