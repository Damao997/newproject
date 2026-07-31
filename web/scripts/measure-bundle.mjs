// 度量首屏实际加载体积：解析 dist/index.html 的 entry + modulepreload
// 用法：node scripts/measure-bundle.mjs
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const DIST = 'dist'
const html = readFileSync(join(DIST, 'index.html'), 'utf8')

const refs = [...html.matchAll(/(?:src|href)="\/([^"]+\.(?:js|css))"/g)].map((m) => m[1])
const unique = [...new Set(refs)]

let totalRaw = 0
let totalGz = 0
console.log('首屏加载文件（index.html 直接引用 + modulepreload）：')
for (const r of unique) {
  const p = join(DIST, r)
  const buf = readFileSync(p)
  const gz = gzipSync(buf).length
  totalRaw += buf.length
  totalGz += gz
  console.log(`  ${r.padEnd(46)} ${(buf.length / 1024).toFixed(1).padStart(8)} kB  gzip ${(gz / 1024).toFixed(1).padStart(7)} kB`)
}
console.log(
  `\n首屏合计: ${(totalRaw / 1024).toFixed(1)} kB  gzip ${(totalGz / 1024).toFixed(1)} kB` +
    `   (设计方案 §7.3 目标 gzip < 150 kB)`,
)

// 按需 chunk（不进首屏，点击导出/进入图表页时才拉取）
const all = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.js'))
const lazy = all.filter((f) => !unique.some((u) => u.endsWith(f)))
const heavy = lazy
  .map((f) => ({ f, size: statSync(join(DIST, 'assets', f)).size }))
  .filter((x) => x.size > 100 * 1024)
  .sort((a, b) => b.size - a.size)

console.log('\n按需加载的大 chunk（不计入首屏）：')
for (const { f, size } of heavy) {
  const gz = gzipSync(readFileSync(join(DIST, 'assets', f))).length
  console.log(`  ${f.padEnd(46)} ${(size / 1024).toFixed(1).padStart(8)} kB  gzip ${(gz / 1024).toFixed(1).padStart(7)} kB`)
}
