import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { RequestHandler } from 'express'

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 兼容中台网关两种转发方式：
 * 1. 保留 /<slug>/ 前缀；
 * 2. 网关剥离前缀，仅转发应用内部路径。
 */
export function stripBasePath(basePath: string): RequestHandler {
  return (req, _res, next) => {
    if (!basePath) {
      next()
      return
    }
    const url = req.url
    if (url === basePath || url.startsWith(`${basePath}/`) || url.startsWith(`${basePath}?`)) {
      const stripped = url.slice(basePath.length)
      req.url = stripped ? (stripped.startsWith('/') ? stripped : `/${stripped}`) : '/'
    }
    next()
  }
}

/**
 * 单进程模式下的 SPA 静态托管。
 * - index.html 每次请求注入 <base> 与 BASE_PATH 元数据；
 * - 每次请求生成 nonce，兼容 Vite 注入的内联主题启动脚本；
 * - 仅对无扩展名的 GET/HEAD 路径回退 index.html；
 * - API 与健康检查不进入 SPA 回退。
 */
export function createPortalWebHandler(webRoot: string, basePath: string): RequestHandler {
  const resolvedRoot = path.resolve(webRoot)
  const indexPath = path.join(resolvedRoot, 'index.html')
  const indexTemplate = fs.readFileSync(indexPath, 'utf8')
  const baseHref = `${basePath || ''}/`
  const escapedBaseHref = escapeHtmlAttribute(baseHref)
  const escapedBasePath = escapeHtmlAttribute(basePath)
  const injectedHead = [
    `<base href="${escapedBaseHref}">`,
    `<meta name="app-base-path" content="${escapedBasePath}">`,
  ].join('\n    ')

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    if (req.path === '/health' || req.path === '/api' || req.path.startsWith('/api/')) {
      next()
      return
    }

    const relativePath = decodeURIComponent(req.path).replace(/^\/+/, '')
    const candidate = path.resolve(resolvedRoot, relativePath)
    const withinRoot = candidate === resolvedRoot || candidate.startsWith(`${resolvedRoot}${path.sep}`)
    if (relativePath && withinRoot && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      res.sendFile(candidate)
      return
    }

    if (path.extname(req.path) !== '') {
      next()
      return
    }

    const nonce = randomBytes(18).toString('base64')
    const html = indexTemplate
      .replace(/<head>/i, `<head>\n    ${injectedHead}`)
      .replace(/<script\b/gi, `<script nonce="${nonce}"`)
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate',
        'Content-Security-Policy': [
          "default-src 'self'",
          `script-src 'self' 'nonce-${nonce}'`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "connect-src 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
        ].join('; '),
      })
      .send(req.method === 'HEAD' ? undefined : html)
  }
}
