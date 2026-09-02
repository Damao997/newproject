// 仅截一张 data-dimensions-operating 设计稿作为基准（design 端，无 auth / 无 mock）
import { chromium } from 'playwright'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const AUDIT_DIR = join(ROOT, 'audit', 'screenshots')
const DESIGN_BASE = 'http://127.0.0.1:8001/pages'
const SLUG = 'data-dimensions-operating'

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

async function main() {
  await mkdir(join(AUDIT_DIR, 'design'), { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  const url = `${DESIGN_BASE}/data-dimensions.html`
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(400)
    const out = join(AUDIT_DIR, 'design', `${SLUG}-${vp.name}.png`)
    await page.screenshot({ path: out, fullPage: true })
    const bytes = (await stat(out)).size
    console.log(`design ${vp.name}: ${(bytes / 1024).toFixed(1)} KB (${bytes} B)`)
  }
  await browser.close()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
