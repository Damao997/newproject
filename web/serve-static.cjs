// web/serve-static.cjs — ZJYPH 生产前端静态托管 + 同源 API 反向代理
// 用法：node serve-static.cjs（cwd=web/），STATIC_ROOT/PORT/BACKEND_PORT 可用环境变量覆盖
const http = require('node:http')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const DEFAULT_ROOT = path.resolve(process.env.STATIC_ROOT || path.join(__dirname, 'dist'))
const DEFAULT_PORT = Number(process.env.PORT || 8080)
const DEFAULT_BACKEND_PORT = Number(process.env.BACKEND_PORT || 3100)
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
])
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
}

function normalizeIp(value) {
  const ip = String(value || '').trim()
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

function isLoopback(value) {
  const ip = normalizeIp(value)
  return ip === '127.0.0.1' || ip === '::1'
}

/**
 * 公网请求由本机 frpc（回环地址）转入，云端 nginx 会用
 * `$proxy_add_x_forwarded_for` 把真实对端追加在 XFF 最右侧，因此只接受最后一个合法 IP。
 * 局域网直连 8080 时完全忽略客户端自带 XFF，使用 socket 对端地址。
 */
function clientIpForProxy(req) {
  const socketIp = normalizeIp(req.socket && req.socket.remoteAddress)
  if (!isLoopback(socketIp)) return net.isIP(socketIp) ? socketIp : '127.0.0.1'

  const raw = req.headers && req.headers['x-forwarded-for']
  const values = Array.isArray(raw) ? raw : String(raw || '').split(',')
  const candidate = normalizeIp(values.map((item) => item.trim()).filter(Boolean).at(-1))
  return net.isIP(candidate) ? candidate : socketIp
}

function withoutHopByHopHeaders(input) {
  const headers = { ...input }
  const connection = Array.isArray(headers.connection) ? headers.connection.join(',') : String(headers.connection || '')
  for (const token of connection.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)) delete headers[token]
  for (const name of HOP_BY_HOP_HEADERS) delete headers[name]
  return headers
}

function proxyHeaders(req, backendPort) {
  const headers = withoutHopByHopHeaders(req.headers)

  const fromTrustedTunnel = isLoopback(req.socket && req.socket.remoteAddress)
  const incomingProto = String(req.headers['x-forwarded-proto'] || '').split(',').at(-1).trim().toLowerCase()
  headers.host = `127.0.0.1:${backendPort}`
  headers['x-forwarded-for'] = clientIpForProxy(req)
  headers['x-forwarded-proto'] = fromTrustedTunnel && ['http', 'https'].includes(incomingProto) ? incomingProto : 'http'
  headers['x-forwarded-host'] = String(req.headers.host || '')
  return headers
}

function proxyApi(req, res, backendPort) {
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: proxyHeaders(req, backendPort),
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, withoutHopByHopHeaders(upstreamRes.headers))
    upstreamRes.pipe(res)
  })
  upstream.setTimeout(60_000, () => upstream.destroy(new Error('upstream timeout')))
  upstream.on('error', (err) => {
    console.error('[serve-static] api proxy:', err.message)
    if (res.writableEnded) return
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ code: 502, message: 'bad gateway' }))
  })
  req.pipe(upstream)
}

function isInsideRoot(root, filePath) {
  const relative = path.relative(root, filePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function createServer(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT)
  const backendPort = Number(options.backendPort || DEFAULT_BACKEND_PORT)
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) throw new Error('BACKEND_PORT 非法')

  return http.createServer((req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) {
        return proxyApi(req, res, backendPort)
      }
      if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
        res.writeHead(405, { Allow: 'GET, HEAD' })
        return res.end('method not allowed')
      }
      if (pathname === '/') pathname = '/index.html'
      let filePath = path.normalize(path.join(root, pathname))
      if (!isInsideRoot(root, filePath)) { res.writeHead(403); return res.end('forbidden') }
      const stat = fs.existsSync(filePath) && fs.statSync(filePath)
      if (!stat || !stat.isFile()) filePath = path.join(root, 'index.html') // SPA fallback
      const data = fs.readFileSync(filePath)
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=86400',
      })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch (err) {
      console.error('[serve-static]', err.message)
      res.writeHead(500); res.end('internal error')
    }
  })
}

if (require.main === module) {
  if (!Number.isInteger(DEFAULT_PORT) || DEFAULT_PORT < 1 || DEFAULT_PORT > 65535) throw new Error('PORT 非法')
  createServer().listen(DEFAULT_PORT, '0.0.0.0', () => {
    console.log(`serve-static: 0.0.0.0:${DEFAULT_PORT} root=${DEFAULT_ROOT} backend=127.0.0.1:${DEFAULT_BACKEND_PORT}`)
  })
}

module.exports = { clientIpForProxy, createServer, isInsideRoot, isLoopback, proxyHeaders, withoutHopByHopHeaders }
