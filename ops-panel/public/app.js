/* ZJYPH 运维面板 前端逻辑（vanilla JS，无构建） */
'use strict'

const $ = (id) => document.getElementById(id)
const PROCS = ['zjyph-postgres', 'zjyph-backend', 'zjyph-frontend']

let lastStatus = null
let lastCheckOutput = { 'ops-check': '', smoke: '' }
let aiAbort = null
let aiStreaming = false
let lastAiQuestion = ''
let lastExec = null // 最近一次 AI 动作执行结果（供重新诊断）
let statusTimer = null
let logTimer = null

// ── 基础工具 ──
async function api(path, opts = {}) {
  let res
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    // 浏览器连不上面板服务本身（服务未启动或刚被停止）
    const err = new Error('无法连接面板服务，请双击桌面「ZJYPH运维面板」重新启动')
    if (!opts.silent) toast(err.message)
    throw err
  }
  let data
  try { data = await res.json() } catch { data = {} }
  if (!res.ok) {
    const msg = data.error || `HTTP ${res.status}`
    if (!opts.silent) toast(msg)
    const err = new Error(msg)
    err.data = data
    throw err
  }
  return data
}

function toast(msg, info = false) {
  const el = $('toast')
  el.textContent = msg
  el.className = 'toast' + (info ? ' info' : '')
  clearTimeout(el._t)
  el._t = setTimeout(() => el.classList.add('hidden'), 6000)
}

function askConfirm(message, title = '请确认') {
  return new Promise((resolve) => {
    const dialog = $('dialog'), ok = $('dialog-ok'), cancel = $('dialog-cancel')
    $('dialog-title').textContent = title
    $('dialog-message').textContent = message
    $('dialog-detail').classList.add('hidden')
    dialog.classList.remove('hidden')
    const close = (result) => { dialog.classList.add('hidden'); ok.onclick = null; cancel.onclick = null; resolve(result) }
    ok.onclick = () => close(true)
    cancel.onclick = () => close(false)
    cancel.focus()
  })
}

function showNotice(title, message, detail = '') {
  return new Promise((resolve) => {
    const dialog = $('dialog'), ok = $('dialog-ok'), cancel = $('dialog-cancel')
    $('dialog-title').textContent = title
    $('dialog-message').textContent = message
    const pre = $('dialog-detail')
    pre.textContent = detail
    pre.classList.toggle('hidden', !detail)
    cancel.classList.add('hidden')
    ok.textContent = '知道了'
    dialog.classList.remove('hidden')
    const close = () => { dialog.classList.add('hidden'); cancel.classList.remove('hidden'); ok.textContent = '确认'; ok.onclick = null; resolve() }
    ok.onclick = close
    ok.focus()
  })
}

function esc(s) { return String(s ?? '') }

function fmtUptime(ms) {
  if (ms == null) return '—'
  const m = Math.floor(ms / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60), mm = m % 60
  if (h < 48) return `${h} 小时 ${mm} 分`
  return `${Math.floor(h / 24)} 天 ${h % 24} 小时`
}

function fmtAge(hours) {
  if (hours == null) return '无备份'
  if (hours < 1) return `${Math.round(hours * 60)} 分钟前`
  if (hours < 48) return `${hours.toFixed(1)} 小时前`
  return `${(hours / 24).toFixed(1)} 天前`
}

function fmtTime(iso) { return iso ? new Date(iso).toLocaleString('zh-CN') : '—' }

function statusDot(status) {
  if (status === 'online') return 'dot dot-ok'
  if (status === 'stopped' || status === '未托管') return 'dot dot-off'
  return 'dot dot-fail'
}

// ── 标签页 ──
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'))
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
    btn.classList.add('active')
    $(`tab-${btn.dataset.tab}`).classList.add('active')
    document.body.classList.toggle('ai-mode', btn.dataset.tab === 'ai')
    if (btn.dataset.tab === 'overview' || btn.dataset.tab === 'process') loadStatus()
    if (btn.dataset.tab === 'backup') loadBackups()
    if (btn.dataset.tab === 'logs') loadLogs()
    if (btn.dataset.tab === 'frp') loadFrpStatus()
    if (btn.dataset.tab === 'config') loadConfig()
    if (btn.dataset.tab === 'ai') loadAiSettings()
  })
})

