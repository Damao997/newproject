# FRP 内网穿透安全加固 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收敛 ZJYPH frp 隧道的网络暴露面，并为运维面板加上请求鉴权与操作审计。

**Architecture:** 服务器侧收紧 frps 监听与防火墙限源；本机侧新增零依赖的 `panel-guard` 纯函数模块做 Host 白名单与令牌校验，`server.mjs` 在请求入口统一接线，前端统一携带令牌；运行时文件用 ACL 收紧。

**Tech Stack:** frp 0.71.0 / Node 20 内置模块（`node:crypto`、`node:test`）/ UFW / Windows `icacls`。

**Spec:** `docs/superpowers/specs/2026-10-05-frp-security-hardening-design.md`

## Global Constraints

- 对外沟通、注释、文档一律简体中文；代码标识符用英文。
- `ops-panel` 保持**零 npm 依赖**，只使用 Node 内置模块；测试用 `node:test` + `node:assert`。
- 生产 Node 版本为 20（`.nvmrc`）。
- 严禁在 `D:\ZJYPHFA`（生产目录）开发、提交、stash、测试。所有代码改动在 `D:\ZJYPHFA-dev`。
- 暂存使用明确文件列表，禁止 `git add .`。
- 提交前在开发目录执行 `npm run verify`。
- 令牌、口令等敏感信息不得写入任何入库文件。
- 服务器改动前必须备份原文件；异常必须回滚。
- 端口放行遵循最小权限，默认拒绝。

---

### Task 0: 隔离工作区（已按实际执行更新）

> 执行时发现 `D:\ZJYPHFA-dev` 存在**进行中的密码重置/验证码功能**（26 个已跟踪改动，含
> `server/prisma/migrations/20261005000538_add_password_reset_code/` 等新文件）。原「代提交 WIP」
> 授权基于当时描述的小改动，已不适用；经用户确认改为**独立 git worktree**，完全不触碰 `D:\ZJYPHFA-dev`。

**Files:** 无

**Interfaces:**
- Consumes: 无
- Produces: 隔离工作区 `D:\ZJYPHFA-frp`，分支 `security/frp-hardening`，基线 `origin/main`（`f8aa3017`）

- [x] **Step 1: 确认工作区与远端状态**

`D:\ZJYPHFA-dev` 在 `main`（`4c4900a7`，落后 `origin/main`），存在大批未提交改动；
`origin/develop` 为 `origin/main` 的干净祖先（少一个发布提交）；`D:/ZJYPHFA` 为主仓（`.git` 目录），
`D:/ZJYPHFA-dev` 是它的链接工作树，远端另有 codex 侧工作树。

- [x] **Step 2: 建立隔离 worktree**

```bash
git -C /d/ZJYPHFA-dev worktree add /d/ZJYPHFA-frp -b security/frp-hardening origin/main
```

Expected: `D:/ZJYPHFA-frp` 出现在 `git worktree list`，分支 `security/frp-hardening` 追踪 `origin/main`；
`D:\ZJYPHFA-dev` 的工作树文件未被改动。

- [x] **Step 3: 迁入设计/计划文档**

两份文档原为 `D:\ZJYPHFA-dev` 的未跟踪文件，已 `mv` 入 worktree：

```bash
mkdir -p /d/ZJYPHFA-frp/docs/superpowers/specs /d/ZJYPHFA-frp/docs/superpowers/plans
mv "/d/ZJYPHFA-dev/docs/superpowers/specs/2026-10-05-frp-security-hardening-design.md" /d/ZJYPHFA-frp/docs/superpowers/specs/
mv "/d/ZJYPHFA-dev/docs/superpowers/plans/2026-10-05-frp-security-hardening.md" /d/ZJYPHFA-frp/docs/superpowers/plans/
```

- [ ] **Step 4: 安装依赖（供 Task 7 的 verify 使用）**

ops-panel 改动零依赖；`npm run verify` 需要 `server/` 与 `web/` 依赖：

```bash
cd /d/ZJYPHFA-frp && npm ci --prefix server
cd /d/ZJYPHFA-frp && npm ci --prefix web
```

> server 测试若依赖开发库（`server/.pgdata` 只存在于 `D:\ZJYPHFA-dev`），需按
> `docs/本地开发环境启动指南.md` 在本 worktree 起库；起不来则如实报告该项未在隔离区执行，不得伪造通过。

**⚠️ 后续 Task 1–7 一律在 `D:\ZJYPHFA-frp` 内执行，不再使用 `D:\ZJYPHFA-dev`。**

