/**
 * ZJYPH 运维面板服务（零 npm 依赖，Node 内置模块）
 *
 * 仅监听 127.0.0.1:3900，与 PM2 / psql 处于同一机器内信任边界。
 * 封包日常运维口令：
 *   - PM2 进程管理（zjyph-postgres / zjyph-backend / zjyph-frontend）
 *   - 巡检 / 冒烟脚本（server/scripts/ops-check-zjyph.ps1、production-smoke-zjyph.ps1）
 *   - 备份脚本（server/scripts/backup-zjyph.ps1：full / verify / cleanup，restore 不进面板）
 *   - 日志尾读与快捷入口
 *   - AI 修复闭环：诊断（流式）→ 结构化动作卡 → 用户确认 → 白名单动作执行
 *
 * 启动：node server.mjs   （推荐经由 start-panel.ps1 拉起）
 */
import http from 'node:http'
import https from 'node:https'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { Readable } from 'node:stream'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'

// ── 1. 常量与路径 ────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE = path.resolve(__dirname, '..')
const LOG_DIR = path.join(WORKSPACE, 'logs')
const BACKUP_DIR = path.join(WORKSPACE, 'backup')
const SCRIPTS_DIR = path.join(WORKSPACE, 'server', 'scripts')
const PUBLIC_DIR = path.join(__dirname, 'public')
const CONFIG_FILE = path.join(__dirname, 'config.json')
const RUNTIME_CONFIG_FILE = path.join(__dirname, 'runtime-config.json')
const CONFIG_BACKUP_DIR = path.join(__dirname, 'config-backups')

const FRP_DIR = path.join(WORKSPACE, 'frp')
const FRPC_EXE = path.join(FRP_DIR, 'frpc.exe')
const FRPC_TOML = path.join(FRP_DIR, 'frpc.toml')
const FRP_LOG_DIR = path.join(FRP_DIR, 'logs')
const FRPC_LOG = path.join(FRP_LOG_DIR, 'frpc.out.log')
const FRP_RUNKEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const FRP_VBS = path.join(FRP_DIR, 'frpc-start.vbs')
const TASKKILL = 'C:\\Windows\\System32\\taskkill.exe'
const REG_EXE = 'C:\\Windows\\System32\\reg.exe'

const DEFAULT_RUNTIME_CONFIG = {
  panel: { port: 3900 },
  services: { postgresPort: 5433, backendPort: 3100, frontendPort: 8080 },
  access: { publicDomain: '', frontendOrigin: '' },
}
function loadRuntimeConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_FILE, 'utf8'))
    return {
      panel: { ...DEFAULT_RUNTIME_CONFIG.panel, ...(raw.panel || {}) },
      services: { ...DEFAULT_RUNTIME_CONFIG.services, ...(raw.services || {}) },
      access: { ...DEFAULT_RUNTIME_CONFIG.access, ...(raw.access || {}) },
    }
  } catch { return structuredClone(DEFAULT_RUNTIME_CONFIG) }
}
const RUNTIME_CONFIG = loadRuntimeConfig()
const PORT = Number(RUNTIME_CONFIG.panel.port) || 3900
const HOST = '127.0.0.1'
const PROCS = ['zjyph-postgres', 'zjyph-backend', 'zjyph-frontend']
const CMD = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

// 重任务互斥锁（巡检/备份等脚本不允许并发）
const busy = new Set()

// ── 2. 工具函数 ──────────────────────────────────────────────
function send(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new Error('JSON 解析失败')) }
    })
    req.on('error', reject)
  })
}

/** spawn 数组参数执行，无 shell 注入面；超时强杀并返回已捕获输出。
 *  输出优先按 UTF-8 解码；含乱码替换符时按 GBK（中文 Windows 控制台编码）重解码。 */
function decodeBuf(buf) {
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try { return new TextDecoder('gbk').decode(buf) } catch { return utf8 }
}

/** 子进程环境：把 node.exe 与全局 npm（pm2 所在）目录前置到 PATH，
 *  保证受限 PATH 环境下 pm2 describe / pm2 jlist 等仍可用；
 *  并合并用户级环境变量兜底（如 ZJYPH_BACKUP_KEY，setx 后旧进程读不到）。 */
const userEnvFallback = {}
async function loadUserEnvFallback() {
  for (const name of ['ZJYPH_BACKUP_KEY']) {
    if (process.env[name]) { userEnvFallback[name] = process.env[name]; continue }
    const r = await runProc('C:\\Windows\\System32\\reg.exe', ['query', 'HKCU\\Environment', '/v', name], 10_000)
    const m = (r.stdout || '').match(new RegExp(`^\\s*${name}\\s+REG_\\S+\\s+(.+)$`, 'm'))
    if (m) userEnvFallback[name] = m[1].trim()
  }
}

function childEnv() {
  const npmDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : ''
  const wins = 'C:\\Windows'
  return {
    ...process.env,
    ...userEnvFallback,
    PATH: [
      path.dirname(process.execPath), npmDir,
      `${wins}\\System32`, wins, `${wins}\\System32\\Wbem`,
      `${wins}\\System32\\WindowsPowerShell\\v1.0`,
      process.env.PATH || '',
    ].filter(Boolean).join(';'),
  }
}

function runProc(file, args, timeout = 300_000, env) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(file, args, { windowsHide: true, env: env || childEnv() })
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e) })
      return
    }
    const outChunks = [], errChunks = []
    let stdout = '', stderr = '', done = false
    const timer = setTimeout(() => {
      if (!done) { child.kill(); stderr += `\n[面板] 执行超时（${timeout / 1000}s），已终止` }
    }, timeout)
    child.stdout.on('data', (d) => { outChunks.push(d) })
    child.stderr.on('data', (d) => { errChunks.push(d) })
    child.on('error', (e) => {
      done = true; clearTimeout(timer)
      resolve({ code: -1, stdout: Buffer.concat(outChunks).toString('utf8'), stderr: Buffer.concat(errChunks).toString('utf8') + String(e) })
    })
    child.on('close', (code) => {
      if (done) return
      done = true; clearTimeout(timer)
      resolve({ code: code ?? -1, stdout: decodeBuf(Buffer.concat(outChunks)), stderr: decodeBuf(Buffer.concat(errChunks)) + (stderr || '') })
    })
  })
}

