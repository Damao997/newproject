/**
 * ZJYPH 生产前端静态托管（Windows / 非 Docker 环境）
 *
 * 零依赖的 SPA 静态服务器：托管 web/dist 构建产物，未知路径回退 index.html。
 * 监听端口由环境变量 ZJYPH_WEB_PORT 控制（默认 8080，监听所有接口，
 * 暴露面由 Windows 防火墙限定——见 C4 安全加固）。
 *
 * 用法（PM2，见 server/zjyph-ecosystem.config.cjs 的 zjyph-frontend）：
 *   node serve-static.cjs
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.env.ZJYPH_WEB_PORT || 8080)
const DIST = path.join(__dirname, 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.map': 'application/json',
}

function send(res, status, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }
    res.writeHead(status, {
      'Content-Type': contentType,
      // 构建产物带 hash，可长缓存；index.html 不缓存保证及时更新
      'Cache-Control': contentType.includes('text/html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(data)
  })
}

http
  .createServer((req, res) => {
    let urlPath
    try {
      urlPath = decodeURIComponent(req.url.split('?')[0])
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    if (urlPath === '/') urlPath = '/index.html'

    // 防目录穿越：规范化后必须仍在 dist 内（含路径分隔符，避免 dist-* 前缀兄弟目录绕过）
    const filePath = path.normalize(path.join(DIST, urlPath))
    if (!filePath.startsWith(DIST + path.sep)) {
      res.writeHead(403)
      res.end()
      return
    }

    fs.stat(filePath, (err, stat) => {
      if (!err && stat.isFile()) {
        send(res, 200, filePath, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream')
        return
      }
      // SPA fallback：客户端路由路径回退 index.html
      send(res, 200, path.join(DIST, 'index.html'), MIME['.html'])
    })
  })
  .listen(PORT, () => {
    console.log(`[zjyph-frontend] 静态托管就绪：${DIST} -> http://0.0.0.0:${PORT}`)
  })