// ── 状态总览 / 进程 ──
async function loadStatus() {
  try {
    lastStatus = await api('/api/status')
    renderOverview()
    renderProcess()
  } catch { /* toast 已提示 */ }
}

function renderOverview() {
  const s = lastStatus
  if (!s) return
  $('svc-dot').className = s.pm2Available ? 'dot dot-ok' : 'dot dot-fail'
  $('ai-banner').classList.toggle('hidden', !!s.aiConfigured)

  const cards = []
  for (const p of s.procs) {
    cards.push(`
      <div class="card">
        <div class="title">${esc(p.name)}<span class="dot ${statusDot(p.status)}"></span></div>
        <div class="value">${esc(p.status)}</div>
        <div class="sub">重启 ${p.restarts ?? '—'} 次 · 运行 ${fmtUptime(p.uptimeMs)}</div>
      </div>`)
  }
  const bh = s.backend, fh = s.frontend
  cards.push(`
    <div class="card">
      <div class="title">后端 API<span class="dot ${bh.ok ? 'dot-ok' : 'dot-fail'}"></span></div>
      <div class="value">${bh.ok ? '健康' : '不可达'}</div>
      <div class="sub">127.0.0.1:3100/health ${bh.ok ? '' : '· ' + esc(bh.error || ('HTTP ' + bh.status))}</div>
    </div>`)
  cards.push(`
    <div class="card">
      <div class="title">前端页面<span class="dot ${fh.ok ? 'dot-ok' : 'dot-fail'}"></span></div>
      <div class="value">${fh.ok ? '正常' : '不可达'}</div>
      <div class="sub">127.0.0.1:8080 ${fh.ok ? '' : '· ' + esc(fh.error || ('HTTP ' + fh.status))}</div>
    </div>`)
  const age = s.backup.ageHours
  const ageCls = age == null ? 'dot-fail' : age > 30 ? 'dot-fail' : age > 26 ? 'dot-warn' : 'dot-ok'
  cards.push(`
    <div class="card">
      <div class="title">最近备份<span class="dot ${ageCls}"></span></div>
      <div class="value">${fmtAge(age)}</div>
      <div class="sub">${esc(s.backup.latest?.name || '备份目录为空')} · 共 ${s.backup.count} 个</div>
    </div>`)
  $('ov-cards').innerHTML = cards.join('')
}

function renderProcess() {
  const s = lastStatus
  if (!s) return
  const d = s.pm2Diagnostics || {}
  const diagnostic = $('pm2-diagnostic')
  if (!s.pm2Available) {
    const state = d.installed ? '找到 pm2.cmd，但执行 jlist 失败' : '未找到可执行的 pm2.cmd'
    const detail = d.error || s.pm2Error || '面板无法调用 PM2'
    diagnostic.innerHTML = `<div class="banner warn pm2-diagnostic-card">
      <div class="pm2-diagnostic-head"><strong>PM2 不可用：${esc(state)}</strong><button onclick="refreshPm2Diagnostics()">重新检测</button></div>
      <div>${esc(detail)}</div>
      <div class="pm2-diagnostic-meta">Node：<code>${esc(d.nodePath || '—')}</code> · npm 全局目录：<code>${esc(d.npmPath || '—')}</code></div>
      ${d.searched?.length ? `<details><summary>面板已检查的路径</summary><pre>${esc(d.searched.join('\\n'))}</pre></details>` : ''}
      <div class="pm2-diagnostic-help">服务健康检查仍可独立为 200，但启动/重启/停止操作必须先让面板进程找到同一用户下的 PM2。若确认尚未安装，可在该用户终端执行：<code>npm install -g pm2</code>，然后点击“重新检测”。</div>
    </div>`
  } else {
    diagnostic.innerHTML = `<div class="banner success pm2-diagnostic-card"><div class="pm2-diagnostic-head"><strong>PM2 已就绪</strong><button onclick="refreshPm2Diagnostics()">重新检测</button></div><div class="pm2-diagnostic-meta">${esc(d.executable || 'pm2')} · Node：<code>${esc(d.nodePath || '—')}</code></div></div>`
  }
  const rows = (s.procs || []).map((p) => {
    const isPg = p.name === 'zjyph-postgres'
    return `
    <tr>
      <td style="font-family:monospace">${esc(p.name)}</td>
      <td><span class="dot ${statusDot(p.status)}"></span> ${esc(p.status)}</td>
      <td>${p.restarts ?? '—'}</td>
      <td>${fmtUptime(p.uptimeMs)}</td>
      <td>
        <button onclick="procAction('${p.name}','restart')">重启</button>
        <button onclick="procAction('${p.name}','start')">启动</button>
        <button class="danger" onclick="procAction('${p.name}','stop', ${isPg})">停止</button>
      </td>
    </tr>`
  }).join('')
  $('proc-table').innerHTML = s.pm2Available ? `<table>
    <thead><tr><th>进程</th><th>状态</th><th>重启次数</th><th>运行时长</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table>` : ''
}