/** 尾读文件最后 N 行（最多回看 256KB） */
async function tailFile(file, maxLines) {
  let fh
  try { fh = await fsp.open(file, 'r') } catch { return null }
  try {
    const st = await fh.stat()
    if (st.size === 0) return []
    const slice = Math.min(st.size, 256 * 1024)
    const buf = Buffer.alloc(slice)
    await fh.read(buf, 0, slice, st.size - slice)
    let lines = buf.toString('utf8').split(/\r?\n/)
    if (slice < st.size) lines = lines.slice(1) // 丢弃截断的首行
    return lines.filter((l) => l.length).slice(-maxLines)
  } finally { await fh.close() }
}

// ── 3. PM2 helpers（pm2 全局安装为 .cmd，须经 cmd.exe 调用）──
function pm2Candidates() {
  const appData = process.env.APPDATA || ''
  const programFiles = process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  return [
    appData && path.join(appData, 'npm', 'pm2.cmd'),
    path.join(programFiles, 'nodejs', 'pm2.cmd'),
    path.join(programFilesX86, 'nodejs', 'pm2.cmd'),
  ].filter(Boolean)
}

function resolvePm2() {
  const candidates = pm2Candidates()
  return candidates.find((c) => fs.existsSync(c)) || null
}

async function pm2Diagnostics(testCommand = true) {
  const candidates = pm2Candidates()
  const executable = resolvePm2()
  const result = {
    installed: !!executable,
    executable,
    searched: candidates,
    nodePath: process.execPath,
    npmPath: process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null,
    pathIncludesNpm: (childEnv().PATH || '').toLowerCase().split(';').includes((process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : '').toLowerCase()),
    tested: false,
    ok: false,
    error: null,
  }
  if (!executable) {
    result.error = '未找到 pm2.cmd：面板当前用户的全局 npm 目录和 Node.js 目录均不存在 PM2'
    return result
  }
  if (!testCommand) return result
  const r = await runProc(CMD, ['/d', '/c', executable, 'jlist'], 20_000)
  result.tested = true
  result.ok = r.code === 0
  if (!result.ok) result.error = (r.stderr || r.stdout || 'pm2 jlist 执行失败').trim().slice(-500)
  return result
}

function pm2Cmd(argLine) {
  // tokens 只由白名单常量构成（动作名/进程名/数字），无外部输入。
  // pm2.cmd 内部裸调 node，childEnv 已前置 node 与 npm 目录到 PATH。
  const executable = resolvePm2() || 'pm2'
  return runProc(CMD, ['/d', '/c', executable, ...argLine.split(' ')], 60_000)
}

async function pm2List() {
  const { code, stdout, stderr } = await pm2Cmd('jlist')
  if (code !== 0 && !stdout.trim()) {
    return { pm2Available: false, error: (stderr || 'pm2 jlist 失败').slice(0, 300) }
  }
  try {
    const list = JSON.parse(stdout)
    const map = new Map(list.map((p) => [p.name, p]))
    const procs = PROCS.map((name) => {
      const p = map.get(name)
      if (!p) return { name, status: '未托管', restarts: null, uptimeMs: null }
      const env = p.pm2_env || {}
      const status = env.status || 'unknown'
      return {
        name,
        status,
        restarts: env.restart_time ?? null,
        uptimeMs: status === 'online' && env.pm_uptime ? Date.now() - env.pm_uptime : null,
      }
    })
    return { pm2Available: true, procs }
  } catch (e) {
    return { pm2Available: false, error: `pm2 jlist 输出解析失败：${String(e).slice(0, 200)}` }
  }
}

async function pm2Action(proc, action) {
  if (!PROCS.includes(proc)) return { error: `未知进程：${proc}` }
  if (!['restart', 'start', 'stop'].includes(action)) return { error: `未知动作：${action}` }
  const r = await pm2Cmd(`${action} ${proc}`)
  return { ok: r.code === 0, output: (r.stdout + r.stderr).slice(-4000) }
}

// ── 4. 服务健康 / 备份信息 ───────────────────────────────────
async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    return { ok: res.ok, status: res.status }
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.cause?.code || e?.name || e).slice(0, 80) }
  }
}

async function backupInfo() {
  const fullDir = path.join(BACKUP_DIR, 'full')
  let entries
  try { entries = await fsp.readdir(fullDir) } catch { return { latest: null, ageHours: null, count: 0 } }
  const files = []
  for (const name of entries) {
    if (!name.endsWith('.dump.enc')) continue
    try {
      const st = await fsp.stat(path.join(fullDir, name))
      files.push({ name, sizeBytes: st.size, mtimeMs: st.mtimeMs })
    } catch { /* 文件瞬时消失，跳过 */ }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const latest = files[0] || null
  return {
    latest: latest ? { name: latest.name, mtime: new Date(latest.mtimeMs).toISOString() } : null,
    ageHours: latest ? (Date.now() - latest.mtimeMs) / 3600_000 : null,
    count: files.length,
  }
}

async function listBackups() {
  const info = await backupInfo()
  const fullDir = path.join(BACKUP_DIR, 'full')
  let entries
  try { entries = await fsp.readdir(fullDir) } catch { return [] }
  const files = []
  for (const name of entries) {
    if (!name.endsWith('.dump.enc')) continue
    try {
      const st = await fsp.stat(path.join(fullDir, name))
      files.push({ name, sizeMb: +(st.size / 1048576).toFixed(2), mtime: new Date(st.mtimeMs).toISOString() })
    } catch { /* skip */ }
  }
  files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime))
  return files
}

// ── 5. 巡检 / 冒烟 / 备份脚本执行 ────────────────────────────
/** 运行 server/scripts 下的 PS1 脚本。
 *  脚本为无 BOM 的 UTF-8（含中文），PS 5.1 会按 ANSI 误读导致解析错误：
 *  先在同目录生成带 UTF-8 BOM 的临时副本（保证 $PSScriptRoot 语义不变），
 *  以 -File + 数组参数执行，结束后删除临时副本。 */
const PS_BOM = Buffer.from([0xef, 0xbb, 0xbf])
async function runPs1(script, args, timeout = 300_000) {
  const tmpScript = path.join(path.dirname(script), `.ops-panel-${path.basename(script)}`)
  const content = await fsp.readFile(script)
  const data = content.subarray(0, 3).equals(PS_BOM) ? content : Buffer.concat([PS_BOM, content])
  await fsp.writeFile(tmpScript, data)
  try {
    return await runProc(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpScript, ...args], timeout)
  } finally {
    fsp.unlink(tmpScript).catch(() => {})
  }
}

