#!/usr/bin/env node
/**
 * dev-check.mjs —— 开发环境连通性与端口冲突总验证
 *
 * 用法（仓库根目录）：
 *   npm run dev:check
 *
 * 验证内容：
 *   1. 端口占用矩阵（开发三端口 + 生产端口对照）
 *   2. 数据库端口 TCP 可达
 *   3. 后端端口 TCP 可达 + /health 返回 200
 *   4. 前端端口可访问 + 首页为 text/html
 *   5. 前端 → 后端代理链路（/api/v1 经 vite 代理抵达后端，返回 JSON）
 *   6. CORS 白名单（FRONTEND_ORIGIN 是否含当前前端地址）
 *   7. 数据库读写（调用 server 的 dev:db-check）
 *
 * 任一 FAIL 时退出码非 0。端口解析口径与 dev-up.mjs 完全一致（scripts/dev-config.mjs）。
 */
import { spawnSync } from 'node:child_process'
import { REPO_ROOT, portOwner, resolveDevPorts, resolveFrontendOrigin, tcpProbe } from './dev-config.mjs'

/** 生产端口（同机在跑时仅作对照，与开发端口不冲突） */
const PROD_PORTS = { db: 5433, api: 3100, web: 8080 }

const results = []
function record(level, name, detail) {
  results.push({ level, name, detail })
  const tag = level === 'PASS' ? 'PASS' : level === 'FAIL' ? 'FAIL' : level === 'WARN' ? 'WARN' : 'INFO'
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function httpGet(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' })
    return { ok: true, status: res.status, contentType: res.headers.get('content-type') || '' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function describePort(port) {
  const listening = await tcpProbe(port)
  if (!listening) return { listening: false, owner: null }
  return { listening: true, owner: await portOwner(port) }
}

function ownerText(owner) {
  return owner ? `${owner.name}(pid=${owner.pid})` : 'unknown'
}

async function main() {
  const ports = resolveDevPorts(REPO_ROOT)
  const frontendOrigin = resolveFrontendOrigin(REPO_ROOT)

  console.log('===== 开发环境连通性与端口冲突验证 =====')
  console.log(`端口配置：数据库 ${ports.db} / 后端 ${ports.api} / 前端 ${ports.web}\n`)

  // 1. 端口占用矩阵
  console.log('[1/7] 端口占用矩阵')
  for (const [name, port] of [['数据库', ports.db], ['后端', ports.api], ['前端', ports.web]]) {
    const { listening, owner } = await describePort(port)
    if (listening) record('PASS', `开发${name}端口 ${port}`, `监听中：${ownerText(owner)}`)
    else record('FAIL', `开发${name}端口 ${port}`, '未监听（对应服务未启动）')
  }
  for (const [name, port] of [['PG', PROD_PORTS.db], ['后端', PROD_PORTS.api], ['前端', PROD_PORTS.web]]) {
    const { listening, owner } = await describePort(port)
    if (listening) record('INFO', `生产${name}端口 ${port}`, `生产服务占用：${ownerText(owner)}（与开发端口不冲突）`)
    else record('INFO', `生产${name}端口 ${port}`, '空闲（生产未运行）')
  }

  // 2. 数据库端口
  console.log('\n[2/7] 数据库端口连通性')
  record((await tcpProbe(ports.db)) ? 'PASS' : 'FAIL', `数据库 TCP 127.0.0.1:${ports.db}`, '')

  // 3. 后端端口 + /health
  console.log('\n[3/7] 后端端口与健康检查')
  record((await tcpProbe(ports.api)) ? 'PASS' : 'FAIL', `后端 TCP 127.0.0.1:${ports.api}`, '')
  const health = await httpGet(`http://127.0.0.1:${ports.api}/health`)
  record(health.ok && health.status === 200 ? 'PASS' : 'FAIL', `后端 /health`, health.ok ? `HTTP ${health.status}` : health.error)

  // 4. 前端端口
  console.log('\n[4/7] 前端端口与首页')
  const home = await httpGet(`http://127.0.0.1:${ports.web}/`)
  const homeOk = home.ok && home.status === 200 && home.contentType.includes('text/html')
  record(homeOk ? 'PASS' : 'FAIL', `前端 /`, home.ok ? `HTTP ${home.status} ${home.contentType}` : home.error)

  // 5. 前端 → 后端代理链路
  console.log('\n[5/7] 前端 → 后端代理链路（/api/v1 经 vite 代理）')
  const proxied = await httpGet(`http://127.0.0.1:${ports.web}/api/v1/__dev_check__`)
  const proxyOk = proxied.ok && proxied.contentType.includes('application/json')
  record(
    proxyOk ? 'PASS' : 'FAIL',
    `GET /api/v1/__dev_check__（经前端 ${ports.web}）`,
    proxied.ok
      ? `HTTP ${proxied.status} ${proxied.contentType}${proxyOk ? '（已抵达后端）' : '（疑似未走代理，可能是 SPA 回退 HTML）'}`
      : proxied.error,
  )

  // 6. CORS 白名单
  console.log('\n[6/7] CORS 白名单一致性')
  const expected = `http://localhost:${ports.web}`
  const corsOk = frontendOrigin.split(',').map((s) => s.trim()).includes(expected)
  record(corsOk ? 'PASS' : 'WARN', 'FRONTEND_ORIGIN', corsOk ? `含 ${expected}` : `未含 ${expected}（当前 "${frontendOrigin}"，跨域直连时会被拒绝）`)

  // 7. 数据库读写
  console.log('\n[7/7] 数据库读写验证（server/scripts/dev-db-check.ts）')
  const dbCheck = spawnSync('npm', ['run', '--prefix', 'server', 'dev:db-check'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: true,
  })
  record(dbCheck.status === 0 ? 'PASS' : 'FAIL', '数据库读写', `退出码 ${dbCheck.status ?? 'null'}`)

  // 汇总
  const failed = results.filter((r) => r.level === 'FAIL')
  const warned = results.filter((r) => r.level === 'WARN')
  console.log('\n===== 汇总 =====')
  console.log(`PASS ${results.filter((r) => r.level === 'PASS').length} / WARN ${warned.length} / FAIL ${failed.length}`)
  if (failed.length > 0) {
    console.log('未通过项：')
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `：${f.detail}` : ''}`)
  }
  return failed.length === 0 ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[dev-check] 执行异常：', err instanceof Error ? err.message : err)
    process.exit(2)
  },
)