/* eslint-disable no-console */
/**
 * E2E：多会话互踢修复验证（真实 HTTP，端口 3001）
 * 1. 同一账号登录两次 → 两个会话并存
 * 2. 两个 refresh token 均可独立轮转（旧实现：后者必 401）
 * 3. 登出其中一个会话 → 该会话 refresh 失效，另一会话仍存活
 */
const BASE = 'http://localhost:3001/api/v1'

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  return { status: res.status, json }
}

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!cond) failures += 1
}

const USERNAME = 'admin'
const PASSWORD = 'Admin@2026'

async function main() {
  // 1) 两次登录（模拟两个标签页/设备）
  const login1 = await req('POST', '/auth/login', { username: USERNAME, password: PASSWORD })
  check('登录1 成功', login1.status === 200 && login1.json.code === 0, `status=${login1.status}`)
  const { accessToken: acc1, refreshToken: ref1 } = login1.json.data

  const login2 = await req('POST', '/auth/login', { username: USERNAME, password: PASSWORD })
  check('登录2 成功（多会话并存）', login2.status === 200 && login2.json.code === 0, `status=${login2.status}`)
  const { accessToken: acc2, refreshToken: ref2 } = login2.json.data

  // 2) 两个 refresh token 各自轮转（核心断言：旧实现第二个必然 401）
  const r1 = await req('POST', '/auth/refresh', { refreshToken: ref1 })
  check('会话1 refresh 轮转成功', r1.status === 200 && r1.json.code === 0, `status=${r1.status} msg=${r1.json.message ?? ''}`)
  const acc1b = r1.json.data.accessToken
  const ref1b = r1.json.data.refreshToken

  const r2 = await req('POST', '/auth/refresh', { refreshToken: ref2 })
  check('会话2 refresh 轮转成功（互不踢）', r2.status === 200 && r2.json.code === 0, `status=${r2.status} msg=${r2.json.message ?? ''}`)
  const acc2b = r2.json.data.accessToken
  const ref2b = r2.json.data.refreshToken

  // 3) 登出会话2 → 会话2 的 refresh 失效、会话1 不受影响
  const out = await req('POST', '/auth/logout', null, acc2b)
  check('登出会话2 成功', out.status === 200 && out.json.code === 0, `status=${out.status}`)

  const d1 = await req('POST', '/auth/refresh', { refreshToken: ref2b })
  check('会话2 登出后 refresh 失效', d1.status === 401, `status=${d1.status} msg=${d1.json.message ?? ''}`)

  const d2 = await req('POST', '/auth/refresh', { refreshToken: ref1b })
  check('会话1 仍可刷新（不受其他会话登出影响）', d2.status === 200 && d2.json.code === 0, `status=${d2.status} msg=${d2.json.message ?? ''}`)

  // 4) 清理：登出会话1
  const out2 = await req('POST', '/auth/logout', null, acc1b)
  check('登出会话1 清理完成', out2.status === 200, `status=${out2.status}`)

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('E2E_ERROR:', e.message)
  process.exit(1)
})