function parseCheckOutput(output) {
  // 匹配 [OK]/[WARN]/[FAIL]/[PASS] 状态行，如 "  [OK] zjyph-backend online（重启次数：3）"
  const items = []
  for (const m of output.matchAll(/\[(OK|WARN|FAIL|PASS)\]\s*(.+)/g)) {
    items.push({ status: m[1], msg: m[2].trim() })
  }
  return items
}

async function runCheck(kind) {
  if (!['ops-check', 'smoke'].includes(kind)) return { error: 'kind 须为 ops-check 或 smoke' }
  const key = `check-${kind}`
  if (busy.has(key)) return { busy: true, error: '同类检查正在执行中，请稍候' }
  busy.add(key)
  try {
    const script = kind === 'ops-check'
      ? path.join(SCRIPTS_DIR, 'ops-check-zjyph.ps1')
      : path.join(SCRIPTS_DIR, 'production-smoke-zjyph.ps1')
    const r = await runPs1(script, ['-ProdDir', WORKSPACE], 300_000)
    const output = (r.stdout + r.stderr).slice(-60_000)
    return { code: r.code, output, items: parseCheckOutput(output) }
  } finally { busy.delete(key) }
}

async function backupRun(action, extraArgs = []) {
  if (action === 'full' && busy.has('backup-full')) return { busy: true, error: '备份正在执行中' }
  if (action === 'full') busy.add('backup-full')
  try {
    const script = path.join(SCRIPTS_DIR, 'backup-zjyph.ps1')
    const r = await runPs1(script, ['-Action', action, ...extraArgs], 300_000)
    return { ok: r.code === 0, code: r.code, output: (r.stdout + r.stderr).slice(-60_000) }
  } finally { if (action === 'full') busy.delete('backup-full') }
}

// ── 5.5 FRP 管理（frpc 内网穿透客户端）────────────────────────
/** frpc 进程列表（PID/启动时间/命令行）；过滤掉 frpc -v 这类短命探测进程 */
async function frpcProcesses() {
  const cmd = `Get-CimInstance Win32_Process -Filter "Name='frpc.exe'" | Select-Object ProcessId, CreationDate, CommandLine | ConvertTo-Json -Compress`
  const r = await runProc(PS, ['-NoProfile', '-Command', cmd], 15_000)
  const out = (r.stdout || '').trim()
  if (out) {
    try {
      const j = JSON.parse(out)
      const list = Array.isArray(j) ? j : [j]
      return list.filter(x => !/\s-v\b/.test(x.CommandLine || ''))
    } catch { /* 转换失败时走 Get-Process 兜底 */ }
  }
  // 某些 Windows 安全策略禁止读取 Win32_Process.CommandLine，但允许读取进程列表。
  const fallback = await runProc(PS, ['-NoProfile', '-Command', "Get-Process -Name frpc -ErrorAction SilentlyContinue | Select-Object Id,StartTime | ConvertTo-Json -Compress"], 15_000)
  const fallbackOut = (fallback.stdout || '').trim()
  if (!fallbackOut) return []
  try {
    const j = JSON.parse(fallbackOut)
    const list = Array.isArray(j) ? j : [j]
    return list.map(x => ({ ProcessId: x.Id, CreationDate: x.StartTime, CommandLine: 'frpc.exe' }))
  } catch { return [] }
}

function parseCimDate(v) {
  if (typeof v !== 'string') return null
  const m = v.match(/\/Date\((-?\d+)/)
  if (m) return +m[1]
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/** frpc 版本（进程内缓存） */
let frpcVersionCache = null
async function frpcVersion() {
  if (frpcVersionCache) return frpcVersionCache
  const r = await runProc(FRPC_EXE, ['-v'], 10_000)
  frpcVersionCache = (r.stdout || '').trim().split(/\r?\n/)[0] || null
  return frpcVersionCache
}

/** 轻量解析 frpc.toml（仅取展示所需字段，token 不回传） */
function parseFrpcConfig() {
  let text = ''
  try { text = fs.readFileSync(FRPC_TOML, 'utf8') } catch { return null }
  const cfg = { serverAddr: null, serverPort: null, tlsEnabled: false, proxies: [] }
  cfg.serverAddr = (text.match(/^serverAddr\s*=\s*"([^"]+)"/m) || [])[1] || null
  cfg.serverPort = +((text.match(/^serverPort\s*=\s*(\d+)/m) || [])[1]) || null
  cfg.tlsEnabled = /^transport\.tls\.enable\s*=\s*true/m.test(text)
  for (const b of text.split(/^\[\[proxies\]\]\s*$/m).slice(1)) {
    const name = (b.match(/^name\s*=\s*"([^"]+)"/m) || [])[1]
    if (!name) continue
    const domLine = (b.match(/^customDomains\s*=\s*\[([^\]]*)\]/m) || [])[1] || ''
    cfg.proxies.push({
      name,
      type: (b.match(/^type\s*=\s*"([^"]+)"/m) || [])[1] || null,
      localIP: (b.match(/^localIP\s*=\s*"([^"]+)"/m) || [])[1] || '127.0.0.1',
      localPort: +((b.match(/^localPort\s*=\s*(\d+)/m) || [])[1]) || null,
      customDomains: [...domLine.matchAll(/"([^"]+)"/g)].map(x => x[1]),
      remotePort: +((b.match(/^remotePort\s*=\s*(\d+)/m) || [])[1]) || null,
    })
  }
  return cfg
}

/** frpc.toml 掩码文本（token 打码） */
function frpcConfigMasked() {
  try {
    return fs.readFileSync(FRPC_TOML, 'utf8').replace(/(auth\.token\s*=\s*")[^"]+(")/, '$1****（已掩码）****$2')
  } catch { return '（frpc.toml 不存在）' }
}

function tcpProbe(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    const done = (ok, error) => { try { sock.destroy() } catch {}; resolve({ ok, error }) }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false, '连接超时'))
    sock.once('error', (e) => done(false, e.code === 'EACCES' ? '本机策略阻止面板主动 TCP 探测' : String(e.code || e.message).slice(0, 80)))
    sock.connect(port, host)
  })
}

/** 自启状态：HKCU Run 键（ONLOGON 计划任务在非管理员下创建会被拒绝，故用 Run 键 + 隐形启动脚本） */
async function frpAutostartStatus() {
  const r = await runProc(REG_EXE, ['query', FRP_RUNKEY, '/v', 'ZJYPH-frpc'], 15_000)
  return r.code === 0
}

