// web/serve-static.cjs — ZJYPH 生产前端静态托管（零依赖，PM2 zjyph-frontend 进程入口）
// 用法：node serve-static.cjs（cwd=web/），STATIC_ROOT/PORT 可用环境变量覆盖
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(process.env.STATIC_ROOT || path.join(__dirname, 'dist'))
const PORT = Number(process.env.PORT || 8080)
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
}

http.createServer((req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (pathname === '/') pathname = '/index.html'
    let filePath = path.normalize(path.join(ROOT, pathname))
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden') }
    let stat = fs.existsSync(filePath) && fs.statSync(filePath)
    if (!stat || !stat.isFile()) filePath = path.join(ROOT, 'index.html') // SPA fallback
    const data = fs.readFileSync(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=86400',
    })
    res.end(data)
  } catch (err) {
    console.error('[serve-static]', err.message)
    res.writeHead(500); res.end('internal error')
  }
}).listen(PORT, '0.0.0.0', () => console.log(`serve-static: 0.0.0.0:${PORT} root=${ROOT}`))