async function refreshPm2Diagnostics() {
  try {
    const d = await api('/api/pm2/diagnostics', { silent: true })
    if (lastStatus) lastStatus.pm2Diagnostics = d
    await loadStatus()
    toast(d.ok ? 'PM2 检测通过' : (d.error || 'PM2 检测未通过'), d.ok)
  } catch { /* 已提示 */ }
}

async function procAction(proc, action, isPgStop = false) {
  const tip = action === 'stop'
    ? (isPgStop ? `警告：停止数据库进程 ${proc} 将导致整个系统不可用！\n确定要停止吗？`
                : `确定要停止 ${proc} 吗？`)
    : `确定要${action === 'restart' ? '重启' : '启动'} ${proc} 吗？`
  if (!(await askConfirm(tip))) return
  try {
    const r = await api(`/api/pm2/${proc}/${action}`, { method: 'POST' })
    toast(`${proc} ${action} ${r.ok ? '成功' : '失败'}${r.output ? '：' + r.output.trim().split('\n').slice(-2).join(' ') : ''}`, r.ok)
    await loadStatus()
  } catch { /* 已提示 */ }
}

// ── 巡检 / 冒烟 ──
async function runCheck(kind) {
  const btn = $(kind === 'ops-check' ? 'btn-opscheck' : 'btn-smoke')
  btn.disabled = true
  btn.textContent = kind === 'ops-check' ? '巡检中…' : '验证中…'
  try {
    const r = await api('/api/run-check', { method: 'POST', body: { kind }, silent: true })
    lastCheckOutput[kind] = r.output
    renderCheck(r, kind)
  } catch (e) {
    $('check-result').innerHTML = `<div class="banner warn">检查执行失败：${esc(e.message)}</div>`
  } finally {
    btn.disabled = false
    btn.textContent = kind === 'ops-check' ? '一键巡检' : '冒烟验证'
  }
}

function renderCheck(r, kind) {
  const title = kind === 'ops-check' ? '巡检' : '冒烟验证'
  const summary = r.code === 0 ? '通过' : `异常（退出码 ${r.code}）`
  const items = (r.items || []).map((it) => `
    <div class="check-item"><span class="chip ${it.status}">${it.status}</span><span>${esc(it.msg)}</span></div>`).join('')
  $('check-result').innerHTML = `
    <h2>${title}结果：<span style="color:${r.code === 0 ? 'var(--ok)' : 'var(--fail)'}">${summary}</span></h2>
    ${items || '<p class="hint">未解析到状态行，请查看原始输出</p>'}
    <details class="raw"><summary>原始输出</summary><pre>${esc(r.output)}</pre></details>`
}

// ── 备份 ──
async function backupFull() {
  const btn = $('btn-backup-full')
  btn.disabled = true; btn.textContent = '备份中…（约 10~60 秒）'
  try {
    const r = await api('/api/backup/full', { method: 'POST', silent: true })
    toast(r.ok ? '全量备份完成' : `备份失败（退出码 ${r.code}）`, r.ok)
    renderBackupOp(r)
    await loadBackups()
  } catch (e) {
    $('backup-table').innerHTML = `<div class="banner warn">备份失败：${esc(e.message)}</div>`
  } finally {
    btn.disabled = false; btn.textContent = '立即备份'
  }
}

function renderBackupOp(r) {
  const el = $('backup-table')
  const pre = `<details class="raw" open><summary>执行输出</summary><pre>${esc(r.output)}</pre></details>`
  el.insertAdjacentHTML('afterbegin', r.ok ? '' : `<div class="banner warn">操作失败（退出码 ${r.code}）</div>${pre}`)
}