async function frpSnapshot(includeLogs = false) {
  const [procs, cfg] = await Promise.all([frpcProcesses(), Promise.resolve(parseFrpcConfig())])
  const tcp = cfg?.serverAddr
    ? await tcpProbe(cfg.serverAddr, cfg.serverPort || 7000)
    : { ok: false, error: '无法解析 FRP 服务器地址' }
  const started = procs[0] ? parseCimDate(procs[0].CreationDate) : null
  const snapshot = {
    installed: fs.existsSync(FRPC_EXE) && fs.existsSync(FRPC_TOML),
    running: procs.length > 0,
    pids: procs.map(x => x.ProcessId),
    uptimeMs: started ? Date.now() - started : null,
    config: cfg,
    tcp,
    health: tcp.ok ? 'connected' : (String(tcp.error || '').includes('本机策略') ? 'probe_blocked' : 'unreachable'),
  }
  if (includeLogs) snapshot.logTail = (await tailFile(FRPC_LOG, 40)) || []
  return snapshot
}

const FRP_VBS_TEMPLATE = `' ZJYPH frpc 隐形启动脚本（由运维面板生成）
' VBS 字符串中字面引号写两个 ""
CreateObject("WScript.Shell").Run """__FRPC_EXE__"" -c ""__FRPC_TOML__""", 0, False
`

async function frpStart() {
  const procs = await frpcProcesses()
  if (procs.length) return { ok: false, error: `frpc 已在运行（PID ${procs.map(p => p.ProcessId).join(', ')}）` }
  if (!fs.existsSync(FRPC_EXE) || !fs.existsSync(FRPC_TOML)) return { ok: false, error: 'frpc.exe 或 frpc.toml 不存在' }
  const probe = await runProc(FRPC_EXE, ['-v'], 10_000)
  if (probe.code !== 0 && /拒绝访问|access is denied|eacces|eperm/i.test(probe.stderr || '')) {
    return { ok: false, error: `Windows 拒绝执行 frpc.exe。请在 Windows 安全中心允许该程序，或将 ${FRPC_EXE} 加入防护排除项后重试。` }
  }
  fs.mkdirSync(FRP_LOG_DIR, { recursive: true })
  try {
    if (fs.statSync(FRPC_LOG).size > 8 * 1024 * 1024) fs.renameSync(FRPC_LOG, FRPC_LOG + '.1')  // 超 8MB 轮转
  } catch { /* 首次无日志 */ }
  const fd = fs.openSync(FRPC_LOG, 'a')
  try {
    // detached：frpc 独立于面板服务生命周期（面板重启不影响隧道）
    let child
    let fallbackStarted = false
    const startViaVbs = () => {
      if (fallbackStarted) return null
      fallbackStarted = true
      const vbs = FRP_VBS_TEMPLATE.replace('__FRPC_EXE__', FRPC_EXE).replace('__FRPC_TOML__', FRPC_TOML)
      fs.writeFileSync(FRP_VBS, vbs, 'utf8')
      return spawn('wscript.exe', [FRP_VBS], { detached: true, stdio: 'ignore', windowsHide: true, env: childEnv() })
    }
    try {
      child = spawn(FRPC_EXE, ['-c', FRPC_TOML], { detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env: childEnv() })
      // spawn 的权限错误可能异步通过 error 事件到达；此时切换到 VBS 启动通道。
      child.once('error', () => {
        try {
          const fallback = startViaVbs()
          fallback?.once('error', () => {})
          fallback?.unref()
        } catch { /* 由状态接口返回未检测到进程 */ }
      })
    } catch (err) {
      // 某些受限 Windows 运行环境禁止 Node 直接启动该 exe。
      child = startViaVbs()
    }
    child?.on('error', () => {})
    child?.unref()
  } finally { fs.closeSync(fd) }
  await new Promise(r => setTimeout(r, 1500))
  const after = await frpcProcesses()
  return { ok: after.length > 0, pids: after.map(p => p.ProcessId), output: after.length ? `frpc 已启动（PID ${after.map(p => p.ProcessId).join(', ')}），日志：${FRPC_LOG}` : '启动命令已执行，但未检测到进程，请查看日志' }
}

async function frpStop() {
  const procs = await frpcProcesses()
  if (!procs.length) return { ok: true, output: 'frpc 未在运行' }
  for (const p of procs) await runProc(TASKKILL, ['/PID', String(p.ProcessId), '/T', '/F'], 15_000)
  await new Promise(r => setTimeout(r, 800))
  const after = await frpcProcesses()
  return { ok: after.length === 0, output: after.length === 0 ? `已停止 ${procs.length} 个 frpc 进程` : '仍有 frpc 进程残留，请重试' }
}

// ── 6. AI 修复闭环 ───────────────────────────────────────────
function loadAiConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    return {
      baseUrl: (cfg.ai?.baseUrl || '').replace(/\/+$/, ''),
      apiKey: cfg.ai?.apiKey || '',
      model: cfg.ai?.model || '',
    }
  } catch { return { baseUrl: '', apiKey: '', model: '' } }
}

function saveAiConfig(patch) {
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) } catch { /* 首次创建 */ }
  cfg.ai = { ...(cfg.ai || {}), ...patch }
  fs.mkdirSync(__dirname, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
}

function getAiProxyUrl() {
  return process.env.AI_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || ''
}

/**
 * Node 20 的全局 fetch 不会读取 HTTP_PROXY/HTTPS_PROXY。
 * 这里用内置 http CONNECT + https.request，支持 AI 的普通 JSON 和 SSE 流式响应。
 */
function fetchAi(url, options = {}) {
  const proxyText = getAiProxyUrl()
  const target = new URL(url)
  if (!proxyText || target.protocol !== 'https:') return fetch(url, options)
  const proxy = new URL(proxyText)
  const targetPort = Number(target.port || 443)
  const proxyPort = Number(proxy.port || 80)
  const headers = { ...(options.headers || {}) }
  const proxyHeaders = {}
  if (proxy.username || proxy.password) {
    proxyHeaders['Proxy-Authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (err) => { if (!settled) { settled = true; reject(err) } }
    const connect = http.request({
      hostname: proxy.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
      headers: proxyHeaders,
      signal: options.signal,
    })
    connect.once('connect', (res, socket, head) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        return fail(new Error(`AI 代理 CONNECT 失败：HTTP ${res.statusCode}`))
      }
      if (head?.length) socket.unshift(head)
      const tlsSocket = tls.connect({ socket, servername: target.hostname })
      const agent = new https.Agent({ keepAlive: false })
      agent.createConnection = () => tlsSocket
      const request = https.request({
        hostname: target.hostname,
        port: targetPort,
        path: `${target.pathname}${target.search}`,
        method: options.method || 'GET',
        headers,
        agent,
        signal: options.signal,
      }, (incoming) => {
        settled = true
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((v) => responseHeaders.append(key, v))
          else if (value != null) responseHeaders.set(key, String(value))
        }
        resolve(new Response(Readable.toWeb(incoming), { status: incoming.statusCode || 502, headers: responseHeaders }))
      })
      request.once('error', fail)
      if (options.body) request.write(options.body)
      request.end()
    })
    connect.once('error', fail)
    connect.end()
  })
}

