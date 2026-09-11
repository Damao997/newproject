#!/usr/bin/env node
/**
 * dev-up.mjs — 一键启动本地开发环境
 *
 * 按依赖顺序启动三个服务并等待各自就绪：
 *   1. 数据库   embedded-postgres（用户态，localhost:5432，npm run db:local）
 *   2. 后端     Express + tsx watch（localhost:3001，npm run dev）
 *   3. 前端     Vite dev server（localhost:5173，npm run dev）
 *
 * 特性：
 *   - 跨平台（Windows / macOS / Linux），纯 Node.js 内置模块，无第三方依赖（Node >= 18）
 *   - 启动前校验 server/.env 必需变量与端口占用
 *   - 首次运行（server/.pgdata 不存在）时自动执行 prisma generate + migrate + seed
 *   - 任一服务启动失败或运行中意外退出，自动停止所有已启动服务并退出
 *   - Ctrl+C / SIGTERM 逆序清理（frontend -> backend -> database）
 *
 * 用法（仓库根目录）：
 *   npm run dev:up
 *   或  node scripts/dev-up.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER_DIR = path.join(ROOT, 'server')
const WEB_DIR = path.join(ROOT, 'web')
const ENV_FILE = path.join(SERVER_DIR, '.env')
const PGDATA_DIR = path.join(SERVER_DIR, '.pgdata')

// 输入端口：进程环境变量 > server/.env 的 DB_PORT > 默认 5432。
// 多 worktree 隔离开发库时会在各自 server/.env 中通过 DB_PORT 指定独立端口，
// 因此必须从 .env 读取，避免错误等待默认端口。
const envDbPort = (existsSync(ENV_FILE) && parseEnv(ENV_FILE).DB_PORT) || undefined
const PORTS = {
  db: Number(process.env.DB_PORT ?? envDbPort ?? 5432),
  api: 3001,
  web: 5173,
}

// ── 日志：带颜色前缀 ──────────────────────────────────────
const COLORS = {
  db: '\x1b[32m', // 绿
  api: '\x1b[34m', // 蓝
  web: '\x1b[35m', // 品红
  dev: '\x1b[36m', // 青
  prisma: '\x1b[33m', // 黄
  err: '\x1b[31m', // 红
  reset: '\x1b[0m',
}

function log(tag, msg) {
  const color = COLORS[tag] || COLORS.dev
  console.log(`${color}[${tag}]${COLORS.reset} ${msg}`)
}

// ── 通用工具 ──────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** TCP 探测：目标端口是否可连接 */
function tcpProbe(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = net.connect(port, host)
    sock.setTimeout(1500)
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('error', () => {
      sock.destroy()
      resolve(false)
    })
    sock.once('timeout', () => {
      sock.destroy()
      resolve(false)
    })
  })
}

/** HTTP 探测：目标 URL 是否返回 2xx */
async function httpOk(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 轮询等待就绪。
 * @param {() => Promise<boolean>} fn 就绪判定
 * @param {{timeoutMs: number|(() => number), intervalMs?: number, label: string, abortCheck?: () => string|null}} opts
 *   timeoutMs 可为函数（支持在等待期间动态延长，如首次下载数据库二进制）
 *   abortCheck 返回非空字符串表示进程已提前退出（原因）
 */
async function waitFor(fn, { timeoutMs, intervalMs = 500, label, abortCheck }) {
  const start = Date.now()
  const limit = () => (typeof timeoutMs === 'function' ? timeoutMs() : timeoutMs)
  for (;;) {
    if (abortCheck) {
      const reason = abortCheck()
      if (reason) throw new Error(`${label} 进程提前退出：${reason}`)
    }
    if (await fn()) return Date.now() - start
    if (Date.now() - start >= limit()) {
      throw new Error(`${label} 就绪超时（${Math.round(limit() / 1000)}s）`)
    }
    await sleep(intervalMs)
  }
}

/** 解析 .env 文件（简单 key=value，支持引号包裹与 # 注释） */
function parseEnv(file) {
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || line.trimStart().startsWith('#')) continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[m[1]] = value
  }
  return env
}

// ── 子进程管理 ────────────────────────────────────────────
const children = new Map() // tag -> { proc, exited, exitInfo }
let shuttingDown = false