---

### Task 1: panel-guard 纯函数模块

**Files:**
- Create: `ops-panel/lib/panel-guard.mjs`
- Test: `ops-panel/lib/panel-guard.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `TOKEN_HEADER: string`（值 `'x-ops-token'`）
  - `createToken(): string`
  - `loadOrCreateToken(file: string): string`
  - `isAllowedHost(hostHeader: string|undefined, port: number): boolean`
  - `tokenMatches(provided: string|undefined, expected: string): boolean`
  - `auditLine(fields: object): string`

- [ ] **Step 1: 写失败的测试**

创建 `ops-panel/lib/panel-guard.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  TOKEN_HEADER,
  createToken,
  loadOrCreateToken,
  isAllowedHost,
  tokenMatches,
  auditLine,
} from './panel-guard.mjs'

test('TOKEN_HEADER 使用 x-ops-token', () => {
  assert.equal(TOKEN_HEADER, 'x-ops-token')
})

test('createToken 生成 64 位十六进制且互不相同', () => {
  const a = createToken()
  const b = createToken()
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.notEqual(a, b)
})

test('loadOrCreateToken 首次生成并在二次调用时复用', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-guard-'))
  const file = path.join(dir, '.panel-token')
  const first = loadOrCreateToken(file)
  assert.match(first, /^[0-9a-f]{64}$/)
  assert.equal(loadOrCreateToken(file), first)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadOrCreateToken 忽略空白并重建空文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-guard-'))
  const file = path.join(dir, '.panel-token')
  fs.writeFileSync(file, '   \n')
  assert.match(loadOrCreateToken(file), /^[0-9a-f]{64}$/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('isAllowedHost 仅放行回环主机名与面板端口', () => {
  assert.equal(isAllowedHost('127.0.0.1:3900', 3900), true)
  assert.equal(isAllowedHost('localhost:3900', 3900), true)
  assert.equal(isAllowedHost('LOCALHOST:3900', 3900), true)
  assert.equal(isAllowedHost('[::1]:3900', 3900), true)
  assert.equal(isAllowedHost('127.0.0.1:3901', 3900), false)
  assert.equal(isAllowedHost('evil.example.com:3900', 3900), false)
  assert.equal(isAllowedHost('127.0.0.1:3900.evil.com', 3900), false)
  assert.equal(isAllowedHost('', 3900), false)
  assert.equal(isAllowedHost(undefined, 3900), false)
})

test('tokenMatches 仅接受等值且等长的令牌', () => {
  const t = createToken()
  assert.equal(tokenMatches(t, t), true)
  assert.equal(tokenMatches('a'.repeat(64), t), false)
  assert.equal(tokenMatches('deadbeef', t), false)
  assert.equal(tokenMatches(t, t.slice(0, -1)), false)
  assert.equal(tokenMatches('', t), false)
  assert.equal(tokenMatches(t, ''), false)
  assert.equal(tokenMatches(undefined, t), false)
})

test('auditLine 输出单行 JSON 且含时间戳', () => {
  const line = auditLine({ action: 'POST /api/frp/restart', result: '200' })
  assert.equal(line.endsWith('\n'), true)
  const parsed = JSON.parse(line)
  assert.equal(parsed.action, 'POST /api/frp/restart')
  assert.equal(parsed.result, '200')
  assert.ok(!Number.isNaN(Date.parse(parsed.time)))
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /d/ZJYPHFA-dev
node --test ops-panel/lib/panel-guard.test.mjs
```

Expected: FAIL，报 `Cannot find module .../panel-guard.mjs`。

- [ ] **Step 3: 写最小实现**

创建 `ops-panel/lib/panel-guard.mjs`：

```js
/**
 * 运维面板本地安全护栏：令牌、Host 白名单与审计记录。
 * 纯函数 + 本地文件读写，仅用 Node 内置模块，可被 node --test 直接单测。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const TOKEN_HEADER = 'x-ops-token'

/** 生成 32 字节随机令牌（64 位十六进制）。 */
export function createToken() {
  return crypto.randomBytes(32).toString('hex')
}

/** 读取已有令牌；文件缺失或为空时生成并写入（Windows ACL 由 start-panel.ps1 收紧）。 */
export function loadOrCreateToken(file) {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing) return existing
  } catch { /* 首次启动或文件不可读，走生成分支 */ }
  const token = createToken()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, token + '\n', { encoding: 'utf8', mode: 0o600 })
  return token
}

/** Host 头白名单：仅回环主机名 + 面板端口，阻断 DNS rebinding。 */
export function isAllowedHost(hostHeader, port) {
  if (!hostHeader) return false
  const host = String(hostHeader).toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

/** 常量时间比较令牌，避免时序侧信道。 */
export function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** 单行 JSON 审计记录；敏感值由调用方先行掩码。 */
export function auditLine(fields) {
  return JSON.stringify({ time: new Date().toISOString(), ...fields }) + '\n'
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /d/ZJYPHFA-dev
node --test ops-panel/lib/panel-guard.test.mjs
```

Expected: PASS，7 项全过。

- [ ] **Step 5: 提交**

```bash
cd /d/ZJYPHFA-dev
git add ops-panel/lib/panel-guard.mjs ops-panel/lib/panel-guard.test.mjs
git commit -m "feat(ops-panel): 新增面板安全护栏模块与单元测试"
```

---

### Task 2: 面板鉴权与审计接线（server.mjs + app.js）

> 本任务的三处改动必须**同一个提交**：只改服务端会导致前端拿不到令牌而面板全部 401。

**Files:**
- Modify: `ops-panel/server.mjs`（导入区、常量区、`send` 之后、请求入口、`serveStatic`）
- Modify: `ops-panel/public/app.js:17-41`（`api()`）、`ops-panel/public/app.js:714-719`（SSE）

**Interfaces:**
- Consumes: `panel-guard.mjs` 的 `TOKEN_HEADER`、`isAllowedHost`、`loadOrCreateToken`、`tokenMatches`、`auditLine`
- Produces: 全局 `PANEL_TOKEN`（`string`）、`audit(action: string, detail: string, ip: string): void`

- [ ] **Step 1: 加导入**

在 `ops-panel/server.mjs` 第 23 行 `import { fileURLToPath } from 'node:url'` 之后新增：

```js
import { TOKEN_HEADER, isAllowedHost, loadOrCreateToken, tokenMatches, auditLine } from './lib/panel-guard.mjs'
```

- [ ] **Step 2: 加常量**

在 `ops-panel/server.mjs` 第 44 行 `const REG_EXE = ...` 之后新增：

```js
const PANEL_TOKEN_FILE = path.join(__dirname, '.panel-token')
const PANEL_AUDIT_DIR = path.join(__dirname, 'logs')
const PANEL_AUDIT_LOG = path.join(PANEL_AUDIT_DIR, 'audit.log')
const PANEL_TOKEN = loadOrCreateToken(PANEL_TOKEN_FILE)
```

- [ ] **Step 3: 加审计函数**

在 `ops-panel/server.mjs` 的 `send()` 函数（第 76-83 行）之后新增：

```js
/** 操作审计：非 GET 的 /api 动作写 JSON Lines 到 ops-panel/logs/audit.log，失败不阻断请求。 */
function audit(action, detail, ip) {
  try {
    fs.mkdirSync(PANEL_AUDIT_DIR, { recursive: true })
    fs.appendFile(PANEL_AUDIT_LOG, auditLine({ action, detail, ip }), () => {})
  } catch { /* 审计写入失败不影响请求 */ }
}
```

- [ ] **Step 4: 在请求入口加 Host 白名单与令牌校验**

在 `ops-panel/server.mjs` 第 850 行 `const p = url.pathname` 之后、`try {`（第 851 行）之前插入：

```js
  // —— 本地安全护栏：Host 白名单 + /api 令牌鉴权 + 非 GET 审计 ——
  if (!isAllowedHost(req.headers.host, PORT)) {
    return send(res, 403, { error: 'Host 不在允许列表内' })
  }
  if (p.startsWith('/api/')) {
    if (!tokenMatches(req.headers[TOKEN_HEADER], PANEL_TOKEN)) {
      return send(res, 401, { error: '缺少或错误的访问令牌' })
    }
    if (req.method !== 'GET') {
      const started = Date.now()
      res.once('finish', () => {
        audit(`${req.method} ${p}`, `status=${res.statusCode} 耗时=${Date.now() - started}ms`, req.socket.remoteAddress || '')
      })
    }
  }
```

- [ ] **Step 5: 在 serveStatic 注入令牌**

将 `ops-panel/server.mjs` 的 `serveStatic`（第 836-845 行）整体替换为：

```js
function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  const file = path.normalize(path.join(PUBLIC_DIR, rel))
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' })
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' })
    const ext = path.extname(file)
    const body = ext === '.html'
      ? Buffer.from(
          data.toString('utf8').replace('</head>', `<script>window.__OPS_TOKEN__=${JSON.stringify(PANEL_TOKEN)}</script>\n</head>`),
          'utf8',
        )
      : data
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    res.end(body)
  })
}
```

- [ ] **Step 6: 前端 api() 携带令牌**

将 `ops-panel/public/app.js:17-24` 的 `api()` 开头替换为：

```js
async function api(path, opts = {}) {
  let res
  const { headers, ...rest } = opts
  try {
    res = await fetch(path, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        'X-Ops-Token': window.__OPS_TOKEN__ || '',
        ...(headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
```

- [ ] **Step 7: SSE 直连携带令牌**

将 `ops-panel/public/app.js:714-719` 的 SSE 请求头替换为：

```js
    const res = await fetch('/api/ai/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ops-Token': window.__OPS_TOKEN__ || '' },
      body: JSON.stringify({ source, extra, question }),
      signal: aiAbort.signal,
    })
```

- [ ] **Step 8: 本地冒烟验证**

> **端口冲突提示：** 本机 `127.0.0.1:3900` 已被**生产面板进程**占用。开发目录冒烟必须换用独立端口，否则 `EADDRINUSE`。`ops-panel/runtime-config.json` 已被 gitignore，可用于本地测试。

```bash
cd /d/ZJYPHFA-dev
# 1) 用独立端口 3901 起一个临时实例
cat > ops-panel/runtime-config.json <<'JSON'
{ "panel": { "port": 3901 }, "services": { "postgresPort": 5433, "backendPort": 3100, "frontendPort": 8080 }, "access": { "publicDomain": "", "frontendOrigin": "" } }
JSON
node ops-panel/server.mjs &
PANEL_PID=$!
sleep 1
# 2) 无令牌 -> 401
curl -s -o /dev/null -w 'no-token=%{http_code}\n' http://127.0.0.1:3901/api/status
# 3) 错误 Host -> 403
curl -s -o /dev/null -w 'bad-host=%{http_code}\n' -H 'Host: evil.example.com:3901' http://127.0.0.1:3901/
# 4) 带令牌 -> 200
TOKEN=$(cat ops-panel/.panel-token)
curl -s -o /dev/null -w 'with-token=%{http_code}\n' -H "X-Ops-Token: $TOKEN" http://127.0.0.1:3901/api/status
# 5) 首页注入令牌
curl -s http://127.0.0.1:3901/ | grep -c '__OPS_TOKEN__'
# 6) 触发一次审计
curl -s -o /dev/null -X POST -H "X-Ops-Token: $TOKEN" http://127.0.0.1:3901/api/frp/logs
cat ops-panel/logs/audit.log
# 7) 收尾
kill $PANEL_PID
rm ops-panel/runtime-config.json ops-panel/.panel-token
rm -rf ops-panel/logs
```

Expected: `no-token=401`、`bad-host=403`、`with-token=200`、第 5 步 `grep -c` ≥ 1、`audit.log` 出现一行含 `POST /api/frp/logs`。

> 注意：不要误杀 PID 37936 的生产面板进程；上面用 `$!` 精确捕获本实例 PID。

- [ ] **Step 9: 浏览器验证**

用 Edge 打开 `http://127.0.0.1:3900`，确认状态卡片、日志、FRP 页签均能正常加载（不应出现 401 提示）。若出现 401，检查浏览器控制台里 `window.__OPS_TOKEN__` 是否有值。

- [ ] **Step 10: 提交**

```bash
cd /d/ZJYPHFA-dev
git add ops-panel/server.mjs ops-panel/public/app.js
git commit -m "feat(ops-panel): 请求入口加 Host 白名单与令牌鉴权并记录操作审计"
```

---

### Task 3: 本机运行支撑（ACL、gitignore、README）

**Files:**
- Modify: `ops-panel/start-panel.ps1`（服务就绪后加 ACL 步骤）
- Modify: `.gitignore`（新增 `/ops-panel/.panel-token`）
- Modify: `ops-panel/README.md`

**Interfaces:**
- Consumes: Task 1 生成的 `ops-panel/.panel-token`
- Produces: 无

- [ ] **Step 1: start-panel.ps1 收紧令牌 ACL**

在 `ops-panel/start-panel.ps1` 第 58 行（`} else { ... }` 块结束后、`# ── 2. -Install` 之前）新增：

```powershell
# ── 1.5 收紧面板令牌文件权限（仅当前用户可读）──────────────
$tokenFile = Join-Path $root '.panel-token'
if (Test-Path $tokenFile) {
  $me = "$env:USERDOMAIN\$env:USERNAME"
  icacls $tokenFile /inheritance:r /grant:r "${me}:(R)" /grant:r "SYSTEM:(F)" /grant:r "Administrators:(F)" | Out-Null
  Write-Host '面板令牌权限已收紧'
}
```

- [ ] **Step 2: gitignore 排除令牌**

在 `.gitignore` 的 `# 运维面板本地启动产物` 段（`/ops-panel/*.pid` 一行）之后新增：

```
# 运维面板访问令牌（本机生成，严禁入库）
/ops-panel/.panel-token
```

（说明：`ops-panel/logs/` 已由既有的 `logs` 规则覆盖，无需重复添加。）

- [ ] **Step 3: 更新 ops-panel/README.md**

在 `ops-panel/README.md` 末尾追加：

```markdown

## 访问安全

- 面板仅监听 `127.0.0.1`，且请求入口校验 `Host` 白名单（`127.0.0.1` / `localhost` / `[::1]`）阻断 DNS rebinding。
- 所有 `/api/*` 请求必须携带 `X-Ops-Token` 头；令牌由服务启动时生成并保存在本机 `ops-panel/.panel-token`（已 gitignore + 权限收紧），由页面自动注入，无需手工填写。
- 所有非 GET 的 `/api/*` 动作会记录到 `ops-panel/logs/audit.log`（方法、路径、状态码、耗时、来源地址）。
- 已知边界：本机其他进程仍可直接读取页面注入的令牌，该路径由操作系统用户隔离与文件权限承担。
```

- [ ] **Step 4: 验证 PowerShell 语法**

```bash
cd /d/ZJYPHFA-dev
powershell -NoProfile -Command "\$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw ops-panel/start-panel.ps1), [ref]\$null); 'syntax-ok'"
```

Expected: 输出 `syntax-ok`。

- [ ] **Step 5: 提交**

```bash
cd /d/ZJYPHFA-dev
git add ops-panel/start-panel.ps1 .gitignore ops-panel/README.md
git commit -m "chore(ops-panel): 收紧令牌 ACL 并补充访问安全说明"
```

---

### Task 4: 服务器侧 frps 加固与 7000 限源（SSH）

> 需用户已授权 SSH 落地；生产改动前必须备份。**范围决策：`:7000` 不做 IP 限源，保留全网放行，仅加 UFW 限速兜底；云防火墙本次不改。**

**Files:**
- Modify（服务器）: `/etc/frp/frps.toml`
- Modify（服务器）: UFW 规则

**Interfaces:**
- Consumes: 生产机公网出口 IP
- Produces: 回环绑定的 vhost 端口、限源的 :7000

- [ ] **Step 1: 范围确认（无需出口 IP）**

按用户决策，`:7000` **不做 IP 限源**，故本任务不探测出口 IP、不改云防火墙。本任务范围：frps 配置加固（`proxyBindAddr` + 删除 `allowPorts`）+ UFW 限速兜底。

- [ ] **Step 2: 确认免密 sudo 并只读查看线上现状**

```bash
# 先确认是否能免密执行 sudo（不能则后续所有 sudo 步骤需改为交互式 ssh -t 并由用户输入口令）
ssh 43.155.177.109 'sudo -n true && echo SUDO_NOPASS_OK || echo SUDO_NEEDS_PASSWORD'
ssh 43.155.177.109 'sudo cat /etc/frp/frps.toml; echo "=== ufw ==="; sudo ufw status numbered; echo "=== listen ==="; sudo ss -ltnp | grep -E ":7000|:8080|:8443|:7500"'
```

Expected: 出现 `SUDO_NOPASS_OK`；输出中确认线上含 `transport.tls.force = true`、`allowPorts`、`bindAddr = "0.0.0.0"`；记录 UFW 中 `7000/tcp` 规则编号（v4 与 v6 各一条）。

若为 `SUDO_NEEDS_PASSWORD`：停止，改用 `ssh -t 43.155.177.109 'sudo ...'` 由用户输入口令逐步执行，并把该情况报告用户。

- [ ] **Step 3: 备份 frps.toml**

```bash
ssh 43.155.177.109 'sudo cp -a /etc/frp/frps.toml /etc/frp/frps.toml.bak-$(date +%Y%m%d%H%M%S) && sudo ls -l /etc/frp/'
```

Expected: 出现 `.bak-<时间戳>` 文件。

- [ ] **Step 4: 新增 proxyBindAddr 并删除 allowPorts**

```bash
# 本地生成补丁脚本，经 stdin 交给远端 python3，避免嵌套引号
cat > /tmp/frps-harden.py <<'PY'
import re
p = "/etc/frp/frps.toml"
s = open(p).read()
if re.search(r"^proxyBindAddr\s*=", s, re.M) is None:
    s = s.rstrip("\n") + "\n\n# vhost 端口仅回环可达（nginx 反代 127.0.0.1:8080）\nproxyBindAddr = \"127.0.0.1\"\n"
s = re.sub(r"\n*allowPorts\s*=\s*\[[^\]]*\]\n", "\n", s)
open(p, "w").write(s)
PY
ssh 43.155.177.109 'sudo python3 -' < /tmp/frps-harden.py
ssh 43.155.177.109 'sudo cat /etc/frp/frps.toml'
rm -f /tmp/frps-harden.py
```

Expected: 输出的配置中 `proxyBindAddr = "127.0.0.1"` 存在，且不再有 `allowPorts`。

- [ ] **Step 5: 校验并重启**

```bash
ssh 43.155.177.109 'sudo frps verify -c /etc/frp/frps.toml && sudo systemctl restart frps && sleep 2 && sudo systemctl is-active frps && sudo ss -ltnp | grep -E ":7000|:8080|:8443|:7500"'
```

Expected: `verify` 无错误、`active`、`8080/8443/7500` 绑定为 `127.0.0.1`、`:7000` 仍为 `0.0.0.0`（防火墙负责限源）。

- [ ] **Step 6: 验证隧道恢复**

```bash
curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' https://zjyphfa.damaospace.ltd/
ssh 43.155.177.109 'sudo journalctl -u frps -n 20 --no-pager | tail -20'
```

Expected: HTTP 200；frps 日志出现代理注册成功。若 200 未恢复：先 `sudo cp /etc/frp/frps.toml.bak-<时间戳> /etc/frp/frps.toml && sudo systemctl restart frps` 回滚，再排查。

- [ ] **Step 7: UFW 对 :7000 限速**

```bash
ssh 43.155.177.109 'sudo ufw delete allow 7000/tcp && sudo ufw limit 7000/tcp && sudo ufw status numbered'
```

Expected: `7000/tcp` 规则变为 `LIMIT`（单源 IP 30 秒内约 6 次连接上限），v4/v6 均生效，且不再有 `ALLOW ... Anywhere` 的 7000 规则。

> `ufw limit` 只限速、不收窄放行范围；超限连接被丢弃，正常 frpc 的单一长连接不受影响。

- [ ] **Step 8: 验证限速后隧道仍通**

```bash
curl --noproxy '*' -s -o /dev/null -w 'site=%{http_code}\n' https://zjyphfa.damaospace.ltd/
powershell -NoProfile -Command "Test-NetConnection 43.155.177.109 -Port 7000 | Select-Object -ExpandProperty TcpTestSucceeded"
```

Expected: `site=200`、`TcpTestSucceeded = True`。

**回滚：** 若隧道中断，`ssh 43.155.177.109 'sudo ufw delete limit 7000/tcp && sudo ufw allow 7000/tcp'` 恢复原状。

- [ ] **Step 9: 云防火墙（本次不改）**

按决策 `:7000` 保持全网放行，**腾讯云 Lighthouse 控制台无需改动**。

> 可选建议：`22/tcp` 收敛到常用办公网络仍值得做，但与本次 FRP 加固无关，另行处理。

---

### Task 5: 本机 frp 运行时资产整治（生产目录）

**Files:**
- Modify: `D:\ZJYPHFA\frp\frpc.toml`、`D:\ZJYPHFA\frp\frpc-start.vbs`（ACL）
- Delete: `D:\ZJYPHFA\frp\frps.toml`（**破坏性，需用户确认**）

**Interfaces:**
- Consumes: 无
- Produces: 收紧的本机文件权限

- [ ] **Step 1: 确认删除冗余服务端副本**

向用户确认：`D:\ZJYPHFA\frp\frps.toml` 为服务端配置副本，含 token 与 dashboard 明文口令，服务器 `/etc/frp/frps.toml` 才是权威。确认后删除；如用户要保留，改为移出 `frp/`（例如移动到 `D:\ZJYPH-ops-ref\`）并同样收 ACL。

- [ ] **Step 2: 备份并删除副本**

```bash
cp /d/ZJYPHFA/frp/frps.toml /d/ZJYPHFA/frp/frps.toml.local-bak-$(date +%Y%m%d%H%M%S)
rm /d/ZJYPHFA/frp/frps.toml
ls -l /d/ZJYPHFA/frp/
```

Expected: `frps.toml` 消失，`.local-bak-<时间戳>` 保留（确认无误后再由用户决定是否清除）。

- [ ] **Step 3: 收紧 ACL**

在 PowerShell 中执行：

```powershell
$me = "$env:USERDOMAIN\$env:USERNAME"
foreach ($f in @('D:\ZJYPHFA\frp\frpc.toml', 'D:\ZJYPHFA\frp\frpc-start.vbs')) {
  icacls $f /inheritance:r /grant:r "${me}:(M)" /grant:r "SYSTEM:(F)" /grant:r "Administrators:(F)"
}
icacls 'D:\ZJYPHFA\frp\frpc.toml'
```

Expected: 权限列表中只剩当前用户、SYSTEM、Administrators 三类主体（继承已移除）。

- [ ] **Step 4: 验证 frpc 仍可写配置并重连**

打开运维面板 FRP 页签，确认状态正常；或在保存一次配置（`/api/config` PUT）后确认 `frpc.toml` 可写、frpc 可重启。

- [ ] **Step 5: 记录**

本地产物不入库，无需提交；在发版记录中说明本次本机侧改动。

---

### Task 6: 文档订正与同步

**Files:**
- Modify: `frp-tunnel-config.md`

**Interfaces:**
- Consumes: Task 2、Task 4、Task 5 的最终事实
- Produces: 与线上一致的口径

- [ ] **Step 1: 更新 frp-tunnel-config.md**

按以下要点修改（保留现有结构）：

1. §2 服务端配置块加入 `proxyBindAddr = "127.0.0.1"`，删除 `allowPorts` 行，删除“漂移”小节中已消解的部分。
2. §4 端口一览：`8080/8443` 说明由“`127.0.0.1`”保持，但把“靠 UFW”改为“由 `proxyBindAddr` 于内核层回环绑定”；`:7000` 说明改为“公网，仅放行生产机出口 IP `<EGRESS_IP>`”。
3. 新增小节「出口 IP 变更」：给出 `sudo ufw delete allow from <旧IP> to any port 7000 proto tcp` 与 `sudo ufw allow from <新IP> to any port 7000 proto tcp` 两条命令，并说明云防火墙需同步。
4. 新增小节「运维面板访问安全」：令牌文件位置 `ops-panel/.panel-token`、`X-Ops-Token` 头、Host 白名单、审计日志 `ops-panel/logs/audit.log`。
5. 订正 nginx 小节备注（注释陈旧与冗余 `proxy_ssl_*`），并补记 `admin.damaospace.ltd` 无 DNS 记录的事实。
6. 「敏感信息位置」表补一行：面板访问令牌 → 本机 `ops-panel/.panel-token`。

- [ ] **Step 2: 自检**

逐条核对新写内容与服务器实际（`sudo cat /etc/frp/frps.toml`、`sudo ufw status`）一致；不写入任何真实 token 或口令。

- [ ] **Step 3: 提交**

```bash
cd /d/ZJYPHFA-dev
git add frp-tunnel-config.md docs/superpowers/specs/2026-10-05-frp-security-hardening-design.md docs/superpowers/plans/2026-10-05-frp-security-hardening.md
git commit -m "docs: 同步 frp 加固后的配置口径与面板访问安全说明"
```

> 说明：`docs/plans/环境管理规范.md` §8.1 安全基线表可追加一行 FRP 加固说明；但该文件当前有未提交改动，若 Task 0 未先行清理则**跳过**，避免混入无关变更。

---

### Task 7: 发布与验收

**Files:** 无（流程操作）

**Interfaces:**
- Consumes: Task 2、Task 3、Task 6 的提交
- Produces: 生产面板更新到位

- [ ] **Step 1: 开发目录全量校验**

```bash
cd /d/ZJYPHFA-dev
npm run verify
node --test ops-panel/lib/panel-guard.test.mjs
git status --short
git diff --check
```

Expected: `verify` 通过；panel-guard 测试通过；工作树仅含本次明确改动的文件。

- [ ] **Step 2: 推送并建 PR（目标 `main`）**

```bash
cd /d/ZJYPHFA-dev
git push -u origin security/frp-hardening
```

按 `docs/plans/生产部署发布流程.md` §3.2 建 PR、等 CI 通过后合并。**推送与合并属对外可见动作，需用户确认后再执行。**

- [ ] **Step 3: 打正式 tag**

按 §3.3 在更新到远端 `main` 的开发目录打注释 tag（例如 `v2026.10.7`），并核验其属于 `origin/main`。

- [ ] **Step 4: 生产部署**

```bash
cd /d/ZJYPHFA
powershell -NoProfile -ExecutionPolicy Bypass -File server\scripts\deploy-zjyph.ps1 -Tag <正式tag>
```

- [ ] **Step 5: 重启运维面板（部署脚本不含此步）**

部署脚本只重载 postgres/backend/frontend，不重启面板进程。发布后需重启面板以加载新 `server.mjs`：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*ops-panel*server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
powershell -File D:\ZJYPHFA\ops-panel\start-panel.ps1
```

随后确认 `D:\ZJYPHFA\ops-panel\.panel-token` 存在且 ACL 已收紧。

- [ ] **Step 6: 生产验收**

```bash
# 隧道
curl --noproxy '*' -s -o /dev/null -w 'site=%{http_code}\n' https://zjyphfa.damaospace.ltd/
# 面板鉴权
curl -s -o /dev/null -w 'no-token=%{http_code}\n' http://127.0.0.1:3900/api/status
TOKEN=$(cat /d/ZJYPHFA/ops-panel/.panel-token)
curl -s -o /dev/null -w 'with-token=%{http_code}\n' -H "X-Ops-Token: $TOKEN" http://127.0.0.1:3900/api/status
# 服务器监听与限源
ssh 43.155.177.109 'sudo ss -ltnp | grep -E ":8080|:8443|:7500|:7000"; sudo ufw status | grep 7000'
```

Expected: `site=200`、`no-token=401`、`with-token=200`、服务器 vhost/面板端口绑 `127.0.0.1`、7000 仅对出口 IP 放行。最后用 Edge 打开面板确认 UI 正常。

- [ ] **Step 7: 记录发版**

按 §3.4 保留内部发版记录：tag、合并 SHA、变更分类（安全加固）、无数据库迁移、备份文件名与校验结果、验收结果、回滚方式。

---

## 自检（写计划后逐项核对）

**1. Spec 覆盖**

| Spec 条目 | 对应任务 |
|---|---|
| §3.1-1 `proxyBindAddr` | Task 4 Step 4 |
| §3.1-2 删除 `allowPorts` | Task 4 Step 4 |
| §3.1-3 `:7000` 限源 | Task 4 Step 7/9 |
| §3.1-4 `tls.force` 保持 | Task 4 Step 2（确认） |
| §3.2 panel-guard 模块 | Task 1 |
| §3.2 server.mjs 接线 | Task 2 Step 1-5 |
| §3.2 前端携带令牌 | Task 2 Step 6-7 |
| §3.3 本机 ACL | Task 3 Step 1、Task 5 Step 3 |
| §3.3 删除冗余 frps.toml | Task 5 Step 1-2 |
| §3.4 已知边界 | 规格 §3.4 + Task 3 Step 3 |
| §6 验收标准 | Task 2 Step 8-9、Task 7 Step 6 |

无遗漏。

**2. 占位符扫描**

无 `TBD`/`TODO`/“类似上文”等占位；所有代码步骤均给出完整代码。`<EGRESS_IP>`、`<正式tag>`、`<旧IP>` 为执行时才能确定的运行时值，已给出获取方式。

**3. 类型/命名一致性**

- `TOKEN_HEADER` / `isAllowedHost` / `loadOrCreateToken` / `tokenMatches` / `auditLine` 在 Task 1 定义，Task 2 按同名导入使用。
- 前端头名 `X-Ops-Token` 与 `TOKEN_HEADER = 'x-ops-token'` 大小写无关（Node 会小写化请求头）。
- `PANEL_TOKEN`、`PANEL_AUDIT_DIR`、`PANEL_AUDIT_LOG` 命名在 Task 2 内一致。

**4. 已知执行顺序约束**

- Task 2 的三处改动必须同一提交。
- Task 4、5、7 涉及生产，需用户逐步确认。
- Task 4 Step 7（限源）依赖 Step 1 取得的出口 IP。
