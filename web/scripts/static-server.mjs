// 简易 HTTP 静态服务器，给 antd-style-design 用
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = process.argv[2] || process.cwd()
const PORT = Number(process.argv[3] || 8001)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') pathname = '/index.html'
    const filePath = normalize(join(ROOT, pathname))
    if (!filePath.startsWith(resolve(ROOT))) {
      res.writeHead(403); res.end('forbidden'); return
    }
    const s = await stat(filePath).catch(() => null)
    if (!s || !s.isFile()) { res.writeHead(404); res.end('not found'); return }
    const data = await readFile(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
    })
    res.end(data)
  } catch (err) {
    res.writeHead(500); res.end(String(err))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`static server: http://127.0.0.1:${PORT}/  (root=${ROOT})`)
})