async function loadBackups() {
  try {
    const r = await api('/api/backups')
    const rows = r.backups.map((b) => `
      <tr>
        <td style="font-family:monospace">${esc(b.name)}</td>
        <td>${b.sizeMb} MB</td>
        <td>${fmtTime(b.mtime)}</td>
        <td><button onclick="verifyBackup('${esc(b.name)}')">校验</button></td>
      </tr>`).join('')
    $('backup-table').innerHTML = `<table>
      <thead><tr><th>文件名</th><th>大小</th><th>备份时间</th><th>操作</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="hint">暂无备份文件</td></tr>'}</tbody></table>`
  } catch { /* 已提示 */ }
}

async function verifyBackup(name) {
  toast(`正在校验 ${name}…（解密 + 结构检查，约 10~30 秒）`, true)
  try {
    const r = await api('/api/backup/verify', { method: 'POST', body: { file: `d:\\ZJYPHFA\\backup\\full\\${name}` }, silent: true })
    await showNotice(r.ok ? '校验通过' : '校验失败', name, (r.output || String(r.code || '')).trim().split('\n').slice(-8).join('\n'))
  } catch { /* 已提示 */ }
}

async function cleanupBackups() {
  const days = parseInt($('cleanup-days').value, 10)
  if (!Number.isFinite(days) || days < 1) return toast('请输入有效的天数')
  if (!(await askConfirm(`确定清理 ${days} 天前的旧备份吗？此操作不可恢复。`))) return
  try {
    const r = await api('/api/backup/cleanup', { method: 'POST', body: { days }, silent: true })
    toast(r.ok ? '清理完成' : `清理失败（退出码 ${r.code}）`, r.ok)
    renderBackupOp(r)
    await loadBackups()
  } catch { /* 已提示 */ }
}

// ── 日志 ──
async function loadLogs() {
  const proc = $('log-proc').value
  const lines = $('log-lines').value
  try {
    const r = await api(`/api/logs/${proc}?lines=${lines}`, { silent: true })
    $('log-out').textContent = r.out.join('\n') || '（暂无输出）'
    $('log-err').textContent = r.err.join('\n') || '（暂无错误输出）'
  } catch (e) {
    $('log-out').textContent = `加载失败：${e.message}`
  }
}

$('log-proc').addEventListener('change', loadLogs)
$('log-lines').addEventListener('change', loadLogs)
$('log-auto').addEventListener('change', () => {
  clearInterval(logTimer)
  if ($('log-auto').checked) {
    logTimer = setInterval(() => {
      if ($('tab-logs').classList.contains('active')) loadLogs()
    }, 5000)
  }
})

// ── 快捷入口 ──
async function openTarget(target) {
  try { await api('/api/open', { method: 'POST', body: { target } }) } catch { /* 已提示 */ }
}

// ── FRP 隧道 ──
let frpState = null

async function loadFrpStatus() {
  try {
    frpState = await api('/api/frp/status', { silent: true })
    renderFrp()
  } catch { /* 已提示或页面切走 */ }
}

