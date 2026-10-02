const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { clientIpForProxy, createServer, isInsideRoot, proxyHeaders, withoutHopByHopHeaders } = require('./serve-static.cjs')

function request(remoteAddress, headers = {}) {
  return { socket: { remoteAddress }, headers }
}

test('局域网直连时忽略客户端伪造的 XFF', () => {
  const req = request('::ffff:192.168.1.50', { 'x-forwarded-for': '203.0.113.9' })
  assert.equal(clientIpForProxy(req), '192.168.1.50')
})

test('回环 FRP 链路只接受 nginx 追加在最右侧的真实地址', () => {
  const req = request('127.0.0.1', { 'x-forwarded-for': '198.51.100.8, 203.0.113.9' })
  assert.equal(clientIpForProxy(req), '203.0.113.9')
  assert.equal(proxyHeaders(req, 3100)['x-forwarded-for'], '203.0.113.9')
})

test('非可信直连不能伪造 https 协议', () => {
  const req = request('192.168.1.50', { host: 'internal:8080', 'x-forwarded-proto': 'https' })
  const headers = proxyHeaders(req, 3100)
  assert.equal(headers['x-forwarded-proto'], 'http')
  assert.equal(headers['x-forwarded-host'], 'internal:8080')
})

test('代理双向移除逐跳头及 Connection 声明的扩展头', () => {
  const headers = withoutHopByHopHeaders({
    connection: 'keep-alive, x-internal-hop',
    'keep-alive': 'timeout=5',
    'x-internal-hop': 'secret',
    'content-type': 'application/json',
  })
  assert.equal(headers.connection, undefined)
  assert.equal(headers['keep-alive'], undefined)
  assert.equal(headers['x-internal-hop'], undefined)
  assert.equal(headers['content-type'], 'application/json')
})

test('静态文件只能位于根目录内部', () => {
  const root = path.resolve('C:/app/dist')
  assert.equal(isInsideRoot(root, path.join(root, 'assets/app.js')), true)
  assert.equal(isInsideRoot(root, path.resolve('C:/app/dist-private/secret.txt')), false)
})

// 部署会替换带 hash 的构建产物；旧页面请求已失效 chunk 时必须 404，
// 否则 SPA 回退会把 index.html 当 JS 返回，浏览器报
// 「Failed to fetch dynamically imported module」（2026-10-02 生产事故根因）
test('缺失的构建产物返回 404，前端路由仍回退 index.html', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zjyph-static-'))
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><div id="root"></div>')
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'assets', 'app-abc123.js'), 'console.log(1)')

  const server = createServer({ root, backendPort: 3100 })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const missingAsset = await fetch(`http://127.0.0.1:${port}/assets/old-hash.js`)
    assert.equal(missingAsset.status, 404)

    const route = await fetch(`http://127.0.0.1:${port}/indicators/operating`)
    assert.equal(route.status, 200)
    assert.match(route.headers.get('content-type'), /text\/html/)
    assert.match(await route.text(), /id="root"/)

    const existingAsset = await fetch(`http://127.0.0.1:${port}/assets/app-abc123.js`)
    assert.equal(existingAsset.status, 200)
    assert.match(existingAsset.headers.get('content-type'), /text\/javascript/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(root, { recursive: true, force: true })
  }
})
