import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { createPortalWebHandler, stripBasePath } from './portal-web'

const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zjyph-portal-web-'))
fs.writeFileSync(
  path.join(webRoot, 'index.html'),
  '<!doctype html><html><head><title>财务平台</title><script>window.__BOOT__=1</script></head><body><div id="root"></div></body></html>',
)
fs.mkdirSync(path.join(webRoot, 'assets'))
fs.writeFileSync(path.join(webRoot, 'assets', 'app.js'), 'console.log("ok")')

afterAll(() => {
  fs.rmSync(webRoot, { recursive: true, force: true })
})

describe('stripBasePath', () => {
  it('同时兼容保留和剥离 /<slug>/ 前缀的网关转发', async () => {
    const app = express()
    app.use(stripBasePath('/yipinhui-finance'))
    app.get('/health', (_req, res) => res.json({ ok: true }))

    await request(app).get('/yipinhui-finance/health').expect(200, { ok: true })
    await request(app).get('/health').expect(200, { ok: true })
  })
})

describe('createPortalWebHandler', () => {
  it('为 SPA 注入 base/meta，并允许带 nonce 的 Vite 内联启动脚本', async () => {
    const app = express()
    app.use(createPortalWebHandler(webRoot, '/yipinhui-finance'))

    const res = await request(app).get('/dashboard').expect(200)
    expect(res.text).toContain('<base href="/yipinhui-finance/">')
    expect(res.text).toContain('<meta name="app-base-path" content="/yipinhui-finance">')
    expect(res.text).toMatch(/<script nonce="[^"]+">window\.__BOOT__=1<\/script>/)
    expect(res.headers['content-security-policy']).toContain("script-src 'self' 'nonce-")
    expect(res.headers['cache-control']).toBe('no-store, must-revalidate')
  })

  it('静态资源直接返回，缺失的带扩展名资源不回落 index.html', async () => {
    const app = express()
    app.use(createPortalWebHandler(webRoot, '/yipinhui-finance'))

    const asset = await request(app).get('/assets/app.js').expect(200)
    expect(asset.text).toBe('console.log("ok")')

    const missing = await request(app).get('/assets/missing.js').expect(404)
    expect(missing.text).not.toContain('id="root"')
  })
})