function spawnOpts(cwd) {
  return {
    cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
}

/**
 * 跨平台 spawn：Windows 下经 shell 解析 npm.cmd（命令拼为单字符串，
 * 避免 Node 24 的 DEP0190 警告：args + shell 组合属不安全拼接）；
 * POSIX 下 detached 以便按进程组清理。
 */
function spawnCross(cmd, args, opts) {
  if (process.platform === 'win32') {
    return spawn([cmd, ...args].join(' '), { ...opts, shell: true })
  }
  return spawn(cmd, args, { ...opts, detached: true })
}

/** 终止整棵进程树（Windows 用 taskkill /T，POSIX 用进程组信号） */
function killTree(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-proc.pid, 'SIGTERM')
    } catch {
      try {
        proc.kill('SIGTERM')
      } catch {
        /* 进程已退出 */
      }
    }
  }
}

/** 启动长驻服务（db / api / web），输出按行转发并带前缀 */
function startService(tag, cmd, args, { cwd, onLine }) {
  const proc = spawnCross(cmd, args, spawnOpts(cwd))
  const child = { proc, exited: false, exitInfo: null }
  children.set(tag, child)

  proc.on('error', (err) => {
    child.exited = true
    child.exitInfo = { error: err.message }
  })
  proc.on('exit', (code, signal) => {
    child.exited = true
    child.exitInfo = { code, signal }
    if (!shuttingDown) {
      log('err', `[${tag}] 进程意外退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}），正在停止所有服务`)
      void shutdown(1)
    }
  })

  for (const stream of [proc.stdout, proc.stderr]) {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (onLine) onLine(line)
      log(tag, line)
    })
  }
  return child
}

/** 运行一次性命令（如 prisma 步骤），透传输出，超时或非 0 退出则 reject */
function runOnce(tag, cmd, args, { cwd, timeoutMs = 300_000 }) {
  return new Promise((resolve, reject) => {
    const proc = spawnCross(cmd, args, spawnOpts(cwd))
    const timer = setTimeout(() => {
      killTree(proc)
      reject(new Error(`${tag} 执行超时（${Math.round(timeoutMs / 1000)}s）`))
    }, timeoutMs)

    for (const stream of [proc.stdout, proc.stderr]) {
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
      rl.on('line', (line) => log(tag, line))
    }
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`${tag} 启动失败：${err.message}`))
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`${tag} 失败（退出码 ${code}），请检查上方日志`))
    })
  })
}

/** 逆序清理所有服务并退出 */
async function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  log('dev', '正在停止所有服务（frontend -> backend -> database）...')
  for (const tag of ['web', 'api', 'db']) {
    const child = children.get(tag)
    if (child && !child.exited) killTree(child.proc)
  }
  await sleep(2000) // 等待优雅停机（数据库 pg.stop()）
  process.exit(code)
}

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))

// ── 环境检查 ──────────────────────────────────────────────
function checkEnv() {
  if (!existsSync(ENV_FILE)) {
    throw new Error(
      `未找到 ${ENV_FILE}\n请先执行：cd server && cp .env.example .env（Windows: copy .env.example .env），并配置 JWT 密钥。`
    )
  }
  if (!existsSync(path.join(SERVER_DIR, 'node_modules'))) {
    throw new Error('server/node_modules 不存在，请先执行：cd server && npm install')
  }
  if (!existsSync(path.join(WEB_DIR, 'node_modules'))) {
    throw new Error('web/node_modules 不存在，请先执行：cd web && npm install')
  }

  const env = parseEnv(ENV_FILE)
  const missing = []
  if (!env.DATABASE_URL) missing.push('DATABASE_URL')
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) missing.push('JWT_SECRET（>=32 字符）')
  if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 32) {
    missing.push('JWT_REFRESH_SECRET（>=32 字符）')
  }
  if (missing.length > 0) {
    throw new Error(`server/.env 配置不完整：缺少 ${missing.join('、')}，后端将拒绝启动。`)
  }
  if (!env.DEEPSEEK_API_KEY) {
    log('dev', '提示：未配置 DEEPSEEK_API_KEY，AI 功能不可用（不影响其他功能）')
  }
  return env
}