function renderFrp() {
  const s = frpState
  if (!s) return
  if (!s.installed) {
    $('frp-cards').innerHTML = '<div class="banner warn">未检测到 frpc（D:\\ZJYPHFA\\frp\\frpc.exe / frpc.toml）</div>'
    $('frp-proxy-table').innerHTML = ''
    return
  }
  const runDot = s.running ? 'dot dot-ok' : 'dot dot-off'
  const tcpDot = s.tcp?.ok ? 'dot dot-ok' : 'dot dot-fail'
  const cards = [
    `<div class="card">
      <div class="title">frpc 进程<span class="dot ${runDot}"></span></div>
      <div class="value">${s.running ? '运行中' : '已停止'}</div>
      <div class="sub">${s.running ? `PID ${s.pids.join(', ')} · 运行 ${fmtUptime(s.uptimeMs)}` : '隧道未启动，公网入口不可用'}</div>
    </div>`,
    `<div class="card">
      <div class="title">公网服务器<span class="dot ${tcpDot}"></span></div>
      <div class="value">${s.tcp?.ok ? '可连通' : '不可达'}</div>
      <div class="sub">${esc(s.config?.serverAddr || '—')}:${s.config?.serverPort || '—'} ${s.tcp?.ok ? '' : '· ' + esc(s.tcp?.error || '')}</div>
    </div>`,
    `<div class="card">
      <div class="title">版本 / 自启</div>
      <div class="value">${esc(s.version || '未知')}</div>
      <div class="sub">登录自启：${s.autostart ? '已注册' : '未注册'}</div>
    </div>`,
  ]
  $('frp-cards').innerHTML = cards.join('')
  $('btn-frp-autostart').textContent = s.autostart ? '取消开机自启' : '注册开机自启'
  $('btn-frp-start').disabled = s.running
  $('btn-frp-stop').disabled = !s.running
  $('btn-frp-restart').disabled = !s.running

  const rows = (s.config?.proxies || []).map((px) => `
    <tr>
      <td style="font-family:monospace">${esc(px.name)}</td>
      <td>${esc(px.type)}</td>
      <td>${esc(px.localIP)}:${px.localPort ?? '—'}</td>
      <td>${px.customDomains?.map(esc).join(', ') || (px.remotePort ? '远程端口 ' + px.remotePort : '—')}</td>
    </tr>`).join('')
  $('frp-proxy-table').innerHTML = (s.config?.proxies?.length ? `<table>
    <thead><tr><th>隧道名</th><th>类型</th><th>本地服务</th><th>公网入口</th></tr></thead>
    <tbody>${rows}</tbody></table>` : '')
}

async function frpAction(action) {
  if (action !== 'start' && !(await askConfirm(action === 'stop'
    ? '确定停止 frpc 吗？停止后 zjyphfa.damaospace.ltd 公网入口将不可用。'
    : '确定重启 frpc 吗？重启期间公网入口短暂中断。'))) return
  for (const id of ['btn-frp-start', 'btn-frp-stop', 'btn-frp-restart']) $(id).disabled = true
  try {
    const r = await api(`/api/frp/${action}`, { method: 'POST', silent: true })
    toast(r.ok ? `frpc ${action} 成功：${(r.output || '').split('\n')[0]}` : `frpc ${action} 失败：${r.error || r.output || ''}`, r.ok)
  } catch { /* 已提示 */ }
  await loadFrpStatus()
  loadFrpLogs()
}

async function toggleFrpAutostart() {
  const enable = !(frpState && frpState.autostart)
  if (enable) {
    if (!(await askConfirm('注册「登录时自动启动 frpc」计划任务吗？\n注册后每次登录 Windows 会自动拉起隧道。'))) return
  } else if (!(await askConfirm('取消 frpc 开机自启吗？取消后重启电脑需要手动启动隧道。'))) return
  try {
    const r = await api('/api/frp/autostart', { method: 'POST', body: { enable }, silent: true })
    toast(r.output || (r.ok ? '操作成功' : '操作失败'), r.ok)
  } catch { /* 已提示 */ }
  loadFrpStatus()
}

async function loadFrpLogs() {
  try {
    const r = await api('/api/frp/logs?lines=200', { silent: true })
    $('frp-log').textContent = r.exists ? (r.lines.join('\n') || '（日志为空）') : '（暂无日志：frpc 尚未由面板启动过）'
  } catch { $('frp-log').textContent = '日志加载失败' }
}

$('frp-config-box').addEventListener('toggle', async () => {
  if (!$('frp-config-box').open) return
  try {
    const r = await api('/api/frp/config', { silent: true })
    $('frp-config').textContent = r.text
  } catch { $('frp-config').textContent = '配置加载失败' }
})

// ── 配置中心 ──
let configState = null
let configDirty = false

function setConfigState(text, tone = 'neutral') {
  const el = $('config-state')
  if (!el) return
  el.textContent = text
  el.className = `status-badge ${tone}`
}

function configFormValue() {
  return {
    panel: { port: Number($('cfg-panel-port').value) },
    services: {
      postgresPort: Number($('cfg-pg-port').value),
      backendPort: Number($('cfg-backend-port').value),
      frontendPort: Number($('cfg-frontend-port').value),
    },
    access: {
      publicDomain: $('cfg-domain').value.trim(),
      frontendOrigin: $('cfg-origin').value.trim(),
    },
  }
}

