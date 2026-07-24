/**
 * 校验 CORS 放行 5174 来源（模拟浏览器带 Origin 的跨源请求）。
 *   cd server; npx tsx scripts/cors-check.ts
 */
const BASE = 'http://localhost:3001/api/v1'

async function main(): Promise<void> {
  // 预检 OPTIONS
  const pre = await fetch(`${BASE}/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5174',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,authorization',
    },
  })
  console.log('[cors] preflight status =', pre.status, 'allow-origin =', pre.headers.get('access-control-allow-origin'))

  // 带 Origin 的真实登录
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' },
    body: JSON.stringify({ username: 'admin', password: 'Yipinhui@2026' }),
  })
  console.log('[cors] login status =', login.status, 'allow-origin =', login.headers.get('access-control-allow-origin'))
  const j = await login.json() as { code?: number }
  console.log('[cors] login body code =', j.code, j.code === 0 ? '✅ 5174 已放行' : '❌')
}

main().catch((e) => { console.error('[cors] 异常:', e instanceof Error ? e.message : e); process.exitCode = 1 })
