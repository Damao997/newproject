const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { clientIpForProxy, isInsideRoot, proxyHeaders, withoutHopByHopHeaders } = require('./serve-static.cjs')

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
