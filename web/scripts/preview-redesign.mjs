// 默认模拟预览；--real-data 连接隔离开发后端，始终仅监听本机。
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { createPersonalFixtures } from './personal-fixtures.mjs'
import { resolveFixture } from './redesign-fixtures.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
// Tailwind 的默认配置解析依赖工作目录，模拟预览统一在 web 目录启动。
process.chdir(root)
const realData = process.argv.includes('--real-data')
const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] ?? 5177)
if (!Number.isInteger(port) || port < 5177 || port > 5199) throw new Error('开发预览端口须在 5177–5199 之间')
const personalFixtures = createPersonalFixtures()
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{
    name: 'redesign-fixtures-only',
    configureServer(vite) {
      if (realData) return
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/api/v1/')) return next()
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        let body = {}
        if (request.url.startsWith('/api/v1/auth/') && !['GET', 'HEAD'].includes(request.method)) {
          const chunks = []; for await (const chunk of request) chunks.push(chunk)
          if (request.headers['content-type']?.includes('application/json')) {
            try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { response.statusCode = 400; return response.end(JSON.stringify({ code: 400, message: '模拟请求格式错误' })) }
          }
        }
        const result = personalFixtures(request.url, request.method, body) ?? resolveFixture(request.url, request.method)
        if (result.binary) { response.setHeader('Content-Type', result.contentType); return response.end(result.binary) }
        if (result.code >= 400) response.statusCode = result.code
        response.end(JSON.stringify(result))
      })
    },
    transformIndexHtml: () => [{ tag: 'aside', attrs: { 'aria-label': '开发预览提示', style: 'position:fixed;right:12px;bottom:8px;z-index:20;padding:4px 8px;border-radius:8px;background:#202b36;color:white;font:12px sans-serif;pointer-events:none' }, children: realData ? '开发数据副本' : '模拟数据预览', injectTo: 'body' }],
  }],
})
await server.listen()
console.log(realData ? `真实开发数据预览：http://127.0.0.1:${port}/（后端 3001，开发库 5434）` : `模拟改版预览：http://127.0.0.1:${port}/（账号与密码均为 preview）`)