function fillConfig(c) {
  $('cfg-panel-port').value = c.panel?.port ?? ''
  $('cfg-pg-port').value = c.services?.postgresPort ?? ''
  $('cfg-backend-port').value = c.services?.backendPort ?? ''
  $('cfg-frontend-port').value = c.services?.frontendPort ?? ''
  $('cfg-domain').value = c.access?.publicDomain || ''
  $('cfg-origin').value = c.access?.frontendOrigin || ''
}

function renderConfigVersions(versions = []) {
  const rows = versions.map((v) => `<tr><td class="mono">${esc(v.id)}</td><td>${fmtTime(v.createdAt)}</td><td><button onclick="rollbackConfig('${esc(v.id)}')">恢复</button></td></tr>`).join('')
  $('config-versions').innerHTML = rows ? `<table><thead><tr><th>版本</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty-state">暂无历史版本</p>'
}

async function loadConfig() {
  try {
    const r = await api('/api/config', { silent: true })
    configState = r
    fillConfig(r.config)
    $('cfg-frp').value = r.frpText || ''
    renderConfigVersions(r.versions)
    configDirty = false
    $('config-errors').classList.add('hidden')
    setConfigState('已同步', 'success')
  } catch { setConfigState('加载失败', 'danger') }
}

async function validateConfig() {
  const errors = $('config-errors')
  errors.classList.add('hidden')
  try {
    const r = await api('/api/config/validate', { method: 'POST', body: { config: configFormValue(), frpText: $('cfg-frp').value }, silent: true })
    setConfigState('校验通过', 'success')
    toast('配置校验通过', true)
    return true
  } catch (e) {
    const list = e.data?.errors || [e.message]
    errors.innerHTML = `<strong>请修正以下问题：</strong><ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    errors.classList.remove('hidden')
    setConfigState('需要修正', 'danger')
    return false
  }
}

async function saveConfig() {
  const btn = $('btn-config-save')
  if (!(await validateConfig())) return
  btn.disabled = true; btn.textContent = '保存中…'
  try {
    const r = await api('/api/config', { method: 'PUT', body: { config: configFormValue(), frpText: $('cfg-frp').value }, silent: true })
    configDirty = false
    setConfigState('已保存，待应用', 'warning')
    toast(`配置已保存，已创建版本 ${r.backup.id}`, true)
    await loadConfig()
    setConfigState('已保存，待应用', 'warning')
  } catch { setConfigState('保存失败', 'danger') }
  finally { btn.disabled = false; btn.textContent = '保存配置' }
}

async function applyConfig() {
  if (configDirty && !(await validateConfig())) return
  if (!(await askConfirm('确认应用配置并重启后端、前端、数据库和 FRP 吗？期间系统会短暂中断。'))) return
  const btn = $('btn-config-apply')
  btn.disabled = true; btn.textContent = '应用中…'
  try {
    const r = await api('/api/config/apply', { method: 'POST', body: {}, silent: true })
    toast(r.ok ? '配置已应用，服务正在恢复' : '部分服务应用失败，请查看结果', r.ok)
    setConfigState(r.ok ? '已应用' : '部分失败', r.ok ? 'success' : 'danger')
    setTimeout(loadStatus, 2500)
  } catch { setConfigState('应用失败', 'danger') }
  finally { btn.disabled = false; btn.textContent = '应用并重启服务' }
}

async function rollbackConfig(id) {
  if (!(await askConfirm(`确认恢复配置版本 ${id} 吗？恢复后仍需点击“应用并重启服务”。`))) return
  try {
    await api('/api/config/rollback', { method: 'POST', body: { id }, silent: true })
    toast('配置已恢复，请检查内容后再应用', true)
    await loadConfig()
    setConfigState('已回滚，待应用', 'warning')
  } catch { /* 已提示 */ }
}

document.querySelectorAll('#tab-config input, #tab-config textarea').forEach((el) => el.addEventListener('input', () => {
  configDirty = true
  setConfigState('有未保存修改', 'warning')
}))

// ── AI 设置 ──
async function loadAiSettings() {
  try {
    const s = await api('/api/ai/settings', { silent: true })
    $('ai-baseurl').value = s.baseUrl || ''
    $('ai-model').value = s.model || ''
    $('ai-key').placeholder = s.hasKey ? `已保存（${s.keyMasked}），留空不修改` : '尚未配置'
  } catch { /* ignore */ }
}