function maskFrpText(text) {
  return String(text || '').replace(/(auth\.token\s*=\s*["']?)[^\s"']+(["']?)/i, '$1••••••••（已掩码）••••••••$2')
}

function readFrpText() {
  try { return fs.readFileSync(FRPC_TOML, 'utf8') } catch { return '' }
}

function validateRuntimeConfig(input) {
  const cfg = {
    panel: { port: Number(input?.panel?.port) },
    services: {
      postgresPort: Number(input?.services?.postgresPort),
      backendPort: Number(input?.services?.backendPort),
      frontendPort: Number(input?.services?.frontendPort),
    },
    access: {
      publicDomain: String(input?.access?.publicDomain || '').trim(),
      frontendOrigin: String(input?.access?.frontendOrigin || '').trim(),
    },
  }
  const errors = []
  for (const [name, value] of Object.entries({ ...cfg.panel, ...cfg.services })) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) errors.push(`${name} 必须是 1~65535 的整数`)
  }
  if (cfg.access.publicDomain && !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(cfg.access.publicDomain)) {
    errors.push('公网域名格式不合法')
  }
  if (cfg.access.frontendOrigin && !/^https?:\/\/[^\s]+$/i.test(cfg.access.frontendOrigin)) errors.push('前端来源必须是 http(s) URL')
  return { cfg, errors }
}

function validateFrpText(text) {
  const value = String(text || '')
  const errors = []
  if (!/^\s*serverAddr\s*=\s*["'][^"']+["']/m.test(value)) errors.push('缺少 serverAddr')
  if (!/^\s*serverPort\s*=\s*\d+/m.test(value)) errors.push('缺少有效 serverPort')
  if (!/\[\[proxies\]\]/.test(value)) errors.push('至少需要一个 [[proxies]] 隧道段')
  if (/••••••••（已掩码）••••••••/.test(value)) {
    const old = (readFrpText().match(/auth\.token\s*=\s*["']([^"']+)["']/i) || [])[1]
    if (!old) errors.push('token 已掩码，但原配置中没有可保留的 token')
  }
  return errors
}

async function backupConfigFiles() {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-')
  const dir = path.join(CONFIG_BACKUP_DIR, stamp)
  await fsp.mkdir(dir, { recursive: true })
  await Promise.all([
    fsp.copyFile(RUNTIME_CONFIG_FILE, path.join(dir, 'runtime-config.json')),
    fs.existsSync(FRPC_TOML) ? fsp.copyFile(FRPC_TOML, path.join(dir, 'frpc.toml')) : Promise.resolve(),
  ])
  return { id: stamp, createdAt: new Date().toISOString() }
}

async function listConfigVersions() {
  try {
    const names = await fsp.readdir(CONFIG_BACKUP_DIR)
    const out = []
    for (const id of names.sort().reverse().slice(0, 20)) {
      const stat = await fsp.stat(path.join(CONFIG_BACKUP_DIR, id)).catch(() => null)
      if (stat?.isDirectory()) out.push({ id, createdAt: stat.mtime.toISOString() })
    }
    return out
  } catch { return [] }
}

async function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`
  await fsp.writeFile(tmp, text, 'utf8')
  await fsp.rename(tmp, file)
}

async function saveRuntimeSettings(body) {
  const checked = validateRuntimeConfig(body)
  const frpText = body.frpText !== undefined ? String(body.frpText) : readFrpText()
  const frpErrors = validateFrpText(frpText)
  if (checked.errors.length || frpErrors.length) return { error: [...checked.errors, ...frpErrors].join('；') }
  await fsp.mkdir(__dirname, { recursive: true })
  const backup = await backupConfigFiles()
  let finalFrp = frpText
  const oldToken = (readFrpText().match(/auth\.token\s*=\s*["']([^"']+)["']/i) || [])[1]
  if (oldToken) finalFrp = finalFrp.replace(/(auth\.token\s*=\s*["']?)••••••••（已掩码）••••••••(["']?)/i, `$1${oldToken}$2`)
  await writeAtomic(RUNTIME_CONFIG_FILE, JSON.stringify(checked.cfg, null, 2) + '\n')
  if (body.frpText !== undefined) await writeAtomic(FRPC_TOML, finalFrp)
  return { ok: true, backup, requiresPanelRestart: checked.cfg.panel.port !== PORT, affected: ['zjyph-postgres', 'zjyph-backend', 'zjyph-frontend', 'frpc'] }
}

const SYSTEM_PROMPT = `你是 ZJYPH 生产环境（Windows）的运维诊断助手，运行在本地运维面板中，仅面向系统管理员。

环境事实：
- PM2 托管三进程：zjyph-postgres（嵌入式 PostgreSQL 17，127.0.0.1:${RUNTIME_CONFIG.services.postgresPort}）、zjyph-backend（Node API，127.0.0.1:${RUNTIME_CONFIG.services.backendPort}）、zjyph-frontend（静态托管，127.0.0.1:${RUNTIME_CONFIG.services.frontendPort}）
- 日志目录 ${LOG_DIR}，备份目录 ${path.join(BACKUP_DIR, 'full')}（AES 加密 .dump.enc）
- FRP 客户端负责把前端 127.0.0.1:8080 通过 zjyph-web 隧道映射到公网域名；FRP 状态、控制连接和最近日志会随诊断上下文提供
- 面板提供进程重启/启动、巡检、冒烟、备份、旧备份清理等白名单动作
- PM2 环境诊断会随上下文提供；若 pm2Available=false 或 PM2 环境诊断未通过，说明面板无法可靠执行进程动作，不要声称已完成重启。后端/前端健康为 200 只能说明服务当前存活。

