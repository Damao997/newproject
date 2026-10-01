#!/usr/bin/env node
/**
 * 生产构建一键脚本（替代手工两步，防遗漏）：
 *   1. 注入 VITE_API_BASE_URL 后执行 npm run build（tsc -b && vite build）
 *   2. 构建后向 dist/index.html 注入/更新 <meta name="app-version">（口径同 deploy-zjyph.ps1）
 *
 * 用法：npm run build:prod [-- --api /api/v1]
 * API 地址优先级：--api 参数 > 环境变量 VITE_API_BASE_URL > 同源 /api/v1。
 * 生产构建必须位于正式 tag；本地演练可显式设置 ALLOW_UNTAGGED_BUILD=1。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const apiIdx = args.indexOf('--api')
const API_BASE =
  (apiIdx > -1 ? args[apiIdx + 1] : undefined) ||
  process.env.VITE_API_BASE_URL ||
  '/api/v1'

if (apiIdx > -1 && !args[apiIdx + 1]) {
  console.error('[build:prod] --api 缺少地址')
  process.exit(1)
}

const describe = spawnSync('git', ['describe', '--tags', '--exact-match'], { encoding: 'utf8' })
const tag = (describe.stdout || '').trim()
const allowUntagged = process.env.ALLOW_UNTAGGED_BUILD === '1'
if (!/^v\d{4}\.\d{2}\.\d+$/.test(tag) && !allowUntagged) {
  console.error('[build:prod] 当前提交不是正式发布 tag；请先完成 PR、发布说明和打 tag')
  process.exit(1)
}

const version = tag || 'dev'
const projectRoot = process.cwd()
const outDir = path.resolve(projectRoot, process.env.BUILD_OUT_DIR || 'dist')
const relativeOutDir = path.relative(projectRoot, outDir)
if (!relativeOutDir || relativeOutDir.startsWith('..') || path.isAbsolute(relativeOutDir)) {
  console.error('[build:prod] BUILD_OUT_DIR 必须是 web 目录内的子目录')
  process.exit(1)
}

console.log(`[build:prod] API base = ${API_BASE}; version = ${version}; outDir = ${relativeOutDir}`)

// 1. 构建
const npmCli = process.env.npm_execpath
if (!npmCli) {
  console.error('[build:prod] 请通过 npm run build:prod 调用本脚本')
  process.exit(1)
}
const build = spawnSync(process.execPath, [npmCli, 'run', 'build', '--', '--outDir', outDir], {
  stdio: 'inherit',
  env: { ...process.env, VITE_API_BASE_URL: API_BASE },
})
if (build.status !== 0) {
  console.error('[build:prod] 构建失败')
  process.exit(build.status ?? 1)
}

// 2. 注入/更新 meta app-version（与 deploy-zjyph.ps1 同逻辑）
const indexPath = path.join(outDir, 'index.html')
let html = readFileSync(indexPath, 'utf8')
if (/name="app-version"\s+content="([^"]*)"/i.test(html)) {
  html = html.replace(/name="app-version"\s+content="[^"]*"/i, `name="app-version" content="${version}"`)
} else if (/<head>/i.test(html)) {
  html = html.replace(/<head>/i, `<head>\n  <meta name="app-version" content="${version}">`)
} else {
  console.error('[build:prod] 注入失败：未找到 <head> 标签')
  process.exit(1)
}
writeFileSync(indexPath, html)
console.log(`[build:prod] 版本标识已注入：${version}`)
