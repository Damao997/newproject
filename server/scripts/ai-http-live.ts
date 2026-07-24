/**
 * 真实 HTTP + 真实 LLM 端到端 SSE 联调（需后端已在 3001 运行）：
 *   cd server; npx tsx scripts/ai-http-live.ts
 * 登录取 token → 打 /ai/polish 与 /ai/analyze，逐 token 打印并统计事件。
 */
const BASE = 'http://localhost:3001/api/v1'

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Yipinhui@2026' }),
  })
  const json = await res.json() as { data?: { accessToken?: string } }
  const token = json.data?.accessToken
  if (!token) throw new Error('登录失败')
  return token
}

async function readSSE(path: string, token: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  console.log(`\n[live] ${path} status=${res.status} ct=${res.headers.get('content-type')}`)
  if (!res.body) { console.log('[live] 无响应体'); return }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let tokens = 0
  let done = false
  let full = ''
  for (;;) {
    const { done: d, value } = await reader.read()
    if (d) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const evt = JSON.parse(line.slice(5).trim()) as { type: string; content?: string; finalText?: string; error?: string }
      if (evt.type === 'token') { tokens++; full += evt.content ?? ''; process.stdout.write(evt.content ?? '') }
      else if (evt.type === 'done') { done = true }
      else if (evt.type === 'error') { console.log(`\n[live] error 事件: ${evt.error}`) }
    }
  }
  console.log(`\n[live] tokenEvents=${tokens} done=${done} 全文长度=${full.length}`)
}

async function main(): Promise<void> {
  const token = await login()
  console.log('[live] 登录成功')

  await readSSE('/ai/polish', token, { text: '本月收入涨了不少，比去年同期多了挺多，达成率也还行。', style: 'formal' })

  // 取一个真实公司×科目做 analyze
  const compRes = await fetch(`${BASE}/data/companies`, { headers: { Authorization: `Bearer ${token}` } })
  const comp = await compRes.json() as { data?: { code: string; type: string }[] }
  const company = comp.data?.find((c) => c.type === 'entity')
  if (company) {
    await readSSE('/ai/analyze', token, { companyCode: company.code, subjectCode: 'OP_001', subjectType: 'operating', period: '2025-06' })
  } else {
    console.log('[live] 未找到单体公司，跳过 analyze')
  }
  console.log('\n[live] 端到端联调完成 ✅')
}

main().catch((e) => { console.error('[live] 异常:', e instanceof Error ? e.message : e); process.exitCode = 1 })