回答规范：
1. 用中文。先给简短结论与依据（引用关键日志/指标），再给处理建议；不要大段复述原始日志。
2. FRP 的 health=probe_blocked 表示面板进程的主动 TCP 探测被本机策略阻止，不等于隧道断开；此时结合 running、login success、proxy start success 日志判断，不能直接下结论说 FRP 不通。
3. 若建议可通过白名单动作完成，在回复最末尾输出且仅输出一个动作块，格式为：
\`\`\`action
{"action":"<动作名>","params":{...}}
\`\`\`
4. 可用动作（仅限以下，不得编造其他动作）：
   - restart_process  重启单个进程  params: {"proc":"zjyph-postgres|zjyph-backend|zjyph-frontend"}
   - start_process    启动单个进程  params: {"proc":"zjyph-postgres|zjyph-backend|zjyph-frontend"}
   - restart_all      依次重启全部三进程  params: {}
   - run_check        运行巡检(ops-check)或冒烟(smoke)  params: {"kind":"ops-check|smoke"}
   - run_backup_full  立即执行一次全量备份  params: {}
   - cleanup_backups  清理 N 天前的旧备份  params: {"days":<正整数>}
   - check_frp        只读检查 FRP 进程、控制连接、代理配置和最近日志  params: {}
5. 动作执行前会由管理员人工确认；涉及服务中断的动作须在正文说明影响与预计时长。
6. 白名单无法覆盖的操作（数据库修复、改配置、发版等）只给手动操作步骤文本，不要放进动作块。
7. 绝不建议删除数据文件、格式化磁盘、关闭防火墙等危险操作。`

/** 采集诊断上下文：pm2 状态 + 健康 + 备份年龄 + 页面附加数据 */
async function collectContext(source, extra) {
  const [pm, pm2Env, health, backup, frp] = await Promise.all([
    pm2List(),
    pm2Diagnostics(false),
    Promise.all([probe(`http://127.0.0.1:${RUNTIME_CONFIG.services.backendPort}/health`), probe(`http://127.0.0.1:${RUNTIME_CONFIG.services.frontendPort}/`)]),
    backupInfo(),
    frpSnapshot(true),
  ])
  const ctx = {
    时间: new Date().toLocaleString('zh-CN'),
    来源: source || 'overview',
    进程: pm.pm2Available ? pm.procs : { 错误: pm.error },
    PM2环境: pm2Env,
    后端健康: health[0],
    前端健康: health[1],
    FRP: frp,
    备份: { 最近备份: backup.latest?.name || '无', 距今小时: backup.ageHours == null ? null : +backup.ageHours.toFixed(1), 备份数: backup.count },
    附加: extra || null,
  }
  return ctx
}

/** 请求 DeepSeek 兼容 /chat/completions */
async function aiChat(messages, { stream = false, timeoutMs = 300_000, maxTokens } = {}) {
  const cfg = loadAiConfig()
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    return { error: '未配置 AI API，请先在「AI 修复」页的设置里填写 Base URL / API Key / 模型' }
  }
  const body = { model: cfg.model, messages, stream }
  if (maxTokens) body.max_tokens = maxTokens
  let res
  try {
    res = await fetchAi(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    return { error: `AI 接口请求失败：${String(e?.cause?.code || e?.name || e).slice(0, 200)}` }
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 500)
    return { error: `AI 接口返回 HTTP ${res.status}：${text}` }
  }
  return { res, cfg }
}

// ── 7. AI 动作白名单执行 ─────────────────────────────────────
async function executeAction(action, params = {}) {
  switch (action) {
    case 'restart_process':
    case 'start_process': {
      const r = await pm2Action(params.proc, action === 'restart_process' ? 'restart' : 'start')
      return { ...r, action, params }
    }
    case 'restart_all': {
      const parts = []
      for (const proc of PROCS) {
        const r = await pm2Action(proc, 'restart')
        parts.push(`${proc}: ${r.ok ? 'OK' : 'FAIL'}\n${(r.output || '').slice(-500)}`)
      }
      return { ok: parts.every((p) => p.includes('OK')), output: parts.join('\n---\n'), action, params }
    }
    case 'run_check': {
      const r = await runCheck(params.kind)
      return { ...r, action, params }
    }
    case 'run_backup_full': {
      const r = await backupRun('full')
      return { ...r, action, params }
    }
    case 'cleanup_backups': {
      const days = Math.floor(Number(params.days))
      if (!Number.isFinite(days) || days < 1 || days > 365) return { ok: false, error: 'days 须为 1~365 整数', action, params }
      const r = await backupRun('cleanup', ['-RetentionDays', String(days)])
      return { ...r, action, params }
    }
    case 'check_frp': {
      const r = await frpSnapshot(true)
      return { ok: true, output: JSON.stringify(r, null, 2), action, params }
    }
    default:
      return { ok: false, error: `动作不在白名单内：${action}`, action, params }
  }
}

/** 独立弹出进程（打开目录/网页）：spawn 失败不拖垮面板服务 */
function spawnDetached(file, args) {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true, env: childEnv() })
  child.on('error', () => {})
  child.unref()
  return child
}

// ── 8. 静态资源 ──────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }
function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  const file = path.normalize(path.join(PUBLIC_DIR, rel))
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' })
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' })
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    res.end(data)
  })
}