async function saveAiSettings() {
  const body = { baseUrl: $('ai-baseurl').value.trim(), model: $('ai-model').value.trim() }
  const key = $('ai-key').value.trim()
  if (key) body.apiKey = key
  if (!body.baseUrl) return toast('请填写 Base URL')
  try {
    await api('/api/ai/settings', { method: 'PUT', body })
    $('ai-key').value = ''
    toast('AI 设置已保存', true)
    await loadAiSettings()
    loadStatus()
  } catch { /* 已提示 */ }
}

async function testAi() {
  const btn = $('btn-ai-test')
  btn.disabled = true; btn.textContent = '测试中…'
  $('ai-test-result').textContent = ''
  try {
    const r = await api('/api/ai/test', { method: 'POST' })
    $('ai-test-result').textContent = `连接正常，模型 ${r.model} 回复：${r.reply}`
  } catch (e) {
    $('ai-test-result').textContent = `测试失败：${e.message}`
  } finally { btn.disabled = false; btn.textContent = '连通性测试' }
}

// ── AI 对话线程与修复闭环 ──
function threadAdd(role, text) {
  const thread = $('ai-thread')
  const empty = thread.querySelector('.ai-empty')
  if (empty) empty.remove()
  const div = document.createElement('div')
  div.className = `msg ${role}`
  div.textContent = text
  thread.appendChild(div)
  thread.scrollTop = thread.scrollHeight
  return div
}

function actionCard(host, actionJson) {
  const impacts = {
    restart_process: (p) => `将重启 ${p.proc}，服务中断约 3~5 秒`,
    start_process: (p) => `将启动 ${p.proc}`,
    restart_all: () => '将依次重启全部三个进程，系统整体短暂中断',
    run_check: (p) => `将运行${p.kind === 'ops-check' ? '巡检' : '冒烟验证'}（只读，不影响服务）`,
    run_backup_full: () => '将立即执行一次全量备份（不影响服务，约 10~60 秒）',
    cleanup_backups: (p) => `将删除 ${p.days} 天前的旧备份文件，不可恢复`,
    check_frp: () => '只读检查 FRP 进程、服务器 TCP 控制连接、代理配置和最近日志，不会修改服务',
  }
  const card = document.createElement('div')
  card.className = 'action-card'
  const name = document.createElement('div')
  name.className = 'act-name'
  name.textContent = `修复动作：${actionJson.action} ${JSON.stringify(actionJson.params || {})}`
  const impact = document.createElement('div')
  impact.className = 'act-impact'
  impact.textContent = impacts[actionJson.action] ? impacts[actionJson.action](actionJson.params || {}) : '影响未知，请确认参数后再执行'
  const btns = document.createElement('div')
  btns.className = 'btns'
  const ok = document.createElement('button')
  ok.className = 'primary'
  ok.textContent = '确认执行'
  const cancel = document.createElement('button')
  cancel.textContent = '忽略'
  cancel.onclick = () => { card.replaceWith(Object.assign(document.createElement('div'), { className: 'hint', textContent: '已忽略该修复建议' })) }
  ok.onclick = async () => {
    if (!(await askConfirm(`确认执行「${actionJson.action}」吗？\n${impact.textContent}`))) return
    ok.disabled = true
    ok.textContent = '执行中…'
    try {
      const r = await api('/api/ai/execute', { method: 'POST', body: { action: actionJson.action, params: actionJson.params || {} }, silent: true })
      const okFlag = r.ok !== false
      const resultText = [
        `已执行动作 ${actionJson.action} ${JSON.stringify(actionJson.params || {})} → ${okFlag ? '成功' : '失败'}`,
        r.output ? '输出摘要：\n' + r.output.split('\n').filter(Boolean).slice(-12).join('\n') : (r.error || ''),
      ].filter(Boolean).join('\n')
      lastExec = { action: actionJson.action, params: actionJson.params || {}, ok: okFlag, output: (r.output || r.error || '').slice(-3000) }
      const note = threadAdd('system-note', resultText)
      const rediag = document.createElement('button')
      rediag.textContent = '重新诊断（带上执行结果）'
      rediag.style.marginTop = '8px'
      rediag.onclick = () => aiStart('overview', `刚才执行了修复动作 ${actionJson.action}，参数 ${JSON.stringify(actionJson.params || {})}，结果 ${okFlag ? '成功' : '失败'}。请确认问题是否解决，未解决请继续排查。`)
      note.appendChild(rediag)
      ok.textContent = '已执行'
      ok.disabled = true
      loadStatus()
    } catch (e) {
      ok.textContent = '执行失败'
      threadAdd('system-note', `动作执行失败：${e.message}`)
    }
  }
  btns.append(ok, cancel)
  card.append(name, impact, btns)
  host.appendChild(card)
}

