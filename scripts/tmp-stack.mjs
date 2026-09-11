/* 抓取后端进程当前 JS 堆栈（卡死定位用）：连 inspector → Debugger.pause → 打印 callFrames */
const list = await fetch('http://127.0.0.1:9229/json/list').then((r) => r.json())
if (!list.length) { console.error('无 inspector target'); process.exit(1) }
const ws = new WebSocket(list[0].webSocketDebuggerUrl)
let id = 0
const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params }))
const timer = setTimeout(() => { console.error('抓栈超时（inspector 无响应）'); process.exit(2) }, 10000)
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.method === 'Debugger.paused') {
    clearTimeout(timer)
    console.log('=== 已暂停，当前 JS 调用栈（前 50 帧）===')
    for (const f of msg.params.callFrames.slice(0, 50)) {
      const loc = f.url ? `${f.url.split('/').slice(-3).join('/')}:${f.lineNumber + 1}` : '<native>'
      console.log(`  ${f.functionName || '(anonymous)'} — ${loc}`)
    }
    ws.send(JSON.stringify({ id: ++id, method: 'Debugger.resume' }))
    setTimeout(() => process.exit(0), 300)
  }
}
ws.onopen = () => {
  console.log('已连接 inspector，发送 Debugger.pause ...')
  send('Debugger.enable')
  setTimeout(() => send('Debugger.pause'), 300)
}
ws.onerror = (e) => { console.error('ws error', e.message ?? 'unknown'); process.exit(3) }
ws.onclose = (e) => { console.error('ws closed', e.code, e.reason); process.exit(4) }