// ── 9. 路由 ──────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const p = url.pathname
  try {
    // —— 状态总览 ——
    if (p === '/api/status' && req.method === 'GET') {
      const [pm, pm2Env, health, backup] = await Promise.all([
        pm2List(),
        pm2Diagnostics(false),
        Promise.all([probe(`http://127.0.0.1:${RUNTIME_CONFIG.services.backendPort}/health`), probe(`http://127.0.0.1:${RUNTIME_CONFIG.services.frontendPort}/`)]),
        backupInfo(),
      ])
      const ai = loadAiConfig()
      return send(res, 200, {
        time: new Date().toISOString(),
        pm2Available: pm.pm2Available,
        pm2Error: pm.error || null,
        pm2Diagnostics: pm2Env,
        procs: pm.procs || [],
        backend: health[0],
        frontend: health[1],
        backup: { latest: backup.latest, ageHours: backup.ageHours == null ? null : +backup.ageHours.toFixed(1), count: backup.count },
        aiConfigured: !!(ai.baseUrl && ai.apiKey && ai.model),
      })
    }

    if (p === '/api/pm2/diagnostics' && req.method === 'GET') {
      return send(res, 200, await pm2Diagnostics(true))
    }

    // —— 进程管理 ——
    const pm2Match = p.match(/^\/api\/pm2\/([^/]+)\/(restart|start|stop)$/)
    if (pm2Match && req.method === 'POST') {
      const r = await pm2Action(decodeURIComponent(pm2Match[1]), pm2Match[2])
      return send(res, r.error ? 400 : 200, r)
    }

    // —— 巡检 / 冒烟 ——
    if (p === '/api/run-check' && req.method === 'POST') {
      const body = await readBody(req)
      const r = await runCheck(body.kind)
      return send(res, r.error ? (r.busy ? 409 : 400) : 200, r)
    }

    // —— 备份 ——
    if (p === '/api/backup/full' && req.method === 'POST') {
      const r = await backupRun('full')
      return send(res, r.error ? (r.busy ? 409 : 400) : 200, r)
    }
    if (p === '/api/backups' && req.method === 'GET') {
      return send(res, 200, { backups: await listBackups() })
    }
    if (p === '/api/backup/verify' && req.method === 'POST') {
      const body = await readBody(req)
      const resolved = path.resolve(String(body.file || ''))
      if (!resolved.startsWith(path.resolve(BACKUP_DIR))) return send(res, 400, { error: '备份文件路径非法' })
      const r = await backupRun('verify', ['-BackupFile', resolved])
      return send(res, 200, r)
    }
    if (p === '/api/backup/cleanup' && req.method === 'POST') {
      const body = await readBody(req)
      const days = Math.floor(Number(body.days))
      if (!Number.isFinite(days) || days < 1 || days > 365) return send(res, 400, { error: 'days 须为 1~365 整数' })
      const r = await backupRun('cleanup', ['-RetentionDays', String(days)])
      return send(res, 200, r)
    }

    // —— 日志 ——（PM2 配置的日志文件名无 zjyph- 前缀：postgres.out.log 等）
    const logMatch = p.match(/^\/api\/logs\/([^/]+)$/)
    if (logMatch && req.method === 'GET') {
      const proc = decodeURIComponent(logMatch[1])
      if (!PROCS.includes(proc)) return send(res, 400, { error: '未知进程' })
      const base = proc.replace(/^zjyph-/, '')
      const lines = Math.min(Math.max(parseInt(url.searchParams.get('lines') || '200', 10) || 200, 10), 1000)
      const [out, err] = await Promise.all([
        tailFile(path.join(LOG_DIR, `${base}.out.log`), lines),
        tailFile(path.join(LOG_DIR, `${base}.err.log`), lines),
      ])
      return send(res, 200, { out: out || [], err: err || [] })
    }

    // —— 快捷入口 ——
    if (p === '/api/open' && req.method === 'POST') {
      const body = await readBody(req)
      const EXPLORER = 'C:\\Windows\\explorer.exe'
      switch (body.target) {
        case 'logs':
          spawnDetached(EXPLORER, [LOG_DIR])
          return send(res, 200, { ok: true })
        case 'backup':
          spawnDetached(EXPLORER, [path.join(BACKUP_DIR, 'full')])
          return send(res, 200, { ok: true })
        case 'app':
          spawnDetached(EXPLORER, [`http://127.0.0.1:${RUNTIME_CONFIG.services.frontendPort}`])
          return send(res, 200, { ok: true })
        case 'health':
          spawnDetached(EXPLORER, [`http://127.0.0.1:${RUNTIME_CONFIG.services.backendPort}/health`])
          return send(res, 200, { ok: true })
        default:
          return send(res, 400, { error: '未知 target' })
      }
    }

    // —— FRP 管理 ——
    if (p === '/api/frp/status' && req.method === 'GET') {
      // 先取进程快照，再冷启动版本探测（frpc -v 短命进程），避免被误计入 running
      const procs = await frpcProcesses()
      const autostart = await frpAutostartStatus()
      const version = await frpcVersion()
      const cfg = parseFrpcConfig()
      const tcp = cfg?.serverAddr ? await tcpProbe(cfg.serverAddr, cfg.serverPort || 7000) : { ok: false, error: '无法解析服务器地址' }
      const started = procs[0] ? parseCimDate(procs[0].CreationDate) : null
      return send(res, 200, {
        installed: fs.existsSync(FRPC_EXE) && fs.existsSync(FRPC_TOML),
        running: procs.length > 0,
        pids: procs.map(x => x.ProcessId),
        uptimeMs: started ? Date.now() - started : null,
        version,
        config: cfg,
        tcp,
        autostart,
      })
    }
    if (p === '/api/frp/start' && req.method === 'POST') {
      return send(res, 200, await frpStart())
    }
    if (p === '/api/frp/stop' && req.method === 'POST') {
      return send(res, 200, await frpStop())
    }
    if (p === '/api/frp/restart' && req.method === 'POST') {
      const st = await frpStop()
      const r = await frpStart()
      return send(res, 200, { ...r, output: `${st.output}\n${r.output || ''}`.trim() })
    }
    if (p === '/api/frp/logs' && req.method === 'GET') {
      const lines = Math.min(Math.max(parseInt(url.searchParams.get('lines') || '200', 10) || 200, 10), 1000)
      const out = await tailFile(FRPC_LOG, lines)
      return send(res, 200, { exists: out !== null, lines: out || [] })
    }
    if (p === '/api/frp/config' && req.method === 'GET') {
      return send(res, 200, { text: frpcConfigMasked() })
    }
    if (p === '/api/frp/autostart' && req.method === 'POST') {
      const body = await readBody(req)
      if (body.enable) {
        // 写隐形启动 VBS（frpc 是控制台程序，直接进 Run 键会弹黑框）+ HKCU Run 键，无需管理员
        const vbs = FRP_VBS_TEMPLATE.replace('__FRPC_EXE__', FRPC_EXE).replace('__FRPC_TOML__', FRPC_TOML)
        fs.writeFileSync(FRP_VBS, vbs, 'utf8')
        const rv = `"wscript.exe" "${FRP_VBS}"`
        const r = await runProc(REG_EXE, ['add', FRP_RUNKEY, '/v', 'ZJYPH-frpc', '/t', 'REG_SZ', '/d', rv, '/f'], 20_000)
        return send(res, 200, { ok: r.code === 0, output: r.code === 0 ? '已注册登录自启（HKCU Run 键 ZJYPH-frpc，登录后隐形启动）' : (r.stdout + r.stderr).slice(-500) })
      }
      const r = await runProc(REG_EXE, ['delete', FRP_RUNKEY, '/v', 'ZJYPH-frpc', '/f'], 20_000)
      return send(res, 200, { ok: r.code === 0, output: r.code === 0 ? '已取消登录自启' : (r.stdout + r.stderr).slice(-500) })
    }

    // —— 运行配置 ——
    if (p === '/api/config' && req.method === 'GET') {
      return send(res, 200, {
        config: RUNTIME_CONFIG,
        frpText: maskFrpText(readFrpText()),
        versions: await listConfigVersions(),
        panelRestartRequired: false,
      })
    }
    if (p === '/api/config/validate' && req.method === 'POST') {
      const body = await readBody(req)
      const checked = validateRuntimeConfig(body.config || body)
      const frpErrors = validateFrpText(body.frpText === undefined ? readFrpText() : body.frpText)
      return send(res, checked.errors.length || frpErrors.length ? 400 : 200, { ok: !checked.errors.length && !frpErrors.length, errors: [...checked.errors, ...frpErrors] })
    }
    if (p === '/api/config' && req.method === 'PUT') {
      const body = await readBody(req)
      const r = await saveRuntimeSettings({ ...(body.config || body), frpText: body.frpText })
      return send(res, r.error ? 400 : 200, r)
    }
    if (p === '/api/config/versions' && req.method === 'GET') {
      return send(res, 200, { versions: await listConfigVersions() })
    }
    if (p === '/api/config/rollback' && req.method === 'POST') {
      const body = await readBody(req)
      if (!/^[\w-]+$/.test(String(body.id || ''))) return send(res, 400, { error: '版本编号非法' })
      const dir = path.join(CONFIG_BACKUP_DIR, body.id)
      const stat = await fsp.stat(dir).catch(() => null)
      if (!stat?.isDirectory()) return send(res, 404, { error: '配置版本不存在' })
      const current = await backupConfigFiles()
      await fsp.copyFile(path.join(dir, 'runtime-config.json'), RUNTIME_CONFIG_FILE)
      if (fs.existsSync(path.join(dir, 'frpc.toml'))) await fsp.copyFile(path.join(dir, 'frpc.toml'), FRPC_TOML)
      return send(res, 200, { ok: true, backup: current, requiresPanelRestart: true, message: '配置已回滚，应用前请确认受影响服务' })
    }
    if (p === '/api/config/apply' && req.method === 'POST') {
      const body = await readBody(req)
      const targets = Array.isArray(body.targets) ? body.targets : ['zjyph-postgres', 'zjyph-backend', 'zjyph-frontend', 'frpc']
      const results = []
      for (const proc of targets) {
        if (proc === 'frpc') {
          const stopped = await frpStop()
          const started = await frpStart()
          results.push({ target: proc, ok: !!started.ok, output: `${stopped.output}\n${started.output || started.error || ''}`.trim() })
        } else if (PROCS.includes(proc)) {
          results.push({ target: proc, ...(await pm2Action(proc, 'restart')) })
        }
      }
      return send(res, 200, { ok: results.every((x) => x.ok !== false), results })
    }

    // —— AI 设置 ——
    if (p === '/api/ai/settings' && req.method === 'GET') {
      const cfg = loadAiConfig()
      return send(res, 200, {
        baseUrl: cfg.baseUrl, model: cfg.model, hasKey: !!cfg.apiKey,
        keyMasked: cfg.apiKey ? cfg.apiKey.slice(0, 4) + '****' + cfg.apiKey.slice(-4) : '',
      })
    }
    if (p === '/api/ai/settings' && req.method === 'PUT') {
      const body = await readBody(req)
      const patch = {}
      if (body.baseUrl !== undefined) {
        if (!/^https?:\/\//.test(String(body.baseUrl))) return send(res, 400, { error: 'Base URL 须以 http(s):// 开头' })
        patch.baseUrl = String(body.baseUrl).replace(/\/+$/, '')
      }
      if (body.model !== undefined) patch.model = String(body.model).trim()
      if (body.apiKey !== undefined && body.apiKey !== '') patch.apiKey = String(body.apiKey).trim()
      saveAiConfig(patch)
      return send(res, 200, { ok: true })
    }

    // —— AI 连通性测试 ——
    if (p === '/api/ai/test' && req.method === 'POST') {
      const r = await aiChat([{ role: 'user', content: '只回复四个字：连接正常' }], { maxTokens: 16, timeoutMs: 30_000 })
      if (r.error) return send(res, 400, { error: r.error })
      let data
      try { data = await r.res.json() }
      catch { return send(res, 400, { error: 'AI 接口返回了非 JSON 响应，请检查 Base URL 是否正确（应指向 OpenAI 兼容根路径，如 https://xxx/v1）' }) }
      return send(res, 200, { ok: true, reply: data.choices?.[0]?.message?.content?.slice(0, 100) || '', model: r.cfg.model })
    }

    // —— AI 诊断（SSE 流式转发）——
    if (p === '/api/ai/diagnose' && req.method === 'POST') {
      const body = await readBody(req)
      const ctx = await collectContext(body.source, body.extra)
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `当前面板采集到的系统状态如下（JSON）：\n${JSON.stringify(ctx, null, 2)}\n\n${body.question ? `管理员问题：${body.question}` : '请分析当前状态，若有异常请给出结论、依据与修复建议（可用动作时附动作块）。'}` },
      ]
      const r = await aiChat(messages, { stream: true, timeoutMs: 300_000 })
      if (r.error) return send(res, 400, { error: r.error })
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      const ac = new AbortController()
      req.on('close', () => ac.abort())
      const reader = r.res.body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
      } catch { /* 上游或客户端中断 */ }
      return res.end()
    }

    // —— AI 动作执行（白名单）——
    if (p === '/api/ai/execute' && req.method === 'POST') {
      const body = await readBody(req)
      const r = await executeAction(String(body.action || ''), body.params || {})
      if (r.error && !('ok' in r)) return send(res, 400, r)
      return send(res, 200, r)
    }

    if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' })
    return serveStatic(res, p)
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e).slice(0, 300) })
  }
})

// 面板为常驻服务：单次异常不允许拖垮整个进程
process.on('uncaughtException', (e) => console.error('[ops-panel] uncaughtException:', e))
process.on('unhandledRejection', (e) => console.error('[ops-panel] unhandledRejection:', e))

loadUserEnvFallback()
  .catch(() => {})   // 用户级环境变量兜底失败不阻塞启动
  .finally(() => {
    server.listen(PORT, HOST, () => {
      console.log(`[ops-panel] 运维面板已启动：http://${HOST}:${PORT}`)
    })
  })