function stripActionFence(text) {
  const m = text.match(/```action\s*([\s\S]*?)```/)
  if (!m) return { text, action: null }
  const rest = text.replace(/```action[\s\S]*?```/g, '').trim()
  try { return { text: rest, action: JSON.parse(m[1].trim()) } }
  catch { return { text: rest, action: null } }
}

function gotoAi(source) {
  document.querySelector('.tab-btn[data-tab="ai"]').click()
  if (!aiStreaming) aiStart(source)
}

async function aiStart(source, question) {
  if (aiStreaming) return
  let extra
  if (source === 'check') {
    const out = lastCheckOutput['ops-check'] || lastCheckOutput['smoke']
    if (out) extra = { 最近检查输出: out.slice(-4000) }
  } else if (source === 'logs') {
    extra = { 日志摘录: { 进程: $('log-proc').value, 标准输出尾部: $('log-out').textContent.split('\n').slice(-60).join('\n'), 错误输出尾部: $('log-err').textContent.split('\n').slice(-40).join('\n') } }
  }
  await aiStream({ source, extra, question })
}

async function aiAsk() {
  const q = $('ai-question').value.trim()
  if (!q || aiStreaming) return
  $('ai-question').value = ''
  lastAiQuestion = q
  await aiStream({ source: 'overview', question: q })
}

$('ai-question').addEventListener('keydown', (e) => { if (e.key === 'Enter') aiAsk() })

function aiStop() { if (aiAbort) aiAbort.abort() }

async function aiStream({ source, extra, question }) {
  if (aiStreaming) return
  aiStreaming = true
  $('btn-ai-send').disabled = true
  $('btn-ai-stop').classList.remove('hidden')
  if (question) threadAdd('user', question)
  const msgDiv = threadAdd('assistant', '')
  const cursor = document.createElement('span')
  cursor.className = 'cursor'
  msgDiv.appendChild(cursor)
  let full = ''
  aiAbort = new AbortController()
  try {
    const res = await fetch('/api/ai/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, extra, question }),
      signal: aiAbort.signal,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() || ''
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') continue
          try {
            const j = JSON.parse(payload)
            const delta = j.choices?.[0]?.delta?.content
            if (delta) full += delta
          } catch { /* 忽略无法解析的心跳块 */ }
        }
        msgDiv.textContent = full
        msgDiv.appendChild(cursor)
        $('ai-thread').scrollTop = $('ai-thread').scrollHeight
      }
    }
    cursor.remove()
    const { text, action } = stripActionFence(full)
    msgDiv.textContent = text || full || '（AI 未返回内容）'
    if (action) actionCard(msgDiv, action)
  } catch (e) {
    cursor.remove()
    if (e.name === 'AbortError') msgDiv.textContent = full + '\n\n（已停止生成）'
    else {
      msgDiv.textContent = `诊断失败：${e.message}`
      const retry = document.createElement('button')
      retry.textContent = '重试本次诊断'
      retry.className = 'retry-button'
      retry.onclick = () => aiStream({ source, extra, question: lastAiQuestion || question })
      msgDiv.appendChild(document.createElement('br'))
      msgDiv.appendChild(retry)
    }
    if (String(e.message).includes('未配置 AI API')) {
      $('ai-settings-box').open = true
      $('ai-settings-box').scrollIntoView({ behavior: 'smooth' })
    }
  } finally {
    aiStreaming = false
    aiAbort = null
    $('btn-ai-send').disabled = false
    $('btn-ai-stop').classList.add('hidden')
  }
}

// ── 时钟与启动 ──
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('zh-CN') }, 1000)
loadStatus()
loadAiSettings()
setInterval(loadStatus, 15000)
setInterval(() => { if ($('tab-frp').classList.contains('active')) loadFrpStatus() }, 15000)