// ── 主流程 ────────────────────────────────────────────────
async function main() {
  log('dev', '===== 一键启动本地开发环境 =====')

  // 1. 环境检查
  log('dev', '环境检查 ...')
  checkEnv()
  log('dev', '环境检查通过（.env / DATABASE_URL / JWT 密钥 / node_modules）')

  // 2. 端口预检
  for (const [name, port] of Object.entries(PORTS)) {
    if (await tcpProbe(port)) {
      throw new Error(`端口 ${port}（${name}）已被占用，可能已有实例在运行，请先停止占用进程`)
    }
  }
  log('dev', `端口预检通过（${PORTS.db} / ${PORTS.api} / ${PORTS.web} 均空闲）`)

  // 3. 启动数据库
  log('dev', '启动数据库：npm run db:local ...')
  const dbWait = { timeoutMs: 180_000 }
  const db = startService('db', 'npm', ['run', 'db:local'], {
    cwd: SERVER_DIR,
    onLine: (line) => {
      if (line.includes('初始化数据目录') && dbWait.timeoutMs < 600_000) {
        dbWait.timeoutMs = 600_000
        log('dev', '首次运行：数据库正在初始化（可能需下载二进制），最长等待 10 分钟 ...')
      }
    },
  })
  const dbMs = await waitFor(() => tcpProbe(PORTS.db), {
    timeoutMs: () => dbWait.timeoutMs,
    label: '数据库',
    abortCheck: () => (db.exited ? `退出码 ${db.exitInfo?.code ?? db.exitInfo?.error ?? '?'}` : null),
  })
  log('dev', `数据库就绪：localhost:${PORTS.db}（${(dbMs / 1000).toFixed(1)}s）`)

  // 4. 首次运行自动初始化（.pgdata 不存在时）
  if (!existsSync(path.join(PGDATA_DIR, 'PG_VERSION'))) {
    log('dev', '检测到全新数据目录（首次使用），自动执行 prisma generate / migrate / seed ...')
    await runOnce('prisma:generate', 'npm', ['run', 'prisma:generate'], { cwd: SERVER_DIR })
    await runOnce('prisma:migrate', 'npm', ['run', 'prisma:migrate'], { cwd: SERVER_DIR })
    await runOnce('prisma:seed', 'npm', ['run', 'prisma:seed'], { cwd: SERVER_DIR })
    log('dev', '数据库初始化完成（generate + migrate + seed）')
  }

  // 5. 启动后端
  log('dev', '启动后端：npm run dev ...')
  const api = startService('api', 'npm', ['run', 'dev'], { cwd: SERVER_DIR })
  const apiMs = await waitFor(() => httpOk(`http://127.0.0.1:${PORTS.api}/health`), {
    timeoutMs: 90_000,
    label: '后端',
    abortCheck: () =>
      api.exited ? `退出码 ${api.exitInfo?.code ?? api.exitInfo?.error ?? '?'}` : null,
  })
  log('dev', `后端就绪：http://localhost:${PORTS.api}（${(apiMs / 1000).toFixed(1)}s）`)

  // 6. 启动前端
  log('dev', '启动前端：npm run dev ...')
  const web = startService('web', 'npm', ['run', 'dev'], { cwd: WEB_DIR })
  const webMs = await waitFor(() => httpOk(`http://127.0.0.1:${PORTS.web}/`), {
    timeoutMs: 90_000,
    label: '前端',
    abortCheck: () =>
      web.exited ? `退出码 ${web.exitInfo?.code ?? web.exitInfo?.error ?? '?'}` : null,
  })
  log('dev', `前端就绪：http://localhost:${PORTS.web}（${(webMs / 1000).toFixed(1)}s）`)

  // 7. 保持运行
  log('dev', '===== 全部服务已启动 =====')
  log('dev', `  前端   http://localhost:${PORTS.web}`)
  log('dev', `  后端   http://localhost:${PORTS.api}`)
  log('dev', `  数据库 localhost:${PORTS.db}`)
  log('dev', '按 Ctrl+C 停止所有服务')
}

main().catch((err) => {
  log('err', err.message || String(err))
  return shutdown(1)
})
